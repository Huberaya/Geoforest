"""Endpoints Parcelles (Plots) — Chantier 4."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import ensure_operator_user, get_current_active_user
from app.models import User, UserRole
from app.models.plots import Plot, PlotStatus
from app.models.products import Shipment, ShipmentStatus
from app.schemas.plots import PlotCreate, PlotList, PlotOut, PlotUpdate, PlotValidateResult
from app.services.audit.service import record_audit_event
from app.services.plots.service import (
    apply_validation,
    create_plot_from_payload,
    get_shipment_commodity,
    plot_snapshot,
    revalidate_plot,
    validate_plot_payload,
)

router = APIRouter()
_WRITE_ROLES = (UserRole.admin, UserRole.compliance, UserRole.procurement, UserRole.analyst)


def _can_write(user: User) -> bool:
    return user.role in _WRITE_ROLES


def _serialize(plot: Plot) -> PlotOut:
    data = {column.name: getattr(plot, column.name) for column in plot.__table__.columns}
    data["validation_errors"] = plot.validation_errors or []
    data["validation_warnings"] = plot.validation_warnings or []
    shipment = plot.shipment
    data["shipment_reference"] = shipment.reference if shipment else None
    data["supplier_name"] = shipment.supplier.name if shipment and shipment.supplier else None
    data["product_name"] = shipment.product.name if shipment and shipment.product else None
    return PlotOut.model_validate(data)


async def _get_plot_for_user(
    plot_id: uuid.UUID, user: User, db: AsyncSession, *, with_relations: bool = False
) -> Plot:
    ensure_operator_user(user)
    if user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")
    query = select(Plot).where(
        Plot.id == plot_id,
        Plot.organization_id == user.organization_id,
    )
    if with_relations:
        query = query.options(
            selectinload(Plot.shipment).selectinload(Shipment.supplier),
            selectinload(Plot.shipment).selectinload(Shipment.product),
        )
    result = await db.execute(query)
    plot = result.scalar_one_or_none()
    if plot is None:
        raise HTTPException(status_code=404, detail="Parcelle introuvable.")
    return plot


@router.get("/plots", response_model=PlotList, summary="Liste des parcelles")
async def list_plots(
    shipment_id: Optional[uuid.UUID] = None,
    status: Optional[PlotStatus] = None,
    valid_only: bool = Query(default=False),
    invalid_only: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> PlotList:
    ensure_operator_user(current_user)
    if current_user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    base = (
        select(Plot)
        .where(Plot.organization_id == current_user.organization_id)
        .options(
            selectinload(Plot.shipment).selectinload(Shipment.supplier),
            selectinload(Plot.shipment).selectinload(Shipment.product),
        )
    )
    if shipment_id:
        base = base.where(Plot.shipment_id == shipment_id)
    if status:
        base = base.where(Plot.status == status)
    if valid_only:
        base = base.where(Plot.status == PlotStatus.valid)
    if invalid_only:
        base = base.where(Plot.status.in_([PlotStatus.invalid, PlotStatus.rejected]))

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one() or 0
    total_area = (await db.execute(
        select(func.coalesce(func.sum(Plot.area_ha), 0.0)).where(
            Plot.organization_id == current_user.organization_id,
            Plot.status.in_([PlotStatus.valid, PlotStatus.analyzed]),
        )
    )).scalar_one() or 0.0
    status_rows = (await db.execute(
        select(Plot.status, func.count())
        .where(Plot.organization_id == current_user.organization_id)
        .group_by(Plot.status)
    )).all()
    by_status = {status_value.value: count for status_value, count in status_rows}
    invalid_count = by_status.get(PlotStatus.invalid.value, 0) + by_status.get(PlotStatus.rejected.value, 0)
    awaiting_count = by_status.get(PlotStatus.draft.value, 0) + by_status.get(PlotStatus.validating.value, 0)

    rows = await db.execute(base.order_by(Plot.created_at.desc()).limit(limit).offset(offset))
    plots = rows.scalars().all()
    return PlotList(
        items=[_serialize(plot) for plot in plots],
        total=total,
        total_area_ha=float(total_area or 0.0),
        by_status=by_status,
        invalid_count=invalid_count,
        awaiting_validation_count=awaiting_count,
    )


@router.post("/plots", response_model=PlotOut, status_code=201, summary="Créer une parcelle et valider la géométrie")
async def create_plot(
    payload: PlotCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> PlotOut:
    if not _can_write(current_user):
        raise HTTPException(status_code=403, detail="Rôle insuffisant.")
    if current_user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    plot = await create_plot_from_payload(db, current_user.organization_id, current_user.id, payload)
    record_audit_event(
        db,
        request,
        organization_id=current_user.organization_id,
        actor_user_id=current_user.id,
        action="plot.created",
        object_type="plot",
        object_id=plot.id,
        new_data=plot_snapshot(plot),
    )
    await db.commit()
    plot = await _get_plot_for_user(plot.id, current_user, db, with_relations=True)
    return _serialize(plot)


@router.get("/plots/{plot_id}", response_model=PlotOut, summary="Détail d'une parcelle")
async def get_plot(
    plot_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> PlotOut:
    plot = await _get_plot_for_user(plot_id, current_user, db, with_relations=True)
    return _serialize(plot)


@router.patch("/plots/{plot_id}", response_model=PlotOut, summary="Modifier une parcelle")
async def update_plot(
    plot_id: uuid.UUID,
    payload: PlotUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> PlotOut:
    if not _can_write(current_user):
        raise HTTPException(status_code=403, detail="Rôle insuffisant.")
    if current_user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    plot = await _get_plot_for_user(plot_id, current_user, db)
    before = plot_snapshot(plot)
    changes = payload.model_dump(exclude_unset=True)
    requested_ref = changes.get("internal_ref")
    if requested_ref and requested_ref != plot.internal_ref:
        duplicate_ref = (await db.execute(
            select(Plot.id).where(
                Plot.organization_id == current_user.organization_id,
                Plot.shipment_id == plot.shipment_id,
                Plot.internal_ref == requested_ref,
                Plot.id != plot.id,
            )
        )).scalar_one_or_none()
        if duplicate_ref is not None:
            raise HTTPException(status_code=409, detail="Cette référence de parcelle existe déjà pour ce lot.")
    new_geometry = changes.pop("geojson", None)
    if new_geometry is not None:
        plot.geometry = new_geometry
    for key, value in changes.items():
        setattr(plot, key, value)

    if new_geometry is not None or "declared_area_ha" in changes:
        commodity_code = await get_shipment_commodity(
            db, current_user.organization_id, plot.shipment_id
        )
        await revalidate_plot(plot, commodity_code)
        # La géométrie a éventuellement modifiée le workflow; elle reste en validation,
        # sans prétendre que le lot est analysé contre la déforestation.
    record_audit_event(
        db,
        request,
        organization_id=current_user.organization_id,
        actor_user_id=current_user.id,
        action="plot.updated",
        object_type="plot",
        object_id=plot.id,
        previous_data=before,
        new_data=plot_snapshot(plot),
    )
    await db.commit()
    plot = await _get_plot_for_user(plot_id, current_user, db, with_relations=True)
    return _serialize(plot)


@router.post("/plots/{plot_id}/validate", response_model=PlotValidateResult, summary="Relancer la validation technique")
async def validate_plot(
    plot_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> PlotValidateResult:
    if not _can_write(current_user):
        raise HTTPException(status_code=403, detail="Rôle insuffisant.")
    if current_user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    plot = await _get_plot_for_user(plot_id, current_user, db)
    if plot.geometry is None:
        raise HTTPException(status_code=409, detail="Aucune géométrie à valider.")
    before = plot_snapshot(plot)
    commodity_code = await get_shipment_commodity(
        db, current_user.organization_id, plot.shipment_id
    )
    outcome = validate_plot_payload(plot.geometry, plot.declared_area_ha, commodity_code)
    apply_validation(plot, outcome)
    record_audit_event(
        db,
        request,
        organization_id=current_user.organization_id,
        actor_user_id=current_user.id,
        action="plot.validated",
        object_type="plot",
        object_id=plot.id,
        previous_data=before,
        new_data=plot_snapshot(plot),
    )
    await db.commit()
    return PlotValidateResult(
        plot_id=plot.id,
        valid=outcome.valid,
        area_ha=outcome.area_ha,
        vertex_count=outcome.vertex_count,
        geometry_type=outcome.geometry_type,
        min_decimals_found=outcome.min_decimals_found,
        precision_ok=outcome.precision_ok,
        eudr_geometry_rule=outcome.eudr_geometry_rule,
        errors=outcome.errors,
        warnings=outcome.warnings,
    )


@router.delete("/plots/{plot_id}", status_code=204, summary="Supprimer une parcelle")
async def delete_plot(
    plot_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not _can_write(current_user):
        raise HTTPException(status_code=403, detail="Rôle insuffisant.")
    if current_user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    plot = await _get_plot_for_user(plot_id, current_user, db)
    previous = plot_snapshot(plot)
    shipment_id = plot.shipment_id
    record_audit_event(
        db,
        request,
        organization_id=current_user.organization_id,
        actor_user_id=current_user.id,
        action="plot.deleted",
        object_type="plot",
        object_id=plot.id,
        previous_data=previous,
    )
    await db.delete(plot)
    await db.flush()

    remaining = (await db.execute(
        select(func.count()).select_from(Plot).where(
            Plot.organization_id == current_user.organization_id,
            Plot.shipment_id == shipment_id,
        )
    )).scalar_one() or 0
    if remaining == 0:
        shipment = (await db.execute(
            select(Shipment).where(
                Shipment.id == shipment_id,
                Shipment.organization_id == current_user.organization_id,
            )
        )).scalar_one_or_none()
        if shipment and shipment.status == ShipmentStatus.awaiting_data:
            shipment.status = ShipmentStatus.draft
    await db.commit()
