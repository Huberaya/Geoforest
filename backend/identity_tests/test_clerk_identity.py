"""No DB fixtures, external connections, real keys or personal data."""

import time
from dataclasses import asdict

import httpx
import pytest
from app.clerk_identity import (
    ClerkAuthenticationError,
    ClerkDevelopmentConfig,
    ClerkDevelopmentVerifier,
)
from authlib.jose import JsonWebKey, JsonWebToken

ISSUER = "https://synthetic.clerk.accounts.dev"
ORIGIN = "http://localhost:3000"
SECRET = "sk_test_synthetic_not_a_real_secret"


@pytest.fixture
def harness():
    key = JsonWebKey.generate_key(
        "RSA", 2048, is_private=True, options={"kid": "fixture"}
    )
    now = int(time.time())
    state = {
        "claims": {
            "iss": ISSUER,
            "azp": ORIGIN,
            "sub": "user_synthetic",
            "sid": "sess_synthetic",
            "v": 2,
            "iat": now,
            "nbf": now,
            "exp": now + 60,
        },
        "session": {
            "id": "sess_synthetic",
            "user_id": "user_synthetic",
            "status": "active",
        },
        "user": {
            "id": "user_synthetic",
            "primary_email_address_id": "email_fixture",
            "email_addresses": [
                {
                    "id": "email_fixture",
                    "email_address": "test@example.invalid",
                    "verification": {"status": "verified"},
                }
            ],
            "first_name": "Personne",
            "last_name": "Fictive",
        },
        "calls": [],
        "http_status": 200,
    }

    def transport(request):
        state["calls"].append(request.url.path)
        if request.url.path == "/.well-known/jwks.json":
            assert "authorization" not in request.headers
            assert request.url.host == "synthetic.clerk.accounts.dev"
            return httpx.Response(200, json={"keys": [key.as_dict(is_private=False)]})
        assert request.url.host == "api.clerk.com"
        assert request.headers["authorization"] == "Bearer " + SECRET
        assert request.method == "GET"
        if state.get("timeout"):
            raise httpx.ReadTimeout("synthetic sensitive upstream detail")
        data = state["session"] if "/sessions/" in request.url.path else state["user"]
        return httpx.Response(
            state["http_status"],
            json=data,
            headers={"Location": "https://example.invalid"},
        )

    with httpx.Client(transport=httpx.MockTransport(transport)) as client:
        verifier = ClerkDevelopmentVerifier(
            ClerkDevelopmentConfig(ISSUER, ORIGIN, SECRET), client
        )

        def token():
            return (
                JsonWebToken(["RS256"])
                .encode({"alg": "RS256", "kid": "fixture"}, state["claims"], key)
                .decode()
            )

        yield state, verifier, token


def test_valid_identity_no_roles(harness):
    state, verifier, token = harness
    state["claims"].update(
        {
            "o": {"id": "org_evil", "rol": "admin"},
            "acr": "admin",
            "email": "untrusted@example.invalid",
        }
    )
    state["user"]["public_metadata"] = {"role": "Admin"}
    result = asdict(verifier.verify(token()))
    assert result["email"] == "test@example.invalid"
    assert set(result) == {
        "issuer",
        "subject",
        "session_id",
        "email",
        "display_name",
        "expires_at",
    }
    assert len(state["calls"]) == 3


@pytest.mark.parametrize(
    "field,value",
    [
        ("iss", "https://other.clerk.accounts.dev"),
        ("azp", "https://evil.invalid"),
        ("azp", None),
        ("sub", "user_../../evil"),
        ("sid", "sess_../../evil"),
        ("v", 1),
        ("v", True),
        ("sts", "pending"),
        ("act", {}),
        ("exp", 1),
        ("iat", 9999999999),
        ("nbf", 9999999999),
        ("iat", True),
        ("exp", "9999999999"),
        ("sub", None),
        ("sid", None),
    ],
)
def test_bad_claims(harness, field, value):
    state, verifier, token = harness
    state["claims"][field] = value
    with pytest.raises(ClerkAuthenticationError):
        verifier.verify(token())
    assert state["calls"] == ["/.well-known/jwks.json"]


@pytest.mark.parametrize(
    "field", ["iat", "nbf", "exp", "sub", "sid", "azp", "iss", "v"]
)
def test_missing_claims(harness, field):
    state, verifier, token = harness
    del state["claims"][field]
    with pytest.raises(ClerkAuthenticationError):
        verifier.verify(token())


def test_long_lifetime(harness):
    state, verifier, token = harness
    state["claims"]["exp"] += 3600
    with pytest.raises(ClerkAuthenticationError):
        verifier.verify(token())


@pytest.mark.parametrize(
    "status", ["revoked", "ended", "expired", "pending", "abandoned"]
)
def test_revocation(harness, status):
    state, verifier, token = harness
    state["session"]["status"] = status
    with pytest.raises(ClerkAuthenticationError):
        verifier.verify(token())
    assert len(state["calls"]) == 2


@pytest.mark.parametrize("field", ["user_id", "id"])
def test_session_binding(harness, field):
    state, verifier, token = harness
    state["session"][field] = "different"
    with pytest.raises(ClerkAuthenticationError):
        verifier.verify(token())


@pytest.mark.parametrize(
    "field,value",
    [
        ("banned", True),
        ("locked", True),
        ("id", "user_other"),
        ("primary_email_address_id", None),
        ("email_addresses", []),
        ("first_name", "x" * 201),
    ],
)
def test_unavailable_profile(harness, field, value):
    state, verifier, token = harness
    state["user"][field] = value
    with pytest.raises(ClerkAuthenticationError):
        verifier.verify(token())


def test_unverified_email(harness):
    state, verifier, token = harness
    state["user"]["email_addresses"][0]["verification"]["status"] = "unverified"
    with pytest.raises(ClerkAuthenticationError):
        verifier.verify(token())


@pytest.mark.parametrize("status", [301, 302, 401, 403, 429, 500])
def test_upstream_fail_closed(harness, status):
    state, verifier, token = harness
    state["http_status"] = status
    with pytest.raises(ClerkAuthenticationError) as exc:
        verifier.verify(token())
    assert str(exc.value) == "Clerk identity could not be verified"
    assert len(state["calls"]) == 2


def test_timeout_and_no_secret_in_repr(harness):
    state, verifier, token = harness
    state["timeout"] = True
    with pytest.raises(ClerkAuthenticationError) as exc:
        verifier.verify(token())
    assert "upstream" not in str(exc.value)
    assert SECRET not in repr(verifier.config)


@pytest.mark.parametrize("token", ["", "bad.token.value", "a" * 16385, None])
def test_malformed(harness, token):
    _, verifier, _ = harness
    with pytest.raises(ClerkAuthenticationError):
        verifier.verify(token)


def test_wrong_signature(harness):
    state, verifier, _ = harness
    other = JsonWebKey.generate_key("RSA", 2048, is_private=True)
    token = (
        JsonWebToken(["RS256"])
        .encode({"alg": "RS256", "kid": "fixture"}, state["claims"], other)
        .decode()
    )
    with pytest.raises(ClerkAuthenticationError):
        verifier.verify(token)
    assert len(state["calls"]) == 1


@pytest.mark.parametrize(
    "issuer,origin,key",
    [
        ("http://synthetic.clerk.accounts.dev", ORIGIN, SECRET),
        ("https://evil.invalid", ORIGIN, SECRET),
        (ISSUER, "http://external.invalid", SECRET),
        (ISSUER, ORIGIN + "/path", SECRET),
        (ISSUER, "https://user:password@example.invalid", SECRET),
        (ISSUER, ORIGIN, "sk_live_synthetic"),
    ],
)
def test_config_fail_closed(issuer, origin, key):
    with pytest.raises(ValueError):
        ClerkDevelopmentConfig(issuer, origin, key)


def test_symmetric_algorithm_rejected(harness):
    state, verifier, _ = harness
    token = (
        JsonWebToken(["HS256"])
        .encode(
            {"alg": "HS256", "kid": "fixture"},
            state["claims"],
            "synthetic-attacker-key",
        )
        .decode()
    )
    with pytest.raises(ClerkAuthenticationError):
        verifier.verify(token)
    assert state["calls"] == ["/.well-known/jwks.json"]


@pytest.mark.parametrize("body", [b"not-json", b"[]", b'{"keys":[]}', b"x" * 131073])
def test_invalid_or_oversized_jwks(harness, body):
    _, _, token = harness
    with httpx.Client(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, content=body))
    ) as client:
        verifier = ClerkDevelopmentVerifier(
            ClerkDevelopmentConfig(ISSUER, ORIGIN, SECRET), client
        )
        with pytest.raises(ClerkAuthenticationError):
            verifier.verify(token())
