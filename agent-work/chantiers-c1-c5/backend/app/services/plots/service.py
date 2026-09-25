"""Service métier des parcelles — Chantier 4.

La validation géométrique est technique : elle ne vaut ni analyse de déforestation
ni avis/certification juridique EUDR. Les données restent isolées par organisation.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.alerts import Alert, AlertCategory, AlertLevel
from app.models.plots import Plot, PlotStatus
from app.models.products import Shipment, ShipmentStatus
from app.services.gis.gis_validator import GeometryExtractionError, validate_geometry

logger = logging.getLogger(__name__)


@dataclass
class ValidationOutcome:
    valid: bool
    geometry: dict[str, Any] | None
    geometry_type: str | None
    area_ha: float
    vertex_count: int
    centroid: list[float] | None
    bbox: list[float] | None
    min_decimals_found: int | None
    precision_ok: bool
    eudr_geometry_rule: str | None
    errors: list[dict[str, str]]
    warnings: list[dict[str, str]]


def validate_plot_payload(
    geojson: dict[str, Any],
    declared_area_ha: float | None = None,
    commodity_code: str | None = None,
) -> ValidationOutcome:
    """Valide un payload GeoJSON et conserve l'entrée brute si elle est invalide.

    Passer le document entier (Feature/FeatureCollection) est important : les propriétés
    `min_decimals` et `area_ha` peuvent porter des métadonnées déclarées lors d'un import.
    """
    try:
        result = validate_geometry(
            geojson,
            declared_area_ha=declared_area_ha,
            commodity_code=commodity_code,
        )
    except GeometryExtractionError as exc:
        return ValidationOutcome(
            valid=False,
            geometry=geojson,
            geometry_type=None,
            area_ha=0.0,
            vertex_count=0,
            centroid=None,
            bbox=None,
            min_decimals_found=None,
            precision_ok=False,
            eudr_geometry_rule=None,
            errors=[{"code": exc.code, "message": exc.message}],
            warnings=[],
        )
    except Exception:  # journaliser sans renvoyer d'exception interne à l'appelant
        logger.exception("Échec inattendu de validation géospatiale")
        return ValidationOutcome(
            valid=False,
            geometry=geojson,
            geometry_type=None,
            area_ha=0.0,
            vertex_count=0,
            centroid=None,
            bbox=None,
            min_decimals_found=None,
            precision_ok=False,
            eudr_geometry_rule=None,
            errors=[{
                "code": "VALIDATION_EXCEPTION",
                "message": "La validation géospatiale n'a pas pu aboutir. Vérifiez le GeoJSON ou réessayez.",
            }],
            warnings=[],
        )

    return ValidationOutcome(
        valid=bool(result["valid"]),
        # Si invalide, garder la géométrie entrante pour afficher le problème sur la carte
        # et permettre une correction ultérieure. L'entrée est bornée à 10 Mo / 100k positions.
        geometry=result["normalized_geometry"] if result["valid"] else geojson,
        geometry_type=result["geometry_type"],
        area_ha=float(result["area_ha"]),
        vertex_count=int(result["vertex_count"]),
        centroid=result["centroid"],
        bbox=result["bbox"],
        min_decimals_found=result["min_decimals_found"],
        precision_ok=bool(result["precision_ok"]),
        eudr_geometry_rule=result["eudr_geometry_rule"],
        errors=result["errors"],
        warnings=result["warnings"],
    )


def plot_snapshot(plot: Plot) -> dict[str, Any]:
    """Snapshot minimal mais complet pour l'audit trail (inclut la géométrie sensible)."""
    return {
        "id": str(plot.id),
        "shipment_id": str(plot.shipment_id),
        "internal_ref": plot.internal_ref,
        "name": plot.name,
        "notes": plot.notes,
        "source": plot.source.value if plot.source else None,
        "geometry": plot.geometry,
        "geometry_type": plot.geometry_type,
        "area_ha": plot.area_ha,
        "declared_area_ha": plot.declared_area_ha,
        "vertex_count": plot.vertex_count,
        "centroid": plot.centroid,
        "bbox": plot.bbox,
        "min_decimals_found": plot.min_decimals_found,
        "precision_ok": plot.precision_ok,
        "eudr_geometry_rule": plot.eudr_geometry_rule,
        "harvest_year": plot.harvest_year,
        "acquired_at": plot.acquired_at.isoformat() if plot.acquired_at else None,
        "gps_accuracy_m": plot.gps_accuracy_m,
        "status": plot.status.value if plot.status else None,
        "validation_errors": plot.validation_errors or [],
        "validation_warnings": plot.validation_warnings or [],
    }


async def revalidate_plot(plot: Plot, commodity_code: str | None = None) -> ValidationOutcome:
    """Revalide et met à jour les métadonnées du modèle sans commit."""
    if plot.geometry is None:
        result = ValidationOutcome(
            valid=False,
            geometry=None,
            geometry_type=None,
            area_ha=0.0,
            vertex_count=0,
            centroid=None,
            bbox=None,
            min_decimals_found=None,
            precision_ok=False,
            eudr_geometry_rule=None,
            errors=[{"code": "NO_GEOMETRY", "message": "Aucune géométrie n'est définie."}],
            warnings=[],
        )
    else:
        result = validate_plot_payload(plot.geometry, plot.declared_area_ha, commodity_code)

    plot.geometry = result.geometry
    plot.geometry_type = result.geometry_type
    plot.area_ha = result.area_ha
    plot.vertex_count = result.vertex_count
    plot.centroid = result.centroid
    plot.bbox = result.bbox
    plot.min_decimals_found = result.min_decimals_found
    plot.precision_ok = result.precision_ok
    plot.eudr_geometry_rule = result.eudr_geometry_rule
    plot.validation_errors = result.errors
    plot.validation_warnings = result.warnings
    plot.status = PlotStatus.valid if result.valid else PlotStatus.invalid
    return result


async def get_shipment_commodity(
    db: AsyncSession, organization_id: uuid.UUID, shipment_id: uuid.UUID
) -> str | None:
    shipment = (await db.execute(
        select(Shipment)
        .options(selectinload(Shipment.product))
        .where(Shipment.id == shipment_id, Shipment.organization_id == organization_id)
    )).scalar_one_or_none()
    return shipment.product.commodity if shipment and shipment.product else None


def apply_validation(plot: Plot, result: ValidationOutcome) -> None:
    plot.geometry = result.geometry
    plot.geometry_type = result.geometry_type
    plot.area_ha = result.area_ha
    plot.vertex_count = result.vertex_count
    plot.centroid = result.centroid
    plot.bbox = result.bbox
    plot.min_decimals_found = result.min_decimals_found
    plot.precision_ok = result.precision_ok
    plot.eudr_geometry_rule = result.eudr_geometry_rule
    plot.validation_errors = result.errors
    plot.validation_warnings = result.warnings
    plot.status = PlotStatus.valid if result.valid else PlotStatus.invalid


async def create_plot_from_payload(
    db: AsyncSession,
    organization_id: uuid.UUID,
    user_id: uuid.UUID,
    payload,
) -> Plot:
    """Crée une parcelle, valide sa géométrie, et passe le lot en attente de données."""
    shipment = (await db.execute(
        select(Shipment)
        .options(selectinload(Shipment.product))
        .where(
            Shipment.id == payload.shipment_id,
            Shipment.organization_id == organization_id,
        )
    )).scalar_one_or_none()
    if shipment is None:
        raise HTTPException(
            status_code=422,
            detail="Lot introuvable ou hors organisation.",
        )

    if payload.internal_ref:
        duplicate = (await db.execute(
            select(Plot.id).where(
                Plot.organization_id == organization_id,
                Plot.shipment_id == payload.shipment_id,
                Plot.internal_ref == payload.internal_ref,
            )
        )).scalar_one_or_none()
        if duplicate is not None:
            raise HTTPException(status_code=409, detail="Cette référence de parcelle existe déjà pour ce lot.")

    commodity_code = shipment.product.commodity if shipment.product else None
    result = validate_plot_payload(payload.geojson, payload.declared_area_ha, commodity_code)
    plot = Plot(
        organization_id=organization_id,
        shipment_id=payload.shipment_id,
        name=payload.name,
        internal_ref=payload.internal_ref,
        notes=payload.notes,
        source=payload.source,
        geometry=result.geometry,
        geometry_type=result.geometry_type,
        area_ha=result.area_ha,
        declared_area_ha=payload.declared_area_ha,
        vertex_count=result.vertex_count,
        centroid=result.centroid,
        bbox=result.bbox,
        min_decimals_found=result.min_decimals_found,
        precision_ok=result.precision_ok,
        eudr_geometry_rule=result.eudr_geometry_rule,
        harvest_year=payload.harvest_year,
        acquired_at=payload.acquired_at,
        gps_accuracy_m=payload.gps_accuracy_m,
        status=PlotStatus.valid if result.valid else PlotStatus.invalid,
        validation_errors=result.errors,
        validation_warnings=result.warnings,
    )
    db.add(plot)
    await db.flush()

    # Le statut indique le workflow métier, pas la conformité : même une géométrie valide
    # attendra encore l'analyse de déforestation/légalité. Ne pas écraser un état ultérieur.
    if shipment.status == ShipmentStatus.draft:
        shipment.status = ShipmentStatus.awaiting_data

    plot_count = (await db.execute(
        select(func.count()).select_from(Plot).where(Plot.organization_id == organization_id)
    )).scalar_one() or 0
    if plot_count == 1:
        db.add(Alert(
            organization_id=organization_id,
            user_id=user_id,
            level=AlertLevel.success if result.valid else AlertLevel.warning,
            category=AlertCategory.onboarding,
            title="Première parcelle géolocalisée 🗺️",
            message=(
                f"La parcelle '{plot.name or plot.internal_ref or 'sans nom'}' a été enregistrée. "
                "La validation géométrique ne constitue pas une analyse de déforestation ou une certification EUDR."
                if result.valid else
                "La première parcelle a été importée, mais sa géométrie présente des erreurs à corriger."
            ),
            link="/plots",
            context={"plot_id": str(plot.id), "geometry_valid": result.valid, "area_ha": plot.area_ha},
        ))

    if not result.valid:
        db.add(Alert(
            organization_id=organization_id,
            user_id=user_id,
            level=AlertLevel.warning,
            category=AlertCategory.plot,
            title="Parcelle à corriger",
            message=result.errors[0]["message"] if result.errors else "Erreur de géométrie.",
            link="/plots",
            context={"plot_id": str(plot.id), "errors": result.errors},
        ))

    return plot
