"""Production contracts with fictional domains, locally signed JWTs and mocked HTTP."""

import time
from dataclasses import asdict

import httpx
import pytest
from app.clerk_identity import (
    ClerkAuthenticationError,
    ClerkProductionConfig,
    ClerkProductionVerifier,
    parse_production_marker,
    production_marker,
)
from app.config import Settings
from authlib.jose import JsonWebKey, JsonWebToken

ISSUER = "https://clerk.geoforest.example"
ORIGIN = "https://app.geoforest.example"
SECRET = "sk_live_synthetic_not_a_real_secret_0000000000"


def configuration(**changes):
    return Settings(
        _env_file=None,
        **(
            {
                "app_env": "production",
                "auth_provider": "clerk_production",
                "database_url": "postgresql+psycopg://geoforest_app:fiction@db.example/geoforest?sslmode=verify-full&sslrootcert=/fiction/ca.pem",
                "session_secret": "synthetic-session-secret-" + "s" * 32,
                "public_origin": ORIGIN,
                "allowed_hosts": "app.geoforest.example",
                "clerk_issuer": ISSUER,
                "clerk_secret_key": SECRET,
                "admin_acr": "clerk-mfa",
                "oidc_client_secret": "",
            }
            | changes
        ),
    )


def test_production_config_needs_no_oidc_secret():
    assert configuration().secure_cookie
    assert configuration().session_cookie.startswith("__Host-")
    assert SECRET not in repr(configuration())


@pytest.mark.parametrize(
    "change",
    [
        {"app_env": "test"},
        {"app_env": "development"},
        {"auth_provider": "clerk_development"},
        {"admin_acr": ""},
        {"admin_acr": "clerk-development"},
        {"clerk_secret_key": "sk_test_fiction"},
        {"clerk_secret_key": "sk_live_short"},
        {"clerk_issuer": "https://dev.clerk.accounts.dev"},
        {"clerk_issuer": "https://clerk.other.example"},
        {"clerk_issuer": "https://clerk.geoforest.example/"},
        {"public_origin": "https://app.geoforest.example/"},
        {"public_origin": "http://app.geoforest.example"},
        {"public_origin": "https://app.vercel.app"},
        {"public_origin": "https://app.geoforest.example:443"},
        {"public_origin": "https://app.geoforest.example;script-src"},
        {"allowed_hosts": "*"},
        {"session_secret": SECRET},
        {
            "database_url": "postgresql+psycopg://geoforest_app:fiction@db.example/geoforest?sslmode=require"
        },
        {
            "database_url": "postgresql+psycopg://postgres:fiction@db.example/geoforest?sslmode=verify-full&sslrootcert=/fiction/ca.pem"
        },
    ],
)
def test_production_configuration_fails_closed(change):
    with pytest.raises(ValueError):
        configuration(**change)


@pytest.fixture
def live_harness():
    key = JsonWebKey.generate_key(
        "RSA", 2048, is_private=True, options={"kid": "fiction"}
    )
    now = int(time.time())
    state = {
        "claims": {
            "iss": ISSUER,
            "azp": ORIGIN,
            "sub": "user_fiction",
            "sid": "sess_fiction",
            "v": 2,
            "iat": now,
            "nbf": now,
            "exp": now + 60,
            "fva": [0, 0],
        },
        "session": {
            "id": "sess_fiction",
            "user_id": "user_fiction",
            "status": "active",
        },
        "user": {
            "id": "user_fiction",
            "banned": False,
            "locked": False,
            "two_factor_enabled": True,
            "primary_email_address_id": "email_fiction",
            "email_addresses": [
                {
                    "id": "email_fiction",
                    "email_address": "fiction@example.invalid",
                    "verification": {"status": "verified"},
                }
            ],
        },
        "calls": [],
        "status": 200,
    }

    def transport(request):
        assert request.url.host == "api.clerk.com"
        assert request.headers["authorization"] == "Bearer " + SECRET
        assert request.method == "GET"
        state["calls"].append(request.url.path)
        if request.url.path == "/v1/jwks":
            return httpx.Response(200, json={"keys": [key.as_dict(is_private=False)]})
        data = state["session"] if "/sessions/" in request.url.path else state["user"]
        return httpx.Response(state["status"], json=data)

    with httpx.Client(transport=httpx.MockTransport(transport)) as client:
        verifier = ClerkProductionVerifier(
            ClerkProductionConfig(ISSUER, ORIGIN, SECRET), client
        )

        def verify():
            token = (
                JsonWebToken(["RS256"])
                .encode({"alg": "RS256", "kid": "fiction"}, state["claims"], key)
                .decode()
            )
            return verifier.verify(token)

        yield state, verify


def test_production_identity_and_mfa_are_server_verified(live_harness):
    state, verify = live_harness
    state["claims"].update(
        {"role": "Admin", "o": {"id": "org_forged", "rol": "admin"}, "acr": "admin"}
    )
    identity = verify()
    assert identity.mfa_enrolled
    assert identity.mfa_expires_at == state["claims"]["iat"] + 535
    assert "role" not in asdict(identity) and "o" not in asdict(identity)
    assert parse_production_marker(production_marker(identity)) == (
        "sess_fiction",
        identity.mfa_expires_at,
    )
    assert state["calls"] == [
        "/v1/jwks",
        "/v1/sessions/sess_fiction",
        "/v1/users/user_fiction",
    ]


@pytest.mark.parametrize(
    "ages",
    [None, [], [0], [0, 0, 0], [True, 0], [0, "0"], [0, -2], [0.1, 0], [0, 2147483648]],
)
def test_malformed_factor_ages_rejected(live_harness, ages):
    state, verify = live_harness
    state["claims"]["fva"] = ages
    with pytest.raises(ClerkAuthenticationError):
        verify()


@pytest.mark.parametrize("ages", [[0, -1], [-1, 0], [10, 0], [0, 10], [1000, 0]])
def test_no_mfa_or_old_factor_does_not_grant_admin(live_harness, ages):
    state, verify = live_harness
    state["claims"]["fva"] = ages
    assert verify().mfa_expires_at == 0


def test_factor_removal_cannot_silently_downgrade_to_single_factor(live_harness):
    state, verify = live_harness
    state["user"]["two_factor_enabled"] = False
    assert not verify().mfa_enrolled
    assert verify().mfa_expires_at == 0


def test_replayed_proof_does_not_extend_mfa_window(live_harness):
    _, verify = live_harness
    assert verify().mfa_expires_at == verify().mfa_expires_at


@pytest.mark.parametrize(
    "field,value",
    [
        ("iss", "https://other.example"),
        ("azp", "https://evil.example"),
        ("act", {}),
        ("sts", "pending"),
        ("v", 1),
        ("exp", 1),
        ("sid", "sess_../../bad"),
    ],
)
def test_production_rejects_invalid_claims_before_online_session(
    live_harness, field, value
):
    state, verify = live_harness
    state["claims"][field] = value
    with pytest.raises(ClerkAuthenticationError):
        verify()
    assert state["calls"] == ["/v1/jwks"]


def test_live_revocation_is_rechecked(live_harness):
    state, verify = live_harness
    verify()
    state["session"]["status"] = "revoked"
    with pytest.raises(ClerkAuthenticationError):
        verify()
    assert state["calls"].count("/v1/jwks") == 1
    assert state["calls"].count("/v1/sessions/sess_fiction") == 2


@pytest.mark.parametrize("status", [301, 401, 429, 500])
def test_production_upstream_failure_is_closed(live_harness, status):
    state, verify = live_harness
    state["status"] = status
    with pytest.raises(ClerkAuthenticationError):
        verify()


@pytest.mark.parametrize(
    "value",
    [
        "clerk-development",
        "clerk-mfa",
        "clerk-production:sess_foo:-1",
        "clerk-production:sess_a:123:456",
    ],
)
def test_invalid_session_marker(value):
    assert parse_production_marker(value) is None
