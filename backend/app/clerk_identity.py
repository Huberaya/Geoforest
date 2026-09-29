"""Development-only Clerk identity verifier. Not yet mounted on HTTP routes.

No DB writes, tenant provisioning, role mapping or persistent GeoForest session.
An identity is valid only for the checked request; do not turn it into an
unbounded local session without revalidation of Clerk revocation.
"""

import re
import time
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx
from authlib.jose import JsonWebToken


class ClerkAuthenticationError(Exception):
    """Deliberately excludes tokens, profiles and upstream errors."""


@dataclass(frozen=True)
class ClerkDevelopmentConfig:
    issuer: str
    public_origin: str
    secret_key: str = field(repr=False)

    def __post_init__(self):
        origin = urlsplit(self.public_origin)
        if (
            not re.fullmatch(r"https://[a-z0-9-]+\.clerk\.accounts\.dev", self.issuer)
            or not re.fullmatch(r"sk_test_[A-Za-z0-9_-]+", self.secret_key)
            or not origin.hostname
            or origin.username is not None
            or origin.password is not None
            or origin.path
            or origin.query
            or origin.fragment
            or any(c.isspace() for c in self.public_origin)
            or not (
                origin.scheme == "https"
                or (
                    origin.scheme == "http"
                    and origin.hostname in {"localhost", "127.0.0.1"}
                )
            )
        ):
            raise ValueError("Invalid Clerk development configuration")
        _ = origin.port


@dataclass(frozen=True)
class ClerkIdentity:
    issuer: str
    subject: str
    session_id: str
    email: str
    display_name: str
    expires_at: int
    # No role, organization, acr or metadata imported from Clerk.


class ClerkDevelopmentVerifier:
    def __init__(self, config: ClerkDevelopmentConfig, client: httpx.Client):
        self.config = config
        self.client = client

    def _get(self, path, *, authenticated=False):
        base = "https://api.clerk.com/v1" if authenticated else self.config.issuer
        headers = {"Accept": "application/json", "User-Agent": "GeoForest-Clerk/0.8"}
        if authenticated:
            headers["Authorization"] = "Bearer " + self.config.secret_key
        with self.client.stream(
            "GET", base + path, headers=headers, timeout=5, follow_redirects=False
        ) as response:
            if response.status_code != 200:
                raise ValueError("Identity service unavailable")
            size = 0
            chunks = []
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > 131072:
                    raise ValueError("Identity response too large")
                chunks.append(chunk)
            import json

            data = json.loads(b"".join(chunks))
            if not isinstance(data, dict):
                raise ValueError("Invalid identity response")
            return data

    def verify(self, token: str) -> ClerkIdentity:
        try:
            if not isinstance(token, str) or not 1 <= len(token) <= 16384:
                raise ValueError("Invalid token")
            claims = JsonWebToken(["RS256"]).decode(
                token, self._get("/.well-known/jwks.json")
            )
            now = int(time.time())
            claims.validate(now=now, leeway=5)
            if (
                claims.header.get("alg") != "RS256"
                or not claims.header.get("kid")
                or claims.get("iss") != self.config.issuer
                or claims.get("azp") != self.config.public_origin
                or type(claims.get("v")) is not int
                or claims["v"] != 2
                or claims.get("sts", "active") != "active"
                or "act" in claims  # Actor/impersonation tokens are out of scope.
                or not isinstance(claims.get("sub"), str)
                or not re.fullmatch(r"user_[A-Za-z0-9]{1,128}", claims["sub"])
                or not isinstance(claims.get("sid"), str)
                or not re.fullmatch(r"sess_[A-Za-z0-9]{1,128}", claims["sid"])
            ):
                raise ValueError("Invalid identity claims")
            if any(type(claims.get(k)) is not int for k in ("iat", "nbf", "exp")):
                raise ValueError("Invalid timestamps")
            if not (
                claims["iat"] <= now + 5
                and claims["nbf"] <= now + 5
                and now - 5 < claims["exp"]
                and 0 < claims["exp"] - claims["iat"] <= 300
                and claims["nbf"] <= claims["exp"]
            ):
                raise ValueError("Token outside accepted lifetime")
            session = self._get("/sessions/" + claims["sid"], authenticated=True)
            if (
                session.get("id") != claims["sid"]
                or session.get("user_id") != claims["sub"]
                or session.get("status") != "active"
            ):
                raise ValueError("Session not active")
            user = self._get("/users/" + claims["sub"], authenticated=True)
            if (
                user.get("id") != claims["sub"]
                or user.get("banned")
                or user.get("locked")
            ):
                raise ValueError("User unavailable")
            primary = user.get("primary_email_address_id")
            emails = user.get("email_addresses", [])
            email = next(
                e["email_address"]
                for e in emails
                if primary
                and e.get("id") == primary
                and e.get("verification", {}).get("status") == "verified"
            )
            if (
                not isinstance(email, str)
                or not 3 <= len(email) <= 320
                or "@" not in email
            ):
                raise ValueError("Verified primary email required")
            name = (
                " ".join(
                    x for x in (user.get("first_name"), user.get("last_name")) if x
                )
                or email
            )
            if len(name) > 200 or any(ord(c) < 32 for c in email + name):
                raise ValueError("Invalid identity profile")
            if claims["exp"] <= int(time.time()) - 5:
                raise ValueError("Token expired during verification")
            return ClerkIdentity(
                self.config.issuer,
                claims["sub"],
                claims["sid"],
                email,
                name,
                claims["exp"],
            )
        except Exception:
            raise ClerkAuthenticationError(
                "Clerk identity could not be verified"
            ) from None
