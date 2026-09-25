"""Routes tenant-scoped pour le dépistage satellitaire descriptif C5."""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import ensure_operator_user, get_current_active_user
from app.models import User, UserRole
from app.models.audit import AuditEvent
from app.models.plots import Plot, PlotStatus
from app.models.products import Shipment
from app.schemas.deforestation import (
    DeforScreeningCandidate,
    DeforScreeningCandidateList,
    DeforestationScreeningHistory,
    DeforestationScreeningOut,
)
from app.services.audit.service import record_audit_event
from app.services.satellite.deforestation_screening import screen_plot

router = APIRouter()
_SCREENING_ACTION = "plot.deforestation_screened"
_SCREENABLE_GEOMETRIES = {"Polygon", "MultiPolygon"}
_WRITE_ROLES = {UserRole.admin, UserRole.compliance, UserRole.procurement, UserRole.analyst}


def _tenant_id(user: User) -> uuid.UUID:
    ensure_operator_user(user)
    if user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")
    return user.organization_id


async def _get_plot(plot_id: uuid.UUID, organization_id: uuid.UUID, db: AsyncSession) -> Plot:
    result = await db.execute(
        select(Plot)
        .where(Plot.id == plot_id, Plot.organization_id == organization_id)
        .options(
            selectinload(Plot.shipment).selectinload(Shipment.supplier),
            selectinload(Plot.shipment).selectinload(Shipment.product),
        )
    )
    plot = result.scalar_one_or_none()
    if plot is None:
        raise HTTPException(status_code=404, detail="Parcelle introuvable.")
    return plot


def _candidate(plot: Plot) -> DeforScreeningCandidate:
    can_screen = bool(plot.geometry is not None and plot.geometry_type in _SCREENABLE_GEOMETRIES)
    shipment = plot.shipment
    return DeforScreeningCandidate(
        id=plot.id,
        shipment_id=plot.shipment_id,
        shipment_reference=shipment.reference if shipment else None,
        supplier_name=shipment.supplier.name if shipment and shipment.supplier else None,
        product_name=shipment.product.name if shipment and shipment.product else None,
        name=plot.name,
        internal_ref=plot.internal_ref,
        geometry_type=plot.geometry_type,
        area_ha=plot.area_ha,
        status=plot.status.value,
        can_screen=can_screen,
        screening_reason=None if can_screen else "Le dépistage C5 actuel exige un polygone; aucun tampon n'est créé pour les points.",
    )


@router.get(
    "/deforestation-screenings/candidates",
    response_model=DeforScreeningCandidateList,
    summary="Lister les parcelles techniquement valides disponibles pour C5",
)
async def list_screening_candidates(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DeforScreeningCandidateList:
    organization_id = _tenant_id(current_user)
    filters = [
        Plot.organization_id == organization_id,
        Plot.status == PlotStatus.valid,
    ]
    total = (await db.execute(
        select(func.count()).select_from(Plot).where(*filters)
    )).scalar_one() or 0
    rows = await db.execute(
        select(Plot)
        .where(*filters)
        .options(
            selectinload(Plot.shipment).selectinload(Shipment.supplier),
            selectinload(Plot.shipment).selectinload(Shipment.product),
        )
        .order_by(Plot.created_at.desc(), Plot.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return DeforScreeningCandidateList(
        items=[_candidate(plot) for plot in rows.scalars().all()],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/plots/{plot_id}/deforestation-screenings",
    response_model=DeforestationScreeningOut,
    summary="Lancer un dépistage de perte de couvert arboré",
)
async def run_deforestation_screening(
    plot_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DeforestationScreeningOut:
    organization_id = _tenant_id(current_user)
    if current_user.role not in _WRITE_ROLES:
        raise HTTPException(status_code=403, detail="Rôle insuffisant pour lancer un dépistage.")

    plot = await _get_plot(plot_id, organization_id, db)
    if plot.status != PlotStatus.valid:
        raise HTTPException(status_code=409, detail="La géométrie doit d'abord être techniquement validée.")

    outcome = await screen_plot(plot.geometry, plot.area_ha)
    screening_id = uuid.uuid4()
    serialized: dict[str, Any] = outcome.as_dict()
    serialized.update({"screening_id": str(screening_id), "plot_id": str(plot.id)})
    screening = DeforestationScreeningOut.model_validate(serialized)

    previous_event = (await db.execute(
        select(AuditEvent)
        .where(
            AuditEvent.organization_id == organization_id,
            AuditEvent.object_type == "plot",
            AuditEvent.object_id == plot.id,
            AuditEvent.action == _SCREENING_ACTION,
        )
        .order_by(AuditEvent.occurred_at.desc(), AuditEvent.id.desc())
        .limit(1)
    )).scalar_one_or_none()
    previous = previous_event.new_data if previous_event else None

    record_audit_event(
        db,
        request,
        organization_id=organization_id,
        actor_user_id=current_user.id,
        action=_SCREENING_ACTION,
        object_type="plot",
        object_id=plot.id,
        previous_data=previous,
        new_data=screening.model_dump(mode="json"),
    )
    await db.commit()
    return screening


@router.get(
    "/plots/{plot_id}/deforestation-screenings",
    response_model=DeforestationScreeningHistory,
    summary="Consulter l'historique des dépistages d'une parcelle",
)
async def list_deforestation_screenings(
    plot_id: uuid.UUID,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DeforestationScreeningHistory:
    organization_id = _tenant_id(current_user)
    # Vérifie l'appartenance à la parcelle avant de consulter son historique.
    await _get_plot(plot_id, organization_id, db)
    filters = [
        AuditEvent.organization_id == organization_id,
        AuditEvent.object_type == "plot",
        AuditEvent.object_id == plot_id,
        AuditEvent.action == _SCREENING_ACTION,
    ]
    total = (await db.execute(
        select(func.count()).select_from(AuditEvent).where(*filters)
    )).scalar_one() or 0
    events = (await db.execute(
        select(AuditEvent)
        .where(*filters)
        .order_by(AuditEvent.occurred_at.desc(), AuditEvent.id.desc())
        .limit(limit)
        .offset(offset)
    )).scalars().all()
    items: list[DeforestationScreeningOut] = []
    for event in events:
        if event.new_data:
            items.append(DeforestationScreeningOut.model_validate(event.new_data))
    return DeforestationScreeningHistory(items=items, total=total, limit=limit, offset=offset)
