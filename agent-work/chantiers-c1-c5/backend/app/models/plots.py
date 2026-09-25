"""Modèle Plot (parcelle géolocalisée) — Chantier 4.

Une parcelle est une géométrie GeoJSON (Point/MultiPoint/Polygon/MultiPolygon) en WGS84 (EPSG:4326)
rattachée à un lot (Shipment) et indirectement à un fournisseur. Elle porte les métadonnées
issues de la validation géospatiale (surface, centroïde, précision, règles EUDR).
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, JSONType, UUIDType


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PlotSource(str, enum.Enum):
    manual = "manual"        # dessin sur la carte (front)
    geojson = "geojson"      # import GeoJSON
    kml = "kml"              # import KML
    csv = "csv"              # import CSV de coordonnées
    gps = "gps"              # relevé GPS mobile (chantier futur)
    supplier = "supplier"    # saisi par le fournisseur via son portail


class PlotStatus(str, enum.Enum):
    draft = "draft"                  # en cours de saisie
    validating = "validating"        # validation géométrique en cours
    valid = "valid"                  # géométrie valide EUDR, en attente d'analyse
    invalid = "invalid"              # géométrie invalide (erreurs de validation)
    analyzed = "analyzed"            # analyse déforestation faite (chantier 5-6)
    rejected = "rejected"            # anomalie bloquante


class Plot(Base):
    """Une parcelle géolocalisée (point ou polygone), rattachée à un lot."""
    __tablename__ = "plots"
    __table_args__ = (
        UniqueConstraint("shipment_id", "internal_ref", name="uq_plot_shipment_ref"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shipment_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("shipments.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Identifiant
    internal_ref: Mapped[str | None] = mapped_column(String(100))
    name: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)

    # Origine
    source: Mapped[PlotSource] = mapped_column(
        SAEnum(PlotSource, name="plotsource"), default=PlotSource.manual, nullable=False
    )

    # Géométrie GeoJSON normalisée (WGS84). Stockée en JSONB sous Postgres, JSON sous SQLite.
    # On ne stocke QUE des géométries validées (validator) ; le champ est null si invalid.
    geometry: Mapped[dict | None] = mapped_column(JSONType)

    # Métadonnées dérivées de la validation
    geometry_type: Mapped[str | None] = mapped_column(String(30))
    area_ha: Mapped[Optional[float]] = mapped_column(Float)
    declared_area_ha: Mapped[Optional[float]] = mapped_column(Float)
    vertex_count: Mapped[Optional[int]] = mapped_column(Integer)
    centroid: Mapped[dict | None] = mapped_column(JSONType)   # {"lon": x, "lat": y}
    bbox: Mapped[list | None] = mapped_column(JSONType)       # [minLon, minLat, maxLon, maxLat]
    min_decimals_found: Mapped[Optional[int]] = mapped_column(Integer)
    precision_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    eudr_geometry_rule: Mapped[str | None] = mapped_column(String(30))

    # Dates clefs
    harvest_year: Mapped[Optional[int]] = mapped_column(Integer)
    acquired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    gps_accuracy_m: Mapped[Optional[float]] = mapped_column(Float)

    # État
    status: Mapped[PlotStatus] = mapped_column(
        SAEnum(PlotStatus, name="plotstatus"), default=PlotStatus.draft, nullable=False
    )
    # Erreurs/avertissements de validation en JSON (list de {code, message})
    validation_errors: Mapped[list | None] = mapped_column(JSONType)
    validation_warnings: Mapped[list | None] = mapped_column(JSONType)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow
    )

    shipment: Mapped["Shipment"] = relationship("Shipment", foreign_keys=[shipment_id])  # type: ignore[name-defined]

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Plot {self.id} shipment={self.shipment_id} area={self.area_ha}ha status={self.status.value}>"
