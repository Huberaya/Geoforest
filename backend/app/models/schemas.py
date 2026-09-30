"""Schémas Pydantic (contrats d'API) de GeoForest Trace."""
from __future__ import annotations

import re
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

RiskLevel = Literal["LOW", "STANDARD", "HIGH", "CRITICAL"]
AuditStatus = Literal["COMPLIANT", "NON_COMPLIANT", "INVALID_GEOMETRY", "WARNING"]


class Commodity(str, Enum):
    """Matières premières couvertes par l'Annexe I du règlement EUDR."""

    COFFEE = "coffee"
    COCOA = "cocoa"
    PALM_OIL = "palm_oil"
    RUBBER = "rubber"
    SOYA = "soya"
    CATTLE = "cattle"
    WOOD = "wood"


# Codes SH (Système Harmonisé) — Annexe I EUDR (positions principales)
COMMODITY_HS_CODES: Dict[str, str] = {
    Commodity.COFFEE.value: "0901",
    Commodity.COCOA.value: "1801",
    Commodity.PALM_OIL.value: "1511",
    Commodity.RUBBER.value: "4001",
    Commodity.SOYA.value: "1201",
    Commodity.CATTLE.value: "0102",
    Commodity.WOOD.value: "4403",
}

COMMODITY_LABELS: Dict[str, str] = {
    Commodity.COFFEE.value: "Café (Coffea spp.)",
    Commodity.COCOA.value: "Cacao (Theobroma cacao)",
    Commodity.PALM_OIL.value: "Huile de palme (Elaeis guineensis)",
    Commodity.RUBBER.value: "Caoutchouc naturel (Hevea brasiliensis)",
    Commodity.SOYA.value: "Soja (Glycine max)",
    Commodity.CATTLE.value: "Bovins (Bos taurus)",
    Commodity.WOOD.value: "Bois (bois bruts)",
}

_EORI_PATTERN = re.compile(r"^[A-Z]{2}[A-Z0-9]{1,15}$")


class OperatorInfo(BaseModel):
    """Opérateur / commerçant au sens de l'art. 2 EUDR."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(..., min_length=2, max_length=200)
    eori: str = Field(..., description="Numéro EORI (ex: FR12345678901234)")
    address: Optional[str] = Field(default=None, max_length=300)
    country: str = Field(default="FR", min_length=2, max_length=2)
    email: Optional[str] = Field(default=None, max_length=200)

    @field_validator("eori")
    @classmethod
    def validate_eori(cls, value: str) -> str:
        normalized = value.replace(" ", "").upper()
        if not _EORI_PATTERN.match(normalized):
            raise ValueError(
                "EORI invalide : format attendu = code pays ISO (2 lettres) + 1 à 15 caractères alphanumériques"
            )
        return normalized

    @field_validator("country")
    @classmethod
    def upper_country(cls, value: str) -> str:
        return value.upper()


class ParcelAuditRequest(BaseModel):
    """Payload de POST /api/v1/audit/parcel."""

    model_config = ConfigDict(str_strip_whitespace=True)

    geojson: Dict[str, Any] = Field(
        ..., description="Geometry, Feature ou FeatureCollection GeoJSON (WGS84)"
    )
    commodity: Commodity
    harvest_date: date = Field(..., description="Date de récolte / production (ISO 8601)")
    operator: Optional[OperatorInfo] = None
    declared_area_ha: Optional[float] = Field(
        default=None,
        ge=0,
        description="Surface déclarée (utile pour les parcelles géolocalisées par point)",
    )
    parcel_reference: Optional[str] = Field(default=None, max_length=100)

    @field_validator("harvest_date")
    @classmethod
    def harvest_not_in_future(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("La date de récolte ne peut pas être dans le futur")
        return value


class ValidationIssue(BaseModel):
    code: str
    message: str


class GeometryValidationResult(BaseModel):
    valid: bool
    geometry_type: Optional[str] = None
    area_ha: float = 0.0
    vertex_count: int = 0
    centroid: Optional[List[float]] = None
    bbox: Optional[List[float]] = None
    precision_ok: bool = True
    min_decimals_found: Optional[int] = None
    eudr_geometry_rule: Literal["POINT_ALLOWED", "POLYGON_REQUIRED"] = "POINT_ALLOWED"
    errors: List[ValidationIssue] = Field(default_factory=list)
    warnings: List[ValidationIssue] = Field(default_factory=list)
    normalized_geometry: Optional[Dict[str, Any]] = None


class SatelliteCheckResult(BaseModel):
    compliant: bool
    loss_year: Optional[int] = None
    confidence_score: float = Field(..., ge=0, le=1)
    risk_level: RiskLevel
    country_code: str
    country_name: str
    country_risk: RiskLevel
    source: str
    loss_area_ha: float = 0.0
    tree_cover_2000_pct: Optional[float] = None
    details: str = ""


class ParcelAuditResponse(BaseModel):
    audit_id: str
    created_at: str
    status: AuditStatus
    commodity: Commodity
    hs_code: str
    harvest_date: date
    validation: GeometryValidationResult
    satellite: Optional[SatelliteCheckResult] = None
    eudr_cutoff_date: date
    summary: str


class TracesExportRequest(BaseModel):
    """Payload de POST /api/v1/export/traces."""

    audit_id: Optional[str] = None
    operator: Optional[OperatorInfo] = None
    format: Literal["xml", "json"] = "xml"
    activity_type: Literal["IMPORT", "EXPORT", "DOMESTIC"] = "IMPORT"
    net_weight_kg: Optional[float] = Field(default=None, ge=0)
    internal_reference: Optional[str] = Field(default=None, max_length=50)
    country_of_activity: str = Field(default="FR", min_length=2, max_length=2)


class AuditSummary(BaseModel):
    audit_id: str
    created_at: str
    operator_name: str
    commodity: str
    hs_code: str
    harvest_date: str
    area_ha: float
    geometry_type: str
    status: str
    compliant: bool
    loss_year: Optional[int]
    risk_level: str
    country_code: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    gfw_mode: Literal["live", "deterministic-mock"]


# --------------------------------------------------------------------------- Geospatial Analysis Extensions (Chantier 4)
class HansenLayerResult(BaseModel):
    source: str = "Hansen / UMD Tree Cover Loss (Global Forest Watch)"
    resolution_m: int = 30
    canopy_threshold_pct: int = 30
    loss_year: Optional[int] = None
    loss_area_ha: float = 0.0
    loss_detected_post_2020: bool = False
    tree_cover_2000_pct: float = 0.0


class Sentinel2LayerResult(BaseModel):
    source: str = "Copernicus Sentinel-2 MSI Optical"
    resolution_m: int = 10
    baseline_ndvi_2020: float = 0.0
    current_ndvi: float = 0.0
    delta_ndvi: float = 0.0
    vegetation_loss_detected: bool = False
    cloud_cover_pct: float = 0.0
    observation_period: str = "2020-2026"


class EsaWorldCoverLayerResult(BaseModel):
    source: str = "ESA WorldCover 10m"
    resolution_m: int = 10
    tree_cover_pct: float = 0.0
    cropland_pct: float = 0.0
    shrubland_pct: float = 0.0
    other_pct: float = 0.0
    dominant_land_cover: str = "Tree cover"


class BufferEncroachmentResult(BaseModel):
    buffer_distance_m: int = 50
    encroachment_detected: bool = False
    buffer_loss_area_ha: float = 0.0
    buffer_alerts_count: int = 0
    buffer_risk_level: RiskLevel = "LOW"


class GeospatialLayers(BaseModel):
    hansen: HansenLayerResult
    sentinel2: Sentinel2LayerResult
    esa_worldcover: EsaWorldCoverLayerResult
    buffer_encroachment: BufferEncroachmentResult


class GeospatialAnalysisRequest(BaseModel):
    geojson: Dict[str, Any]
    commodity: Commodity
    harvest_date: date = Field(default_factory=date.today)
    buffer_meters: int = Field(default=50, ge=10, le=500)
    canopy_threshold: int = Field(default=30, ge=10, le=75)
    plot_name: Optional[str] = None


class GeospatialAnalysisResponse(BaseModel):
    analysis_id: str
    created_at: str
    plot_name: str
    commodity: Commodity
    status: AuditStatus
    risk_level: RiskLevel
    compliant: bool
    confidence_score: float
    eudr_cutoff_date: str = "2020-12-31"
    area_ha: float
    centroid: List[float]
    country_code: str
    country_name: str
    country_risk: RiskLevel
    layers: GeospatialLayers
    summary: str
    methodology: str
    legal_disclaimer: str = (
        "GeoForest Trace est un outil d'aide à la décision et de diligence raisonnée EUDR. "
        "Les résultats d'analyses géospatiales constituent des indicateurs de risque et ne remplacent pas une vérification sur le terrain ni un certificat juridique d'exemption."
    )
