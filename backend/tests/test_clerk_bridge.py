import time
from dataclasses import replace
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from app.clerk_identity import ClerkAuthenticationError, ClerkIdentity
from app.config import Settings, settings
from app.security import token_hash
from conftest import owner
from sqlalchemy import text

from app import clerk_routes

ORIGIN = "http://localhost:3000"
ISSUER = "https://synthetic.clerk.accounts.dev"


@pytest.fixture
def clerk(monkeypatch):
    monkeypatch.setattr(settings(), "auth_provider", "clerk_development")
    monkeypatch.setattr(settings(), "clerk_issuer", ISSUER)
    identity = ClerkIdentity(
        ISSUER,
        "user_synthetic",
        "sess_synthetic",
        "clerk@example.invalid",
        "Personne fictive",
        int(time.time()) + 55,
    )
    state = SimpleNamespace(identity=identity, calls=0, fail=False)

    def verify(token):
        state.calls += 1
        assert token == "synthetic-token"
        if state.fail:
            raise ClerkAuthenticationError("synthetic provider outage")
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
            "Authorization": "Bearer synthetic-token",
            **headers,
        },
    )


def test_disabled_by_default(client):
    assert exchange(client).status_code == 404
    assert (
        client.post(
            "/api/auth/clerk/logout", headers={"Origin": ORIGIN, "X-GFT-Logout": "1"}
        ).status_code
        == 404
    )


def test_login_and_oidc_disabled(client, clerk):
    response = client.get("/api/auth/login", follow_redirects=False)
    assert response.status_code == 303 and response.headers["location"] == "/sign-in"
    assert client.get("/api/auth/callback").status_code == 404


def test_new_identity_cookie_and_no_auto_roles(client, clerk):
    r = exchange(client)
    assert r.status_code == 200
    assert "httponly" in r.headers["set-cookie"].lower()
    assert "samesite=lax" in r.headers["set-cookie"].lower()
    assert r.json()["expires_at"] <= clerk.identity.expires_at
    me = client.get("/api/v1/me").json()
    assert me["user"]["email"] == "clerk@example.invalid"
    assert me["organizations"] == []
    assert me["csrf_token"] == r.json()["csrf_token"]
    with owner.connect() as conn:
        row = conn.execute(text("SELECT * FROM sessions")).mappings().one()
        assert row["expires_at"] <= datetime.fromtimestamp(
            clerk.identity.expires_at, timezone.utc
        )
        assert row["token_hash"] != client.cookies.get(settings().session_cookie)
        assert row["acr"] == "clerk-development"
        assert conn.execute(text("SELECT count(*) FROM memberships")).scalar_one() == 0


def test_renewal_preserves_cookie_csrf_and_limits_lifetime(client, clerk):
    first = exchange(client)
    cookie = client.cookies.get(settings().session_cookie)
    clerk.identity = replace(clerk.identity, expires_at=int(time.time()) + 300)
    second = exchange(client)
    assert first.json()["csrf_token"] == second.json()["csrf_token"]
    assert client.cookies.get(settings().session_cookie) == cookie
    assert second.json()["expires_at"] <= int(time.time()) + 60
    assert clerk.calls == 2
    with owner.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM sessions")).scalar_one() == 1


def test_forged_role_ignored_and_csrf_enforced(client, clerk):
    r = client.post(
        "/api/auth/clerk/exchange",
        headers={"Origin": ORIGIN, "Authorization": "Bearer synthetic-token"},
        json={"role": "Admin", "org_id": "forged", "email": "forged@example.invalid"},
    )
    assert r.status_code == 200
    assert client.get("/api/v1/me").json()["organizations"] == []
    assert (
        client.post(
            "/api/v1/organizations",
            json={"name": "Organisation fictive"},
            headers={"Origin": ORIGIN},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/organizations",
            json={"name": "Organisation fictive"},
            headers={"Origin": ORIGIN, "X-CSRF-Token": r.json()["csrf_token"]},
        ).status_code
        == 201
    )


@pytest.mark.parametrize("origin", [None, "null", "https://evil.invalid", ORIGIN + "/"])
def test_exchange_origin_before_verification(client, clerk, origin):
    headers = {"Authorization": "Bearer synthetic-token"}
    if origin is not None:
        headers["Origin"] = origin
    assert client.post("/api/auth/clerk/exchange", headers=headers).status_code == 403
    assert clerk.calls == 0


@pytest.mark.parametrize("value", ["", "Basic synthetic", "Bearer " + "a" * 16400])
def test_invalid_authorization(client, clerk, value):
    assert exchange(client, Authorization=value).status_code == 401
    assert clerk.calls == 0


@pytest.mark.parametrize("remaining", [-1, 0, 5, 9])
def test_expired_or_nearly_expired_proof(client, clerk, remaining):
    clerk.identity = replace(clerk.identity, expires_at=int(time.time()) + remaining)
    assert exchange(client).status_code == 401
    with owner.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM users")).scalar_one() == 0


def test_fail_closed_and_existing_cookie_expires(client, clerk):
    exchange(client)
    clerk.fail = True
    r = exchange(client)
    assert r.status_code == 401 and "outage" not in r.text
    with owner.begin() as conn:
        conn.execute(text("UPDATE sessions SET expires_at=now()-interval '1 second'"))
    assert client.get("/api/v1/me").status_code == 401


def test_logout_revocation_and_queued_renewal(client, clerk):
    exchange(client)
    cookie = client.cookies.get(settings().session_cookie)
    r = client.post(
        "/api/auth/clerk/logout", headers={"Origin": ORIGIN, "X-GFT-Logout": "1"}
    )
    assert r.status_code == 204
    assert client.get("/api/v1/me").status_code == 401
    client.cookies.set(settings().session_cookie, cookie)
    assert exchange(client).status_code == 401
    with owner.connect() as conn:
        assert (
            conn.execute(
                text("SELECT revoked_at FROM sessions WHERE token_hash=:h"),
                {"h": token_hash(cookie)},
            ).scalar_one()
            is not None
        )


def test_logout_expired_and_idempotent(client, clerk):
    exchange(client)
    with owner.begin() as conn:
        conn.execute(text("UPDATE sessions SET expires_at=now()-interval '1 second'"))
    for _ in range(2):
        assert (
            client.post(
                "/api/auth/clerk/logout",
                headers={"Origin": ORIGIN, "X-GFT-Logout": "1"},
            ).status_code
            == 204
        )


@pytest.mark.parametrize(
    "headers",
    [{}, {"Origin": ORIGIN}, {"Origin": "https://evil.invalid", "X-GFT-Logout": "1"}],
)
def test_logout_csrf(client, clerk, headers):
    exchange(client)
    assert client.post("/api/auth/clerk/logout", headers=headers).status_code == 403
    assert client.get("/api/v1/me").status_code == 200


def test_no_email_merge_and_no_cross_tenant_access(client, clerk, identity):
    other = identity(email=clerk.identity.email)
    with owner.begin() as conn:
        conn.execute(
            text("SELECT set_config('app.user_id', :u, true)"), {"u": str(other["id"])}
        )
        org = conn.execute(
            text("SELECT authz.create_organization('Organisation autre fictive')")
        ).scalar_one()
    result = exchange(client)
    assert result.json()["user_id"] != str(other["id"])
    assert client.get("/api/v1/me").json()["organizations"] == []
    assert client.get(f"/api/v1/organizations/{org}/members").status_code == 404
    with owner.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM users")).scalar_one() == 2


def test_subject_change_rotates_session(client, clerk):
    one = exchange(client)
    old = client.cookies.get(settings().session_cookie)
    clerk.identity = replace(clerk.identity, subject="user_other")
    two = exchange(client)
    assert one.json()["user_id"] != two.json()["user_id"]
    assert one.json()["csrf_token"] != two.json()["csrf_token"]
    assert old != client.cookies.get(settings().session_cookie)


def test_legacy_cookie_not_accepted_in_clerk_mode(client, clerk, identity, signin):
    signin(client, identity())
    assert client.get("/api/v1/me").status_code == 401


def test_clerk_cookie_not_accepted_when_oidc_selected(client, clerk, monkeypatch):
    exchange(client)
    monkeypatch.setattr(settings(), "auth_provider", "oidc")
    assert client.get("/api/v1/me").status_code == 401


def test_rate_limit_precedes_provider(client, clerk):
    for _ in range(30):
        assert exchange(client).status_code == 200
    assert exchange(client).status_code == 429
    assert clerk.calls == 30


def test_https_cookie_flags(client, clerk, monkeypatch):
    monkeypatch.setattr(settings(), "public_origin", "https://testserver")
    r = exchange(client, Origin="https://testserver")
    assert r.status_code == 200
    assert "__Host-gft-session=" in r.headers["set-cookie"]
    assert "secure" in r.headers["set-cookie"].lower()


def make_config(**overrides):
    return Settings(
        _env_file=None,
        **(
            {
                "app_env": "test",
                "auth_provider": "clerk_development",
                "database_url": "postgresql+psycopg://app:test@127.0.0.1/local_test",
                "public_origin": ORIGIN,
                "clerk_issuer": ISSUER,
                "clerk_secret_key": "sk_test_synthetic",
                "session_secret": "synthetic-session-secret-" + "a" * 32,
                "oidc_client_secret": "",
            }
            | overrides
        ),
    )


def test_valid_local_development_config():
    assert make_config().auth_provider == "clerk_development"
    assert "sk_test_synthetic" not in repr(make_config())


@pytest.mark.parametrize(
    "changes",
    [
        {"app_env": "production"},
        {"auth_provider": "typo"},
        {"database_url": "postgresql+psycopg://app:test@remote.invalid/local_test"},
        {"database_url": "postgresql+psycopg://app:test@127.0.0.1/production"},
        {
            "database_url": "postgresql+psycopg://app:test@127.0.0.1/local_test?host=remote.invalid"
        },
        {"clerk_secret_key": "sk_live_synthetic"},
        {"admin_acr": "clerk-development"},
    ],
)
def test_clerk_configuration_fail_closed(changes):
    with pytest.raises(ValueError):
        make_config(**changes)
