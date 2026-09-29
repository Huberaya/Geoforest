from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", hide_input_in_errors=True
    )
    app_env: str = "development"
    database_url: str = Field(repr=False)
    public_origin: str = "http://localhost:3000"
    allowed_hosts: str = "localhost,127.0.0.1,backend,testserver"
    oidc_issuer: str = "http://localhost:8080/realms/geoforest"
    oidc_backchannel_origin: str = ""
    oidc_client_id: str = "geoforest"
    oidc_client_secret: str = Field(default="", repr=False)
    auth_provider: Literal["oidc", "clerk_development", "clerk_production"] = "oidc"
    clerk_issuer: str = ""
    clerk_secret_key: str = Field(default="", repr=False)
    session_secret: str = Field(repr=False)
    session_hours: int = 8
    admin_acr: str = ""
    max_body_bytes: int = 65536
    forest_analysis_enabled: bool = False
    documents_enabled: bool = False
    diligence_enabled: bool = False
    document_storage_root: str = "/var/lib/geoforest/documents"
    clamav_executable: str = "/usr/local/bin/clamscan"
    clamav_database: str = "/var/lib/clamav"
    clamav_library_path: str = ""
    document_quota_bytes: int = 512 * 1024 * 1024

    @model_validator(mode="after")
    def secure_config(self):
        if len(self.session_secret) < 32:
            raise ValueError("SESSION_SECRET must contain at least 32 characters")
        if self.app_env not in {"development", "test", "production"}:
            raise ValueError("Invalid APP_ENV")
        if not 1 <= self.session_hours <= 24:
            raise ValueError("SESSION_HOURS must be 1..24")
        if self.auth_provider == "clerk_development":
            from app.clerk_identity import ClerkDevelopmentConfig

            ClerkDevelopmentConfig(
                self.clerk_issuer, self.public_origin, self.clerk_secret_key
            )
            db = make_url(self.database_url)
            if (
                self.app_env == "production"
                or db.host not in {"127.0.0.1", "localhost"}
                or not (db.database or "").endswith("_test")
                or db.query
                or self.admin_acr
            ):
                raise ValueError(
                    "Clerk development requires a local _test database, no DB query overrides, no ADMIN_ACR and a non-production environment"
                )
        elif self.auth_provider == "clerk_production":
            from app.clerk_identity import ClerkProductionConfig

            ClerkProductionConfig(
                self.clerk_issuer, self.public_origin, self.clerk_secret_key
            )
            if self.app_env != "production" or self.admin_acr != "clerk-mfa":
                raise ValueError(
                    "Clerk production requires APP_ENV=production and ADMIN_ACR=clerk-mfa"
                )
        elif not self.oidc_client_secret:
            raise ValueError("OIDC_CLIENT_SECRET required for OIDC")
        if self.app_env == "production":

            def https_url(value, *, origin=False):
                try:
                    u = urlsplit(value)
                    valid = (
                        u.scheme == "https"
                        and bool(u.hostname)
                        and u.username is None
                        and u.password is None
                        and not u.query
                        and not u.fragment
                        and not any(c.isspace() or ord(c) < 32 for c in value)
                        and not (origin and u.path)
                    )
                    _ = u.port  # Reject invalid ports rather than failing during login.
                except ValueError:
                    valid = False
                if not valid:
                    raise ValueError(
                        "Production URL must be a valid HTTPS URL without credentials/query/fragment; PUBLIC_ORIGIN has no path"
                    )
                return u

            public = https_url(self.public_origin, origin=True)
            if self.auth_provider == "oidc":
                https_url(self.oidc_issuer)
                if self.oidc_backchannel_origin:
                    https_url(self.oidc_backchannel_origin, origin=True)
            hosts = self.allowed_hosts.split(",")
            if (
                not hosts
                or any(
                    not h or h != h.strip() or "*" in h or "/" in h or ":" in h
                    for h in hosts
                )
                or public.hostname not in hosts
                or not self.admin_acr.strip()
            ):
                raise ValueError(
                    "Production requires explicit hostnames including PUBLIC_ORIGIN and a nonblank ADMIN_ACR"
                )
            identity_secret = (
                self.clerk_secret_key
                if self.auth_provider == "clerk_production"
                else self.oidc_client_secret
            )
            secrets = (self.session_secret, identity_secret)
            if any(
                len(v) < 32 or "change_me" in v.lower() or v != v.strip()
                for v in secrets
            ):
                raise ValueError(
                    "Production requires distinct, non-placeholder secrets of at least 32 characters"
                )
            if self.session_secret == identity_secret:
                raise ValueError("Session and identity secrets must be distinct")
            try:
                db = make_url(self.database_url)
                valid_db = (
                    db.drivername == "postgresql+psycopg"
                    and bool(db.host and db.database and db.username and db.password)
                    and db.username not in {"postgres", "geoforest_migrator"}
                    and db.query.get("sslmode") == "verify-full"
                    and bool(db.query.get("sslrootcert"))
                    and not any(
                        k in db.query
                        for k in (
                            "host",
                            "hostaddr",
                            "user",
                            "password",
                            "dbname",
                            "service",
                        )
                    )
                )
            except Exception:
                valid_db = False
            if not valid_db:
                raise ValueError(
                    "Production DB requires a runtime role, PostgreSQL psycopg, explicit host/database and TLS verify-full with sslrootcert"
                )
        return self

    @property
    def secure_cookie(self):
        return self.public_origin.startswith("https://")

    @property
    def portal_cookie(self):
        return "__Host-gft-supplier" if self.secure_cookie else "gft-supplier"

    @property
    def session_cookie(self):
        return "__Host-gft-session" if self.secure_cookie else "gft-session"


@lru_cache
def settings():
    return Settings()
