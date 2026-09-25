"""Configuration centrale — GeoForest Trace.

Toutes les valeurs viennent de l'environnement (ou du fichier .env).
Aucun secret n'est codé en dur.
"""
from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Application ---
    app_name: str = "GeoForest Trace API"
    app_version: str = "0.1.0"
    api_v1_prefix: str = "/api/v1"
    environment: str = "development"
    debug: bool = True
    demo_seed_enabled: bool = Field(default=False, validation_alias="DEMO_SEED_ENABLED")
    demo_admin_email: str = Field(default="", validation_alias="DEMO_ADMIN_EMAIL")
    demo_admin_password: str = Field(default="", validation_alias="DEMO_ADMIN_PASSWORD")

    # --- Base de données (PostgreSQL + JSONB; géométries traitées côté application) ---
    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/geoforest",
        validation_alias="DATABASE_URL",
    )

    # --- Redis (Celery + cache) ---
    redis_url: str = Field(default="redis://localhost:6379/0", validation_alias="REDIS_URL")

    # --- Stockage objet (S3 / MinIO) ---
    s3_endpoint_url: str | None = Field(default=None, validation_alias="S3_ENDPOINT_URL")
    s3_access_key: str | None = Field(default=None, validation_alias="S3_ACCESS_KEY")
    s3_secret_key: str | None = Field(default=None, validation_alias="S3_SECRET_KEY")
    s3_bucket: str = Field(default="geoforest-documents", validation_alias="S3_BUCKET")
    s3_region: str = Field(default="eu-west-1", validation_alias="S3_REGION")

    # --- Sécurité / JWT ---
    secret_key: str = Field(
        default="dev-only-change-me-please-32chars-minimum!!",
        validation_alias="SECRET_KEY",
    )
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30

    # --- CORS ---
    cors_origins: List[str] = Field(
        default=[
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://frontend:3000",
        ],
        validation_alias="CORS_ORIGINS",
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    # --- Email ---
    smtp_host: str | None = Field(default=None, validation_alias="SMTP_HOST")
    smtp_port: int = Field(default=587, validation_alias="SMTP_PORT")
    smtp_user: str | None = Field(default=None, validation_alias="SMTP_USER")
    smtp_password: str | None = Field(default=None, validation_alias="SMTP_PASSWORD")
    email_from: str = Field(default="noreply@geoforest-trace.local", validation_alias="EMAIL_FROM")
    app_url: str = Field(default="http://localhost:3000", validation_alias="APP_URL")
    supplier_invitation_ttl_hours: int = Field(
        default=48, ge=1, le=168, validation_alias="SUPPLIER_INVITATION_TTL_HOURS"
    )
    supplier_magic_link_ttl_minutes: int = Field(
        default=15, ge=5, le=60, validation_alias="SUPPLIER_MAGIC_LINK_TTL_MINUTES"
    )

    # --- EUDR (Règlement (UE) 2023/1115, Règlement (UE) 2025/2650, Règl. exécution 2025/1093) ---
    eudr_cutoff_date: date = date(2020, 12, 31)
    # Date d'application LME : 30/12/2026, micro/petites : 30/06/2027
    eudr_application_date_lme: date = date(2026, 12, 30)
    eudr_application_date_micro_sme: date = date(2027, 6, 30)
    eudr_polygon_threshold_ha: float = 4.0  # Règl. (UE) 2023/1115 art. 2(28): strictement plus de 4 ha (hors bovins)
    eudr_min_coordinate_decimals: int = 6
    eudr_retention_years: int = 5

    # --- Global Forest Watch (dépistage C5, fournisseur désactivé par défaut) ---
    gfw_api_key: str = Field(default="", validation_alias="GFW_API_KEY")
    gfw_api_origin: str = Field(default="", validation_alias="GFW_API_ORIGIN")
    gfw_api_url: str = Field(
        default="https://data-api.globalforestwatch.org",
        validation_alias="GFW_API_URL",
    )
    gfw_dataset: str = Field(default="umd_tree_cover_loss", validation_alias="GFW_DATASET")
    gfw_dataset_version: str = Field(default="v1.13", validation_alias="GFW_DATASET_VERSION")
    gfw_timeout_seconds: float = Field(default=15.0, ge=1, le=120, validation_alias="GFW_TIMEOUT_SECONDS")
    gfw_canopy_threshold_pct: int = Field(default=10, validation_alias="GFW_CANOPY_THRESHOLD_PCT")
    gfw_sensitivity_canopy_threshold_pct: int = Field(
        default=30, validation_alias="GFW_SENSITIVITY_CANOPY_THRESHOLD_PCT"
    )
    gfw_live_enabled: bool = Field(default=False, validation_alias="GFW_LIVE_ENABLED")
    gfw_contract_verified: bool = Field(default=False, validation_alias="GFW_CONTRACT_VERIFIED")
    gfw_live_test_enabled: bool = Field(default=False, validation_alias="GFW_LIVE_TEST_ENABLED")

    @field_validator("gfw_dataset_version")
    @classmethod
    def _pin_gfw_dataset_version(cls, value: str) -> str:
        # Refuse `latest` so every screening can be reproduced against a fixed data release.
        import re

        if not re.fullmatch(r"v\d{1,8}(?:\.\d{1,3}){0,2}", value):
            raise ValueError("GFW_DATASET_VERSION doit être une version explicite telle que v1.13.")
        return value

    @field_validator("gfw_canopy_threshold_pct", "gfw_sensitivity_canopy_threshold_pct")
    @classmethod
    def _supported_gfw_canopy_threshold(cls, value: int) -> int:
        if value not in {10, 30}:
            raise ValueError("Les seuils de couvert C5 autorisés sont 10 et 30.")
        return value

    @property
    def access_token_expire_timedelta(self) -> timedelta:
        return timedelta(minutes=self.access_token_expire_minutes)

    @property
    def refresh_token_expire_timedelta(self) -> timedelta:
        return timedelta(days=self.refresh_token_expire_days)

    @property
    def gfw_live_available(self) -> bool:
        return self.gfw_live_enabled and self.gfw_contract_verified and bool(self.gfw_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
