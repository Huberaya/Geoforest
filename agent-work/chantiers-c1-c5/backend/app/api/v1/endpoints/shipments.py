"""Endpoints Lots (Shipments) — Chantier 3."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import ensure_operator_user, get_current_active_user, require_roles
from app.models import User, UserRole
from app.models.alerts import Alert, AlertCategory, AlertLevel
from app.models.products import Product, Shipment, ShipmentStatus
from app.models.suppliers import Supplier
from app.schemas.suppliers import (
    ShipmentCreate,
    ShipmentList,
    ShipmentOut,
    ShipmentUpdate,
)
from app.services.audit.service import model_snapshot, record_audit_event

router = APIRouter()


def _can_manage(user: User) -> bool:
    return user.role in (UserRole.admin, UserRole.compliance, UserRole.procurement)


async def _validate_ids(user: User, supplier_id: uuid.UUID, product_id: uuid.UUID, db: AsyncSession) -> tuple[Supplier, Product]:
    assert user.organization_id is not None
    s = (await db.execute(
        select(Supplier).where(Supplier.id == supplier_id, Supplier.organization_id == user.organization_id)
    )).scalar_one_or_none()
    p = (await db.execute(
        select(Product).where(Product.id == product_id, Product.organization_id == user.organization_id)
    )).scalar_one_or_none()
    if s is None:
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "supplier_id"], "msg": "Fournisseur introuvable.", "type": "value_error"}])
    if p is None:
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "product_id"], "msg": "Produit introuvable.", "type": "value_error"}])
    return s, p


async def _get_shipment(user: User, shipment_id: uuid.UUID, db: AsyncSession) -> Shipment:
    ensure_operator_user(user)
    if user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")
    r = await db.execute(
        select(Shipment).where(Shipment.id == shipment_id, Shipment.organization_id == user.organization_id)
    )
    sh = r.scalar_one_or_none()
    if sh is None:
        raise HTTPException(status_code=404, detail="Lot introuvable.")
    return sh


def _serialize(sh: Shipment) -> ShipmentOut:
    return ShipmentOut(
        id=str(sh.id),
        reference=sh.reference,
        supplier_id=str(sh.supplier_id),
        product_id=str(sh.product_id),
        supplier_name=getattr(sh.supplier, "name", None) if sh.supplier else None,
        product_name=getattr(sh.product, "name", None) if sh.product else None,
        commodity=getattr(sh.product, "commodity", None) if sh.product else None,
        quantity=float(sh.quantity) if sh.quantity is not None else None,
        unit=sh.unit,
        country_of_production=sh.country_of_production,
        harvest_date=sh.harvest_date,
        received_date=sh.received_date,
        status=sh.status,
        notes=sh.notes,
        created_at=sh.created_at,
        updated_at=sh.updated_at,
    )


@router.get("/shipments", response_model=ShipmentList, summary="Liste des lots")
async def list_shipments(
    q: Optional[str] = Query(default=None, max_length=100),
    status: Optional[ShipmentStatus] = None,
    supplier_id: Optional[uuid.UUID] = None,
    product_id: Optional[uuid.UUID] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ShipmentList:
    ensure_operator_user(current_user)
    if current_user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    from sqlalchemy.orm import selectinload

    base = (
        select(Shipment)
        .where(Shipment.organization_id == current_user.organization_id)
        .options(selectinload(Shipment.supplier), selectinload(Shipment.product))
    )
    if q:
        like = f"%{q.lower()}%"
        base = base.where(func.lower(Shipment.reference).like(like))
    if status:
        base = base.where(Shipment.status == status)
    if supplier_id:
        base = base.where(Shipment.supplier_id == supplier_id)
    if product_id:
        base = base.where(Shipment.product_id == product_id)

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    by_status_q = (
        select(Shipment.status, func.count())
        .where(Shipment.organization_id == current_user.organization_id)
        .group_by(Shipment.status)
    )
    by_status = {s.value: c for s, c in (await db.execute(by_status_q)).all()}

    res = await db.execute(
        base.order_by(Shipment.created_at.desc()).limit(limit).offset(offset)
    )
    items = res.scalars().all()
    return ShipmentList(items=[_serialize(s) for s in items], total=total, by_status=by_status)


@router.post("/shipments", response_model=ShipmentOut, status_code=201, summary="Créer un lot")
async def create_shipment(
    payload: ShipmentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ShipmentOut:
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Rôle insuffisant.")
    assert current_user.organization_id is not None

    sup_id = payload.supplier_id
    prod_id = payload.product_id
    await _validate_ids(current_user, sup_id, prod_id, db)

    # Unicité référence
    dup = await db.execute(
        select(Shipment).where(
            Shipment.organization_id == current_user.organization_id,
            func.lower(Shipment.reference) == payload.reference.lower(),
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Un lot avec cette référence existe déjà.")

    shipment = Shipment(
        organization_id=current_user.organization_id,
        reference=payload.reference.strip(),
        supplier_id=sup_id,
        product_id=prod_id,
        quantity=payload.quantity,
        unit=payload.unit,
        country_of_production=payload.country_of_production.upper() if payload.country_of_production else None,
        harvest_date=payload.harvest_date,
        received_date=payload.received_date,
        notes=payload.notes,
        status=ShipmentStatus.draft,
    )
    db.add(shipment)
    await db.flush()

    # Alerte onboarding
    sc = (await db.execute(
        select(func.count()).select_from(Shipment).where(Shipment.organization_id == current_user.organization_id)
    )).scalar_one()
    if sc == 1:
        db.add(Alert(
            organization_id=current_user.organization_id,
            user_id=current_user.id,
            level=AlertLevel.success,
            category=AlertCategory.onboarding,
            title="Premier lot créé 🎉",
            message="Il reste à y rattacher les parcelles géolocalisées (chantier 5) et les documents (chantier 7).",
            link="/shipments",
            context={"shipment_id": str(shipment.id)},
        ))

    record_audit_event(
        db, request,
        organization_id=current_user.organization_id,
        actor_user_id=current_user.id,
        action="shipment.created",
        object_type="shipment",
        object_id=shipment.id,
        new_data=model_snapshot(shipment),
    )
    await db.commit()
    await db.refresh(shipment)

    # Charger relations pour la sérialisation
    full = (await db.execute(
        select(Shipment)
        .where(Shipment.id == shipment.id)
        .options(
            __import__("sqlalchemy.orm", fromlist=["selectinload"]).selectinload(Shipment.supplier),
            __import__("sqlalchemy.orm", fromlist=["selectinload"]).selectinload(Shipment.product),
        )
    )).scalar_one()
    return _serialize(full)


@router.get("/shipments/{shipment_id}", response_model=ShipmentOut, summary="Détail d'un lot")
async def get_shipment(
    shipment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ShipmentOut:
    ensure_operator_user(current_user)
    from sqlalchemy.orm import selectinload
    sh = (await db.execute(
        select(Shipment)
        .where(Shipment.id == shipment_id, Shipment.organization_id == current_user.organization_id)
        .options(selectinload(Shipment.supplier), selectinload(Shipment.product))
    )).scalar_one_or_none()
    if sh is None:
        raise HTTPException(status_code=404, detail="Lot introuvable.")
    return _serialize(sh)


@router.patch("/shipments/{shipment_id}", response_model=ShipmentOut, summary="Modifier un lot")
async def update_shipment(
    shipment_id: uuid.UUID,
    payload: ShipmentUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ShipmentOut:
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Rôle insuffisant.")
    sh = await _get_shipment(current_user, shipment_id, db)
    before = model_snapshot(sh)
    data = payload.model_dump(exclude_unset=True)
    if "supplier_id" in data:
        sup_id = data["supplier_id"]
        prod_id = data.get("product_id", sh.product_id)
        await _validate_ids(current_user, sup_id, prod_id, db)
    if "product_id" in data:
        prod_id = data["product_id"]
        sup_id = data.get("supplier_id", sh.supplier_id)
        await _validate_ids(current_user, sup_id, prod_id, db)
    if "country_of_production" in data and data["country_of_production"]:
        data["country_of_production"] = data["country_of_production"].upper()
    for k, v in data.items():
        setattr(sh, k, v)
    record_audit_event(
        db, request,
        organization_id=current_user.organization_id,
        actor_user_id=current_user.id,
        action="shipment.updated",
        object_type="shipment",
        object_id=sh.id,
        previous_data=before,
        new_data=model_snapshot(sh),
    )
    await db.commit()
    from sqlalchemy.orm import selectinload
    full = (await db.execute(
        select(Shipment)
        .where(Shipment.id == sh.id)
        .options(selectinload(Shipment.supplier), selectinload(Shipment.product))
    )).scalar_one()
    return _serialize(full)


@router.delete("/shipments/{shipment_id}", status_code=204, summary="Supprimer un lot (brouillon)")
async def delete_shipment(
    shipment_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.admin, UserRole.compliance)),
):
    sh = await _get_shipment(current_user, shipment_id, db)
    before = model_snapshot(sh)
    if sh.status != ShipmentStatus.draft:
        raise HTTPException(
            status_code=409,
            detail="Seuls les lots au statut 'brouillon' peuvent être supprimés.",
        )
    record_audit_event(
        db, request,
        organization_id=current_user.organization_id,
        actor_user_id=current_user.id,
        action="shipment.deleted",
        object_type="shipment",
        object_id=sh.id,
        previous_data=before,
    )
    await db.delete(sh)
    await db.commit()
