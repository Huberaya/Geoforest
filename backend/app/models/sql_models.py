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
    -- NULL = aucun verdict : l'analyse n'était pas probante (P0-04).
    compliant           INTEGER,
    loss_year           INTEGER,
    -- NULL = aucune confiance calculable ; 0 % serait lu comme une mesure.
    confidence_score    REAL,
    analysis_source     TEXT NOT NULL DEFAULT 'unavailable',
    analysis_probative  INTEGER NOT NULL DEFAULT 0,
    analysis_evidence   TEXT,
    risk_level          TEXT NOT NULL,
    status           TEXT NOT NULL,
    validation_json  TEXT NOT NULL,
    satellite_json   TEXT NOT NULL,
    -- P0-06 : brouillon interne, jamais une déclaration déposée.
    draft_reference     TEXT,
    draft_generated_at TEXT
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
    compliant: Optional[bool]
    loss_year: Optional[int]
    confidence_score: Optional[float]
    risk_level: str
    status: str
    validation: Dict[str, Any] = field(default_factory=dict)
    satellite: Dict[str, Any] = field(default_factory=dict)
    draft_reference: Optional[str] = None
    # Provenance de l'analyse (P0-04). Placée après les champs optionnels :
    # une dataclass interdit un champ obligatoire après un champ par défaut.
    analysis_source: str = "unavailable"
    analysis_probative: bool = False
    analysis_evidence: Optional[Dict[str, Any]] = None
    draft_reference: Optional[str] = None
    draft_generated_at: Optional[str] = None
