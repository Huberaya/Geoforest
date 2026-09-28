"""Configuration centrale de GeoForest Trace (backend FastAPI).

Toutes les valeurs sont lues depuis l'environnement (ou un fichier .env).
Aucune clé n'est codée en dur.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import List

from dotenv import load_dotenv

load_dotenv()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name: str, default: List[str]) -> List[str]:
    raw = os.getenv(name)
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    """Paramètres immuables de l'application."""

    app_name: str = "GeoForest Trace API"
    app_version: str = "1.0.0"
    api_v1_prefix: str = "/api/v1"

    # --- Règles EUDR (Règlement (UE) 2023/1115) ---
    # Article 2(13) : date butoir de déforestation.
    eudr_cutoff_date: date = date(2020, 12, 31)
    # Article 9(1)(d) : géolocalisation par polygone obligatoire au-delà de 4 ha.
    eudr_polygon_threshold_ha: float = 4.0
    # Précision minimale des coordonnées (6 décimales ≈ 11 cm à l'équateur).
    eudr_min_coordinate_decimals: int = 6

    # --- Global Forest Watch ---
    gfw_api_key: str = field(default_factory=lambda: os.getenv("GFW_API_KEY", ""))
    gfw_api_url: str = field(
        default_factory=lambda: os.getenv(
            "GFW_API_URL", "https://data-api.globalforestwatch.org"
        )
    )
    gfw_dataset: str = field(
        default_factory=lambda: os.getenv("GFW_DATASET", "umd_tree_cover_loss")
    )
    gfw_timeout_seconds: float = field(
        default_factory=lambda: float(os.getenv("GFW_TIMEOUT_SECONDS", "15"))
    )
    # Si False (ou si aucune clé), on utilise le moteur de scoring déterministe.
    gfw_live_enabled: bool = field(default_factory=lambda: _env_bool("GFW_LIVE_ENABLED", True))

    # --- Persistance ---
    database_path: Path = field(
        default_factory=lambda: Path(os.getenv("DATABASE_PATH", "data/geoforest.db"))
    )

    # --- CORS ---
    cors_origins: List[str] = field(
        default_factory=lambda: _env_list(
            "CORS_ORIGINS", ["http://localhost:3000", "http://127.0.0.1:3000"]
        )
    )

    @property
    def gfw_live_available(self) -> bool:
        return self.gfw_live_enabled and bool(self.gfw_api_key)


settings = Settings()
