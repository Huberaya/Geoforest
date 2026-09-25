"""Endpoints Produits (Chantier 3)."""
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
from app.models.products import EUDR_COMMODITIES, Product, ProductStatus
from app.schemas.suppliers import (
    CommoditiesList,
    Commodity,
    ProductCreate,
    ProductList,
    ProductOut,
    ProductUpdate,
)
from app.services.audit.service import model_snapshot, record_audit_event

router = APIRouter()


def _can_manage(user: User) -> bool:
    return user.role in (UserRole.admin, UserRole.compliance, UserRole.procurement)


def _product_to_out(p: Product, shipments_count: int = 0) -> ProductOut:
    data = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    data["shipments_count"] = shipments_count
    data["commodity_label"] = _commodity_label(p.commodity)
    return ProductOut.model_validate(data)


def _commodity_label(code: str) -> Optional[str]:
    for c in EUDR_COMMODITIES:
        if c["code"] == code:
            return c["label"]
    return None


async def _get_product_for_user(
    product_id: uuid.UUID, user: User, db: AsyncSession
) -> Product:
    ensure_operator_user(user)
    if user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")
    r = await db.execute(
        select(Product).where(Product.id == product_id, Product.organization_id == user.organization_id)
    )
    p = r.scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="Produit introuvable.")
    return p


@router.get("/commodities", response_model=CommoditiesList, summary="Liste des commodités EUDR (Annexe I)")
async def list_commodities(
    _: User = Depends(get_current_active_user),
) -> CommoditiesList:
    return CommoditiesList(items=[Commodity(**c) for c in EUDR_COMMODITIES])


@router.get("/products", response_model=ProductList, summary="Liste des produits")
async def list_products(
    q: Optional[str] = Query(default=None, max_length=100),
    commodity: Optional[str] = None,
    status: Optional[ProductStatus] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ProductList:
    ensure_operator_user(current_user)
    if current_user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    from app.models.products import Shipment

    base = select(Product).where(Product.organization_id == current_user.organization_id)
    if q:
        like = f"%{q.lower()}%"
        base = base.where(
            func.lower(Product.name).like(like)
            | func.lower(func.coalesce(Product.hs_code, "")).like(like)
        )
    if commodity:
        base = base.where(Product.commodity == commodity)
    if status:
        base = base.where(Product.status == status)

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()

    res = await db.execute(base.order_by(Product.created_at.desc()).limit(limit).offset(offset))
    items = res.scalars().all()

    counts = {}
    if items:
        ids = [i.id for i in items]
        sc = await db.execute(
            select(Shipment.product_id, func.count())
            .where(Shipment.product_id.in_(ids))
            .group_by(Shipment.product_id)
        )
        counts = {pid: c for pid, c in sc.all()}

    out = [_product_to_out(p, counts.get(p.id, 0)) for p in items]
    return ProductList(items=out, total=total)


@router.post("/products", response_model=ProductOut, status_code=201, summary="Créer un produit")
async def create_product(
    payload: ProductCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ProductOut:
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Rôle insuffisant.")
    assert current_user.organization_id is not None

    # Validation commodité
    if payload.commodity not in {c["code"] for c in EUDR_COMMODITIES}:
        raise HTTPException(
            status_code=422,
            detail=[
                {"loc": ["body", "commodity"], "msg": "Commodité EUDR inconnue. Utilisez /commodities.", "type": "value_error"}
            ],
        )

    # Auto-rempli hs_code si non fourni
    hs = payload.hs_code
    if not hs:
        for c in EUDR_COMMODITIES:
            if c["code"] == payload.commodity:
                hs = c["hs"]
                break

    dup = await db.execute(
        select(Product).where(
            Product.organization_id == current_user.organization_id,
            func.lower(Product.name) == payload.name.lower(),
            Product.commodity == payload.commodity,
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Un produit avec ce nom et cette commodité existe déjà.")

    product = Product(
        organization_id=current_user.organization_id,
        name=payload.name.strip(),
        commodity=payload.commodity,
        hs_code=hs,
        description=payload.description,
        status=ProductStatus.active,
    )
    db.add(product)
    await db.flush()

    # Alerte premier produit
    pcount = (await db.execute(
        select(func.count()).select_from(Product).where(Product.organization_id == current_user.organization_id)
    )).scalar_one()
    if pcount == 1:
        db.add(Alert(
            organization_id=current_user.organization_id,
            user_id=current_user.id,
            level=AlertLevel.success,
            category=AlertCategory.onboarding,
            title="Premier produit EUDR créé 🎉",
            message="Créez maintenant votre premier lot liant un fournisseur à ce produit.",
            link="/shipments",
            context={"product_id": str(product.id), "commodity": product.commodity},
        ))

    record_audit_event(
        db, request,
        organization_id=current_user.organization_id,
        actor_user_id=current_user.id,
        action="product.created",
        object_type="product",
        object_id=product.id,
        new_data=model_snapshot(product),
    )
    await db.commit()
    await db.refresh(product)
    return _product_to_out(product, 0)


@router.get("/products/{product_id}", response_model=ProductOut, summary="Détail d'un produit")
async def get_product(
    product_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ProductOut:
    p = await _get_product_for_user(product_id, current_user, db)
    from app.models.products import Shipment
    c = (await db.execute(
        select(func.count()).select_from(Shipment).where(Shipment.product_id == p.id)
    )).scalar_one()
    return _product_to_out(p, c or 0)


@router.patch("/products/{product_id}", response_model=ProductOut, summary="Modifier un produit")
async def update_product(
    product_id: uuid.UUID,
    payload: ProductUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> ProductOut:
    if not _can_manage(current_user):
        raise HTTPException(status_code=403, detail="Rôle insuffisant.")
    p = await _get_product_for_user(product_id, current_user, db)
    before = model_snapshot(p)
    data = payload.model_dump(exclude_unset=True)
    if "commodity" in data and data["commodity"] not in {c["code"] for c in EUDR_COMMODITIES}:
        raise HTTPException(status_code=422, detail="Commodité EUDR inconnue.")
    for k, v in data.items():
        setattr(p, k, v)
    record_audit_event(
        db, request,
        organization_id=current_user.organization_id,
        actor_user_id=current_user.id,
        action="product.updated",
        object_type="product",
        object_id=p.id,
        previous_data=before,
        new_data=model_snapshot(p),
    )
    await db.commit()
    await db.refresh(p)
    return _product_to_out(p, 0)


@router.delete("/products/{product_id}", status_code=204, summary="Archiver un produit")
async def archive_product(
    product_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if current_user.role not in (UserRole.admin, UserRole.compliance):
        raise HTTPException(status_code=403, detail="Seuls admin/compliance peuvent archiver.")
    p = await _get_product_for_user(product_id, current_user, db)
    before = model_snapshot(p)
    from app.models.products import Shipment
    active = (await db.execute(
        select(func.count()).select_from(Shipment).where(
            Shipment.product_id == p.id, Shipment.status.notin_(("draft", "rejected"))
        )
    )).scalar_one()
    if (active or 0) > 0:
        raise HTTPException(status_code=409, detail="Des lots actifs référencent ce produit.")
    p.status = ProductStatus.archived
    record_audit_event(
        db, request,
        organization_id=current_user.organization_id,
        actor_user_id=current_user.id,
        action="product.archived",
        object_type="product",
        object_id=p.id,
        previous_data=before,
        new_data=model_snapshot(p),
    )
    await db.commit()
    return None
