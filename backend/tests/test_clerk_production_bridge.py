"""Real local SQL/RLS and ASGI; Clerk verification is simulated, never a live login.

Production mode dispatch is exercised on the isolated _test database. Production
configuration/TLS guards are tested separately; no environment guard is disabled
in application code.
"""

import time
from dataclasses import replace
from types import SimpleNamespace

import pytest
from app.clerk_identity import ClerkAuthenticationError, ClerkProductionIdentity
from app.config import settings
from app.security import token_hash
from conftest import owner
from sqlalchemy import text

from app import clerk_routes

ORIGIN = "https://testserver"
ISSUER = "https://clerk.geoforest.example"


@pytest.fixture
def live(client, monkeypatch):
    monkeypatch.setattr(settings(), "auth_provider", "clerk_production")
    monkeypatch.setattr(settings(), "clerk_issuer", ISSUER)
    monkeypatch.setattr(settings(), "public_origin", ORIGIN)
    monkeypatch.setattr(settings(), "admin_acr", "clerk-mfa")
    client.base_url = ORIGIN
    state = SimpleNamespace(
        identity=ClerkProductionIdentity(
            ISSUER,
            "user_fiction",
            "sess_fiction",
            "fiction@example.invalid",
            "Personne fictive",
            int(time.time()) + 55,
            int(time.time()) + 300,
            True,
        ),
        calls=0,
        fail=False,
    )

    def verify(token):
        assert token == "fictional-proof"
        state.calls += 1
        if state.fail:
            raise ClerkAuthenticationError("private detail must not escape")
        return state.identity

    monkeypatch.setattr(
        clerk_routes, "verifier", lambda: SimpleNamespace(verify=verify)
    )
    return state


def exchange(client, **headers):
    return client.post(
        "/api/auth/clerk/exchange",
        headers={
            "Origin": ORIGIN,
            "Authorization": "Bearer fictional-proof",
            **headers,
        },
        json={"role": "Admin", "org_id": "forged"},
    )


def create_org(client, csrf):
    return client.post(
        "/api/v1/organizations",
        json={"name": "Organisation fictive"},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )


def test_live_bridge_cookies_identity_and_no_auto_permissions(client, live):
    response = exchange(client)
    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert (
        "__host-gft-session=" in cookie and "secure" in cookie and "httponly" in cookie
    )
    assert "domain=" not in cookie and "samesite=lax" in cookie and "path=/" in cookie
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/api/v1/me").json()["organizations"] == []
    assert client.get("/api/v1/me").json()["admin_mfa_satisfied"] is True
    with owner.connect() as conn:
        row = conn.execute(text("SELECT * FROM sessions")).mappings().one()
        assert (
            row["acr"]
            == f"clerk-production:sess_fiction:{live.identity.mfa_expires_at}"
        )
        assert row["token_hash"] != client.cookies.get(settings().session_cookie)
        assert conn.execute(text("SELECT count(*) FROM memberships")).scalar() == 0


def test_mfa_authorizes_explicit_org_creation_not_arbitrary_tenant(
    client, live, identity, org
):
    other = org(identity()["id"])
    csrf = exchange(client).json()["csrf_token"]
    assert client.get(f"/api/v1/organizations/{other}/members").status_code == 404
    assert create_org(client, csrf).status_code == 201


def test_same_email_is_not_account_merging(client, live, identity):
    existing = identity(email=live.identity.email)
    assert exchange(client).json()["user_id"] != str(existing["id"])
    with owner.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM users")).scalar() == 2


@pytest.mark.parametrize("deadline", [0, -1])
def test_missing_or_stale_mfa_still_allows_identity_but_not_admin(
    client, live, deadline
):
    live.identity = replace(
        live.identity, mfa_expires_at=0 if deadline == 0 else int(time.time()) - 1
    )
    csrf = exchange(client).json()["csrf_token"]
    assert client.get("/api/v1/me").status_code == 200
    assert client.get("/api/v1/me").json()["admin_mfa_satisfied"] is False
    assert create_org(client, csrf).status_code == 403


def test_mfa_expires_even_while_application_cookie_is_valid(client, live):
    csrf = exchange(client).json()["csrf_token"]
    with owner.begin() as conn:
        conn.execute(text("UPDATE sessions SET acr='clerk-production:sess_fiction:1'"))
    assert client.get("/api/v1/me").status_code == 200
    assert client.get("/api/v1/me").json()["admin_mfa_satisfied"] is False
    assert create_org(client, csrf).status_code == 403


def test_mfa_downgrade_updates_server_state_without_changing_csrf(client, live):
    one = exchange(client).json()
    cookie = client.cookies.get(settings().session_cookie)
    live.identity = replace(live.identity, mfa_expires_at=0, mfa_enrolled=False)
    two = exchange(client).json()
    assert one["csrf_token"] == two["csrf_token"]
    assert client.cookies.get(settings().session_cookie) == cookie
    assert create_org(client, two["csrf_token"]).status_code == 403


def test_session_id_change_rotates_cookie_and_revokes_previous(client, live):
    one = exchange(client).json()
    previous = client.cookies.get(settings().session_cookie)
    live.identity = replace(live.identity, session_id="sess_other")
    two = exchange(client).json()
    assert one["user_id"] == two["user_id"]
    assert one["csrf_token"] != two["csrf_token"]
    assert previous != client.cookies.get(settings().session_cookie)
    with owner.connect() as conn:
        assert conn.execute(
            text("SELECT revoked_at IS NOT NULL FROM sessions WHERE token_hash=:h"),
            {"h": token_hash(previous)},
        ).scalar()


def test_live_cookie_rejected_in_other_provider_modes(client, live, monkeypatch):
    exchange(client)
    for mode in ("oidc", "clerk_development"):
        monkeypatch.setattr(settings(), "auth_provider", mode)
        assert client.get("/api/v1/me").status_code == 401


@pytest.mark.parametrize(
    "marker",
    ["clerk-development", "clerk-mfa", "clerk-production:invalid:100000000000"],
)
def test_invalid_marker_cannot_grant_production_identity(client, live, marker):
    exchange(client)
    with owner.begin() as conn:
        conn.execute(text("UPDATE sessions SET acr=:a"), {"a": marker})
    assert client.get("/api/v1/me").status_code == 401


def test_identity_issuer_mismatch_rejected(client, live):
    exchange(client)
    with owner.begin() as conn:
        conn.execute(text("UPDATE users SET issuer='https://wrong.example'"))
    assert client.get("/api/v1/me").status_code == 401


def test_revocation_outage_and_hard_sixty_second_expiry(client, live):
    live.identity = replace(live.identity, expires_at=int(time.time()) + 300)
    assert exchange(client).json()["expires_at"] <= int(time.time()) + 60
    live.fail = True
    result = exchange(client)
    assert result.status_code == 401 and "private" not in result.text
    with owner.begin() as conn:
        conn.execute(text("UPDATE sessions SET expires_at=now()-interval '1 second'"))
    assert client.get("/api/v1/me").status_code == 401


def test_logout_revokes_session_and_rejects_delayed_refresh(client, live):
    exchange(client)
    cookie = client.cookies.get(settings().session_cookie)
    result = client.post(
        "/api/auth/clerk/logout", headers={"Origin": ORIGIN, "X-GFT-Logout": "1"}
    )
    assert result.status_code == 204
    assert client.get("/api/v1/me").status_code == 401
    result = exchange(client, Cookie=f"{settings().session_cookie}={cookie}")
    assert result.status_code == 401


@pytest.mark.parametrize("route", ["exchange", "assurance", "logout"])
def test_production_origin_rejected_before_verifier(client, live, route):
    result = client.post(
        f"/api/auth/clerk/{route}",
        headers={
            "Origin": "https://evil.example",
            "Authorization": "Bearer fictional-proof",
            "X-GFT-Logout": "1",
        },
    )
    assert result.status_code == 403 and live.calls == 0


def test_csrf_still_enforced_after_mfa(client, live):
    exchange(client)
    assert create_org(client, "forged-csrf").status_code == 403


def test_assurance_success_does_not_create_or_elevate_database_session(client, live):
    response = client.post(
        "/api/auth/clerk/assurance",
        headers={"Origin": ORIGIN, "Authorization": "Bearer fictional-proof"},
    )
    assert response.status_code == 200 and response.json() == {"verified": True}
    with owner.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM sessions")).scalar() == 0


def test_assurance_returns_sdk_reverification_contract(client, live):
    live.identity = replace(live.identity, mfa_expires_at=0)
    response = client.post(
        "/api/auth/clerk/assurance",
        headers={"Origin": ORIGIN, "Authorization": "Bearer fictional-proof"},
    )
    assert response.status_code == 403
    assert response.json()["clerk_error"]["metadata"]["reverification"] == {
        "level": "multi_factor",
        "afterMinutes": 5,
    }


def test_no_factor_enrollment_never_downgrades_to_single_factor(client, live):
    live.identity = replace(live.identity, mfa_expires_at=0, mfa_enrolled=False)
    response = client.post(
        "/api/auth/clerk/assurance",
        headers={"Origin": ORIGIN, "Authorization": "Bearer fictional-proof"},
    )
    assert response.status_code == 403 and "clerk_error" not in response.json()


def test_production_oidc_endpoints_are_not_used(client, live):
    assert (
        client.get("/api/auth/login", follow_redirects=False).headers["location"]
        == "/sign-in"
    )
    assert client.get("/api/auth/callback").status_code == 404
