from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_env: str = "development"
    database_url: str
    public_origin: str = "http://localhost:3000"
    allowed_hosts: str = "localhost,127.0.0.1,backend,testserver"
    oidc_issuer: str = "http://localhost:8080/realms/geoforest"
    oidc_backchannel_origin: str = ""
    oidc_client_id: str = "geoforest"
    oidc_client_secret: str
    session_secret: str
    session_hours: int = 8
    admin_acr: str = ""
    max_body_bytes: int = 65536

    @model_validator(mode="after")
    def secure_config(self):
        if len(self.session_secret) < 32:
            raise ValueError("SESSION_SECRET must contain at least 32 characters")
        if self.app_env not in {"development", "test", "production"}:
            raise ValueError("Invalid APP_ENV")
        if not 1 <= self.session_hours <= 24:
            raise ValueError("SESSION_HOURS must be 1..24")
        if self.app_env == "production":
            if not self.public_origin.startswith(
                "https://"
            ) or not self.oidc_issuer.startswith("https://"):
                raise ValueError("HTTPS is mandatory in production")
            if "*" in self.allowed_hosts or not self.admin_acr:
                raise ValueError(
                    "Explicit hosts and ADMIN_ACR are mandatory in production"
                )
            if len(self.oidc_client_secret) < 32:
                raise ValueError(
                    "Production OIDC secret must be at least 32 characters"
                )
        return self

    @property
    def secure_cookie(self):
        return self.public_origin.startswith("https://")

    @property
    def session_cookie(self):
        return "__Host-gft-session" if self.secure_cookie else "gft-session"


@lru_cache
def settings():
    return Settings()
