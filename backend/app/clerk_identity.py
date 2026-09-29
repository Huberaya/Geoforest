"""Clerk identity verification shared by isolated development and production modes.

No DB writes, tenant provisioning, role mapping or persistent GeoForest session.
An identity is valid only for the checked request; do not turn it into an
unbounded local session without revalidation of Clerk revocation.
"""

import re
import time
from dataclasses import dataclass, field
from threading import BoundedSemaphore, Lock
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


def production_origin(value: str) -> str:
    """Canonical HTTPS DNS origin only; no development/shared Vercel domains.

    DNS ownership and Clerk certificates must still be checked at deployment.
    Standard Clerk custom domain only; satellite/proxy configurations are out of scope.
    """
    if not re.fullmatch(r"https://[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?", value):
        raise ValueError("Production Clerk requires a canonical HTTPS domain")
    host = urlsplit(value).hostname
    if (
        not host
        or "." not in host
        or len(host) > 253
        or any(
            not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
            for label in host.split(".")
        )
        or host.replace(".", "").isdigit()
        or host.endswith((".localhost", ".local", ".clerk.accounts.dev", ".vercel.app"))
    ):
        raise ValueError("Production Clerk requires an owned DNS domain")
    return host


@dataclass(frozen=True)
class ClerkProductionConfig:
    issuer: str
    public_origin: str
    secret_key: str = field(repr=False)

    def __post_init__(self):
        issuer_host = production_origin(self.issuer)
        origin_host = production_origin(self.public_origin)
        domain = issuer_host.removeprefix("clerk.")
        if (
            not issuer_host.startswith("clerk.")
            or not (origin_host == domain or origin_host.endswith("." + domain))
            or origin_host == issuer_host
            or not re.fullmatch(r"sk_live_[A-Za-z0-9_-]+", self.secret_key)
        ):
            raise ValueError("Invalid Clerk production configuration")


@dataclass(frozen=True)
class ClerkIdentity:
    issuer: str
    subject: str
    session_id: str
    email: str
    display_name: str
    expires_at: int
    # No role, organization, acr or metadata imported from Clerk.


class ClerkVerifier:
    def __init__(
        self,
        config: ClerkDevelopmentConfig | ClerkProductionConfig,
        client: httpx.Client,
    ):
        self.config = config
        self.client = client
        self._slots = BoundedSemaphore(4)
        self._cache_lock = Lock()
        self._jwks = None
        self._cache_until = 0.0

    def _get(self, path, *, authenticated=False, deadline=None):
        remaining = (deadline - time.monotonic()) if deadline is not None else 5
        if remaining <= 0:
            raise ValueError("Identity verification budget exhausted")
        base = "https://api.clerk.com/v1" if authenticated else self.config.issuer
        headers = {"Accept": "application/json", "User-Agent": "GeoForest-Clerk/0.8"}
        if authenticated:
            headers["Authorization"] = "Bearer " + self.config.secret_key
        with self.client.stream(
            "GET",
            base + path,
            headers=headers,
            timeout=min(3, remaining),
            follow_redirects=False,
        ) as response:
            if response.status_code != 200:
                raise ValueError("Identity service unavailable")
            size = 0
            chunks = []
            for chunk in response.iter_bytes():
                if deadline is not None and time.monotonic() > deadline:
                    raise ValueError("Identity verification budget exhausted")
                size += len(chunk)
                if size > 131072:
                    raise ValueError("Identity response too large")
                chunks.append(chunk)
            import json

            data = json.loads(b"".join(chunks))
            if not isinstance(data, dict):
                raise ValueError("Invalid identity response")
            return data

    def _keys(self, deadline):
        if not self._cache_lock.acquire(timeout=0.5):
            raise ValueError("Identity key cache busy")
        try:
            if self._jwks is None or time.monotonic() >= self._cache_until:
                data = self._fetch_keys(deadline)
                if (
                    not isinstance(data.get("keys"), list)
                    or not 1 <= len(data["keys"]) <= 64
                ):
                    raise ValueError("Invalid identity keys")
                self._jwks = data
                self._cache_until = time.monotonic() + 60
            return self._jwks
        finally:
            self._cache_lock.release()

    def _fetch_keys(self, deadline):
        return self._get("/.well-known/jwks.json", deadline=deadline)

    def _identity(self, claims, email, name, user):
        return ClerkIdentity(
            self.config.issuer, claims["sub"], claims["sid"], email, name, claims["exp"]
        )

    def verify(self, token: str) -> ClerkIdentity:
        if not self._slots.acquire(blocking=False):
            raise ClerkAuthenticationError("Clerk identity could not be verified")
        try:
            return self._verify(token)
        finally:
            self._slots.release()

    def _verify(self, token: str) -> ClerkIdentity:
        deadline = time.monotonic() + 10
        try:
            if not isinstance(token, str) or not 1 <= len(token) <= 16384:
                raise ValueError("Invalid token")
            claims = JsonWebToken(["RS256"]).decode(token, self._keys(deadline))
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
            session = self._get(
                "/sessions/" + claims["sid"], authenticated=True, deadline=deadline
            )
            if (
                session.get("id") != claims["sid"]
                or session.get("user_id") != claims["sub"]
                or session.get("status") != "active"
            ):
                raise ValueError("Session not active")
            user = self._get(
                "/users/" + claims["sub"], authenticated=True, deadline=deadline
            )
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
            if time.monotonic() > deadline or claims["exp"] <= int(time.time()) - 5:
                raise ValueError("Token expired during verification")
            return self._identity(claims, email, name, user)
        except Exception:
            raise ClerkAuthenticationError(
                "Clerk identity could not be verified"
            ) from None


class ClerkDevelopmentVerifier(ClerkVerifier):
    """Retains the local-only configuration contract; no MFA asserted."""


@dataclass(frozen=True)
class ClerkProductionIdentity(ClerkIdentity):
    mfa_expires_at: int
    mfa_enrolled: bool


class ClerkProductionVerifier(ClerkVerifier):
    def _fetch_keys(self, deadline):
        # Keys and online session/user checks belong to the same live instance.
        # Never send the secret to the configurable Frontend API host.
        return self._get("/jwks", authenticated=True, deadline=deadline)

    def _identity(self, claims, email, name, user):
        if user.get("banned") is not False or user.get("locked") is not False:
            raise ValueError("Explicit active production profile required")
        ages = claims.get("fva")
        if (
            not isinstance(ages, list)
            or len(ages) != 2
            or any(type(age) is not int or not -1 <= age <= 2147483647 for age in ages)
        ):
            raise ValueError("Valid factor verification ages required")
        enrolled = user.get("two_factor_enabled") is True
        until = 0
        if enrolled and all(0 <= age < 10 for age in ages):
            # fva is rounded to minutes: use the oldest possible verification.
            # JWT issuance, not refresh wall-clock time, anchors the deadline.
            until = max(0, claims["iat"] + (10 - max(ages) - 1) * 60 - 5)
        return ClerkProductionIdentity(
            self.config.issuer,
            claims["sub"],
            claims["sid"],
            email,
            name,
            claims["exp"],
            until,
            enrolled,
        )


def production_marker(identity: ClerkProductionIdentity) -> str:
    return f"clerk-production:{identity.session_id}:{identity.mfa_expires_at}"


def parse_production_marker(value: str):
    match = re.fullmatch(
        r"clerk-production:(sess_[A-Za-z0-9]{1,128}):([0-9]{1,12})", value
    )
    return (match[1], int(match[2])) if match else None
