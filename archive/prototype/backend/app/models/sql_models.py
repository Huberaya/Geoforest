"""Modèles de persistance (DDL SQL + dataclasses typées)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS parcel_audits (
    id               TEXT PRIMARY KEY,
    created_at       TEXT NOT NULL,
    operator_name    TEXT NOT NULL,
    operator_eori    TEXT NOT NULL,
    commodity        TEXT NOT NULL,
    hs_code          TEXT NOT NULL,
    harvest_date     TEXT NOT NULL,
    geometry_json    TEXT NOT NULL,
    geometry_type    TEXT NOT NULL,
    area_ha          REAL NOT NULL,
    vertex_count     INTEGER NOT NULL,
    centroid_lon     REAL NOT NULL,
    centroid_lat     REAL NOT NULL,
    country_code     TEXT NOT NULL,
    country_risk     TEXT NOT NULL,
    compliant        INTEGER NOT NULL,
    loss_year        INTEGER,
    confidence_score REAL NOT NULL,
    risk_level       TEXT NOT NULL,
    status           TEXT NOT NULL,
    validation_json  TEXT NOT NULL,
    satellite_json   TEXT NOT NULL,
    traces_reference TEXT
);
CREATE INDEX IF NOT EXISTS idx_parcel_audits_created_at ON parcel_audits (created_at DESC);
"""


@dataclass
class ParcelAuditRecord:
    """Ligne de la table parcel_audits."""

    id: str
    created_at: str
    operator_name: str
    operator_eori: str
    commodity: str
    hs_code: str
    harvest_date: str
    geometry: Dict[str, Any]
    geometry_type: str
    area_ha: float
    vertex_count: int
    centroid_lon: float
    centroid_lat: float
    country_code: str
    country_risk: str
    compliant: bool
    loss_year: Optional[int]
    confidence_score: float
    risk_level: str
    status: str
    validation: Dict[str, Any] = field(default_factory=dict)
    satellite: Dict[str, Any] = field(default_factory=dict)
    traces_reference: Optional[str] = None
