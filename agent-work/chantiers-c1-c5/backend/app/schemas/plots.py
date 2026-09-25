"""Schémas Pydantic — Parcelles (Chantier 4)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

import json

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.plots import PlotSource, PlotStatus


def _validate_geojson_value(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict):
        raise ValueError("geojson doit être un objet GeoJSON.")
    t = v.get("type")
    allowed = {"Feature", "FeatureCollection", "Point", "MultiPoint", "Polygon", "MultiPolygon", "GeometryCollection"}
    if t not in allowed:
        raise ValueError("Type GeoJSON invalide.")
    try:
        encoded = json.dumps(v, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError, RecursionError) as exc:
        raise ValueError("GeoJSON invalide ou trop profondément imbriqué.") from exc
    if len(encoded.encode("utf-8")) > 10 * 1024 * 1024:
        raise ValueError("GeoJSON trop volumineux (maximum 10 Mo).")
    positions = 0
    stack: list[Any] = [v]
    while stack:
        current = stack.pop()
        if isinstance(current, dict):
            stack.extend(current.values())
        elif isinstance(current, list):
            if len(current) >= 2 and all(
                isinstance(x, (int, float)) and not isinstance(x, bool)
                for x in current[:2]
            ):
                positions += 1
                if positions > 100_000:
                    raise ValueError("GeoJSON trop détaillé (maximum 100 000 positions).")
            else:
                stack.extend(current)
    return v


class PlotCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    shipment_id: uuid.UUID
    name: Optional[str] = Field(default=None, max_length=200)
    internal_ref: Optional[str] = Field(default=None, max_length=100)
    source: PlotSource = PlotSource.geojson
    notes: Optional[str] = Field(default=None, max_length=5000)
    # Géométrie : accepte Feature, FeatureCollection, GeometryCollection ou Geometry brute.
    # Limites défensives aussi appliquées en backend (le client autorise 10 Mo maximum).
    geojson: dict[str, Any]
    declared_area_ha: Optional[float] = Field(default=None, gt=0, le=1_000_000)
    harvest_year: Optional[int] = Field(default=None, ge=2000, le=2100)
    acquired_at: Optional[datetime] = None
    gps_accuracy_m: Optional[float] = Field(default=None, gt=0, le=1_000_000)

    @field_validator("geojson")
    @classmethod
    def _validate_geojson_shape(cls, v: dict[str, Any]) -> dict[str, Any]:
        return _validate_geojson_value(v)


class PlotUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: Optional[str] = Field(default=None, max_length=200)
    internal_ref: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None, max_length=5000)
    source: Optional[PlotSource] = None
    harvest_year: Optional[int] = Field(default=None, ge=2000, le=2100)
    declared_area_ha: Optional[float] = Field(default=None, gt=0, le=1_000_000)
    acquired_at: Optional[datetime] = None
    gps_accuracy_m: Optional[float] = Field(default=None, gt=0, le=1_000_000)
    geojson: Optional[dict[str, Any]] = None  # si fourni, relance la validation

    @field_validator("geojson")
    @classmethod
    def _validate_updated_geojson(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        return _validate_geojson_value(v) if v is not None else None


class PlotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    shipment_id: uuid.UUID
    name: Optional[str]
    internal_ref: Optional[str]
    notes: Optional[str]
    source: PlotSource
    geometry: Optional[dict[str, Any]]
    geometry_type: Optional[str]
    area_ha: Optional[float]
    declared_area_ha: Optional[float]
    vertex_count: Optional[int]
    centroid: Optional[list[float]] = None  # [lon, lat]
    bbox: Optional[list[float]] = None
    min_decimals_found: Optional[int]
    precision_ok: bool
    eudr_geometry_rule: Optional[str]
    harvest_year: Optional[int]
    acquired_at: Optional[datetime]
    gps_accuracy_m: Optional[float]
    status: PlotStatus
    validation_errors: list[dict[str, str]]
    validation_warnings: list[dict[str, str]]
    created_at: datetime
    updated_at: datetime
    # Champs liés (inclus dans la liste/détail)
    shipment_reference: Optional[str] = None
    supplier_name: Optional[str] = None
    product_name: Optional[str] = None


class PlotList(BaseModel):
    items: list[PlotOut]
    total: int
    total_area_ha: float
    by_status: dict[str, int]
    invalid_count: int
    awaiting_validation_count: int


class ValidationIssue(BaseModel):
    code: str
    message: str


class PlotValidateResult(BaseModel):
    plot_id: uuid.UUID
    valid: bool
    area_ha: float
    vertex_count: int
    geometry_type: Optional[str]
    min_decimals_found: Optional[int]
    precision_ok: bool
    eudr_geometry_rule: Optional[str]
    errors: list[ValidationIssue]
    warnings: list[ValidationIssue]
