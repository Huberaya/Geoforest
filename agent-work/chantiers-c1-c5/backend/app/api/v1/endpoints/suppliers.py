"""Endpoints Fournisseurs (Chantier 3)."""
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
from app.models.suppliers import Supplier, SupplierInvitation, SupplierRiskRating, SupplierStatus, SupplierType
from app.schemas.suppliers import (
    SupplierCreate,
    SupplierInviteOut,
    SupplierList,
    SupplierOut,
    SupplierUpdate,
)
from app.services.audit.service import model_snapshot, record_audit_event
from app.services.supplier_portal import (
    PURPOSE_INVITATION,
    PURPOSE_LOGIN,
    deliver_supplier_link,
    hash_jti,
    issue_supplier_link,
    supplier_link_url,
    utc_now,
)

router = APIRouter()


def _can_manage_suppliers(user: User) -> bool:
    return user.role in (UserRole.admin, UserRole.compliance, UserRole.procurement)


def _supplier_to_out(supplier: Supplier, shipments_count: int = 0) -> SupplierOut:
    """Convertit un Supplier ORM en SupplierOut en contournant le problème `_sa_instance_state`."""
    data = {c.name: getattr(supplier, c.name) for c in supplier.__table__.columns}
    data["shipments_count"] = shipments_count
    return SupplierOut.model_validate(data)


async def _get_supplier_for_user(
    supplier_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> Supplier:
    ensure_operator_user(user)
    if user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")
    result = await db.execute(
        select(Supplier).where(
            Supplier.id == supplier_id,
            Supplier.organization_id == user.organization_id,
        )
    )
    supplier = result.scalar_one_or_none()
    if supplier is None:
        raise HTTPException(status_code=404, detail="Fournisseur introuvable.")
    return supplier


@router.get(
    "/suppliers",
    response_model=SupplierList,
    summary="Liste des fournisseurs de l'organisation",
)
async def list_suppliers(
    q: Optional[str] = Query(default=None, max_length=100, description="Recherche texte"),
    status: Optional[SupplierStatus] = None,
    risk: Optional[SupplierRiskRating] = None,
    country: Optional[str] = Query(default=None, max_length=2),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SupplierList:
    ensure_operator_user(current_user)
    if current_user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")

    from sqlalchemy.orm import selectinload  # noqa: F401

    base = select(Supplier).where(Supplier.organization_id == current_user.organization_id)
    if q:
        like = f"%{q.lower()}%"
        base = base.where(
            func.lower(Supplier.name).like(like)
            | (Supplier.email.isnot(None) & func.lower(func.coalesce(Supplier.email, "")).like(like))
            | (Supplier.contact_name.isnot(None) & func.lower(func.coalesce(Supplier.contact_name, "")).like(like))
        )
    if status:
        base = base.where(Supplier.status == status)
    if risk:
        base = base.where(Supplier.risk_rating == risk)
    if country:
        base = base.where(Supplier.country == country.upper())

    # Compter
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar_one()

    # Agrégats
    by_status_q = (
        select(Supplier.status, func.count())
        .where(Supplier.organization_id == current_user.organization_id)
        .group_by(Supplier.status)
    )
    by_risk_q = (
        select(Supplier.risk_rating, func.count())
        .where(Supplier.organization_id == current_user.organization_id)
        .group_by(Supplier.risk_rating)
    )
    by_status = {s.value: c for s, c in (await db.execute(by_status_q)).all()}
    by_risk = {r.value: c for r, c in (await db.execute(by_risk_q)).all()}

    # Items
    items_q = base.order_by(Supplier.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(items_q)
    items = result.scalars().all()

    # Nombre de lots par fournisseur (approximatif ; sera précisé quand Shipment sera branché)
    from app.models.products import Shipment
    if items:
        ids = [i.id for i in items]
        sc = (
            select(Shipment.supplier_id, func.count())
            .where(Shipment.supplier_id.in_(ids))
            .group_by(Shipment.supplier_id)
        )
        counts = {sid: c for sid, c in (await db.execute(sc)).all()}
    else:
        counts = {}

    out = [_supplier_to_out(s, counts.get(s.id, 0)) for s in items]

    return SupplierList(items=out, total=total, by_status=by_status, by_risk=by_risk)


@router.post(
    "/suppliers",
    response_model=SupplierOut,
    status_code=201,
    summary="Créer un fournisseur",
)
async def create_supplier(
    payload: SupplierCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SupplierOut:
    if not _can_manage_suppliers(current_user):
        raise HTTPException(status_code=403, detail="Rôle insuffisant pour créer un fournisseur.")
    assert current_user.organization_id is not None

    # Unicité légère (name + country)
    dup = await db.execute(
        select(Supplier).where(
            Supplier.organization_id == current_user.organization_id,
            func.lower(Supplier.name) == payload.name.lower(),
            Supplier.country == payload.country.upper(),
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="Un fournisseur avec ce nom et ce pays existe déjà dans votre organisation.",
        )

    supplier = Supplier(
        organization_id=current_user.organization_id,
        name=payload.name.strip(),
        legal_name=payload.legal_name.strip() if payload.legal_name else None,
        supplier_type=payload.supplier_type or SupplierType.other,
        status=SupplierStatus.pending,
        country=payload.country.upper(),
        address=payload.address,
        region=payload.region,
        email=payload.email.lower() if payload.email else None,
        phone=payload.phone,
        website=payload.website,
        tax_id=payload.tax_id,
        registration_number=payload.registration_number,
        eori=payload.eori,
        contact_name=payload.contact_name,
        contact_email=payload.contact_email.lower() if payload.contact_email else None,
        contact_phone=payload.contact_phone,
        notes=payload.notes,
    )
    db.add(supplier)
    await db.flush()

    # Alerte onboarding réussie (1er fournisseur)
    sup_count = (await db.execute(
        select(func.count()).select_from(Supplier).where(Supplier.organization_id == current_user.organization_id)
    )).scalar_one()
    if sup_count == 1:
        db.add(Alert(
            organization_id=current_user.organization_id,
            user_id=current_user.id,
            level=AlertLevel.success,
            category=AlertCategory.onboarding,
            title="Premier fournisseur créé 🎉",
            message="Ajoutez maintenant un produit EUDR associé, puis vos premiers lots.",
            link="/products",
            context={"supplier_id": str(supplier.id)},
        ))

    record_audit_event(
        db, request,
        organization_id=current_user.organization_id,
        actor_user_id=current_user.id,
        action="supplier.created",
        object_type="supplier",
        object_id=supplier.id,
        new_data=model_snapshot(supplier, exclude_fields={"invite_token"}),
    )
    await db.commit()
    await db.refresh(supplier)
    so = _supplier_to_out(supplier, 0)
    so.shipments_count = 0
    return so


@router.get(
    "/suppliers/{supplier_id}",
    response_model=SupplierOut,
    summary="Détail d'un fournisseur",
)
async def get_supplier(
    supplier_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SupplierOut:
    supplier = await _get_supplier_for_user(supplier_id, current_user, db)
    from app.models.products import Shipment
    sc = (
        await db.execute(
            select(func.count()).select_from(Shipment).where(Shipment.supplier_id == supplier.id)
        )
    ).scalar_one()
    so = _supplier_to_out(supplier, 0)
    so.shipments_count = sc or 0
    return so


@router.patch(
    "/suppliers/{supplier_id}",
    response_model=SupplierOut,
    summary="Mettre à jour un fournisseur",
)
async def update_supplier(
    supplier_id: uuid.UUID,
    payload: SupplierUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SupplierOut:
    if not _can_manage_suppliers(current_user):
        raise HTTPException(status_code=403, detail="Rôle insuffisant pour modifier un fournisseur.")
    supplier = await _get_supplier_for_user(supplier_id, current_user, db)
    before = model_snapshot(supplier, exclude_fields={"invite_token"})

    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        if k == "country" and isinstance(v, str):
            v = v.upper()
        if k in ("email", "contact_email") and isinstance(v, str):
            v = v.lower()
        setattr(supplier, k, v)
    record_audit_event(
        db, request,
        organization_id=current_user.organization_id,
        actor_user_id=current_user.id,
        action="supplier.updated",
        object_type="supplier",
        object_id=supplier.id,
        previous_data=before,
        new_data=model_snapshot(supplier, exclude_fields={"invite_token"}),
    )
    await db.commit()
    await db.refresh(supplier)
    return _supplier_to_out(supplier, 0)


@router.delete(
    "/suppliers/{supplier_id}",
    status_code=204,
    summary="Archiver un fournisseur",
)
async def archive_supplier(
    supplier_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if current_user.role not in (UserRole.admin, UserRole.compliance):
        raise HTTPException(status_code=403, detail="Seuls admin et compliance peuvent archiver.")
    supplier = await _get_supplier_for_user(supplier_id, current_user, db)
    before = model_snapshot(supplier, exclude_fields={"invite_token"})

    # Vérifie qu'aucun lot actif n'y fait référence
    from app.models.products import Shipment
    active = await db.execute(
        select(func.count()).select_from(Shipment).where(
            Shipment.supplier_id == supplier.id,
            Shipment.status.notin_(("draft", "rejected")),
        )
    )
    if (active.scalar_one() or 0) > 0:
        raise HTTPException(
            status_code=409,
            detail="Impossible d'archiver : des lots actifs référencent ce fournisseur.",
        )
    supplier.status = SupplierStatus.archived
    record_audit_event(
        db, request,
        organization_id=current_user.organization_id,
        actor_user_id=current_user.id,
        action="supplier.archived",
        object_type="supplier",
        object_id=supplier.id,
        previous_data=before,
        new_data=model_snapshot(supplier, exclude_fields={"invite_token"}),
    )
    await db.commit()
    return None


@router.post(
    "/suppliers/{supplier_id}/invite",
    response_model=SupplierInviteOut,
    summary="Générer un lien magique fournisseur",
)
async def invite_supplier(
    supplier_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.admin, UserRole.compliance, UserRole.procurement)),
) -> SupplierInviteOut:
    """Génère un lien signé à usage unique; l'email n'est marqué envoyé qu'après succès SMTP."""
    supplier = await _get_supplier_for_user(supplier_id, current_user, db)
    # Serialize les rotations d'invitation sur la ligne fournisseur (effectif sous PostgreSQL).
    await db.execute(select(Supplier.id).where(Supplier.id == supplier.id).with_for_update())
    target_email = (supplier.contact_email or supplier.email or "").strip().lower()
    if not target_email:
        raise HTTPException(
            status_code=422,
            detail="Renseignez un email de contact avant de générer une invitation.",
        )
    if supplier.status in (SupplierStatus.suspended, SupplierStatus.archived):
        raise HTTPException(status_code=409, detail="Un fournisseur suspendu ou archivé ne peut pas accéder au portail.")

    existing_user = (await db.execute(
        select(User).where(func.lower(User.email) == target_email)
    )).scalar_one_or_none()
    if existing_user and not (
        existing_user.role == UserRole.supplier
        and existing_user.supplier_id == supplier.id
        and existing_user.organization_id == supplier.organization_id
        and existing_user.is_active
    ):
        raise HTTPException(
            status_code=409,
            detail="Cet email est déjà associé à un autre compte. Vérifiez l'identité avant de poursuivre.",
        )
    purpose = PURPOSE_LOGIN if existing_user else PURPOSE_INVITATION

    now = utc_now()
    previous = model_snapshot(supplier, exclude_fields={"invite_token"})
    pending_links = (await db.execute(
        select(SupplierInvitation)
        .where(
            SupplierInvitation.supplier_id == supplier.id,
            SupplierInvitation.organization_id == supplier.organization_id,
            SupplierInvitation.consumed_at.is_(None),
            SupplierInvitation.revoked_at.is_(None),
        )
        .with_for_update()
    )).scalars().all()
    for old_link in pending_links:
        old_link.revoked_at = now
        record_audit_event(
            db, request,
            organization_id=supplier.organization_id,
            actor_user_id=current_user.id,
            action="supplier.invitation_revoked",
            object_type="supplier",
            object_id=supplier.id,
            previous_data={"invitation_id": str(old_link.id), "status": "pending"},
            new_data={"invitation_id": str(old_link.id), "status": "revoked"},
        )

    token, jti, expires_at = issue_supplier_link(
        supplier_id=supplier.id,
        organization_id=supplier.organization_id,
        email=target_email,
        purpose=purpose,
        now=now,
    )
    invitation = SupplierInvitation(
        organization_id=supplier.organization_id,
        supplier_id=supplier.id,
        created_by_user_id=current_user.id,
        target_email=target_email,
        purpose=purpose,
        jti_hash=hash_jti(jti),
        expires_at=expires_at,
    )
    supplier.portal_enabled = True
    # Ancien jeton aléatoire non expirant : ne plus l'utiliser et l'effacer lors du renouvellement.
    supplier.invite_token = None
    supplier.invite_sent_at = None
    db.add(invitation)
    db.add(supplier)
    await db.flush()

    invite_snapshot = model_snapshot(supplier, exclude_fields={"invite_token"})
    invite_snapshot.update({
        "invite_token_generated": True,
        "invitation_id": str(invitation.id),
        "invitation_expires_at": expires_at.isoformat(),
        "invitation_purpose": purpose,
        "delivery_status": "generated",
    })
    record_audit_event(
        db, request,
        organization_id=supplier.organization_id,
        actor_user_id=current_user.id,
        action="supplier.invited" if purpose == PURPOSE_INVITATION else "supplier.login_link_generated",
        object_type="supplier",
        object_id=supplier.id,
        previous_data=previous,
        new_data=invite_snapshot,
    )
    await db.commit()
    await db.refresh(supplier)
    await db.refresh(invitation)

    raw_url = supplier_link_url(token)
    delivery = await deliver_supplier_link(target_email, supplier.name, raw_url, purpose)
    if delivery == "sent":
        sent_at = utc_now()
        invitation.sent_at = sent_at
        supplier.invite_sent_at = sent_at
        record_audit_event(
            db, request,
            organization_id=supplier.organization_id,
            actor_user_id=current_user.id,
            action="supplier.invitation_sent",
            object_type="supplier",
            object_id=supplier.id,
            previous_data={"invitation_id": str(invitation.id), "delivery_status": "generated"},
            new_data={"invitation_id": str(invitation.id), "delivery_status": "sent", "sent_at": sent_at.isoformat()},
        )
    elif delivery == "failed":
        record_audit_event(
            db, request,
            organization_id=supplier.organization_id,
            actor_user_id=current_user.id,
            action="supplier.invitation_delivery_failed",
            object_type="supplier",
            object_id=supplier.id,
            previous_data={"invitation_id": str(invitation.id), "delivery_status": "generated"},
            new_data={"invitation_id": str(invitation.id), "delivery_status": "failed"},
        )
    delivery_status = {
        "sent": "email_sent",
        "not_configured": "ready_to_share",
        "failed": "email_failed",
    }[delivery]

    db.add(Alert(
        organization_id=supplier.organization_id,
        user_id=current_user.id,
        level=AlertLevel.info if delivery == "sent" else AlertLevel.warning,
        category=AlertCategory.supplier,
        title=f"Lien portail fournisseur — {supplier.name}",
        message=(
            "Le lien magique a été envoyé par email."
            if delivery == "sent" else
            "Le lien a été généré mais n'a pas été envoyé par email; transmettez-le manuellement."
        ),
        link=f"/suppliers/{supplier.id}",
        context={
            "supplier_id": str(supplier.id),
            "invitation_id": str(invitation.id),
            "delivery_status": delivery_status,
        },
    ))
    await db.commit()
    await db.refresh(supplier)

    data = _supplier_to_out(supplier, 0).model_dump()
    return SupplierInviteOut(
        **data,
        invitation_id=invitation.id,
        invitation_expires_at=expires_at,
        delivery_status=delivery_status,
        # Le lien est rendu une seule fois à l'opérateur seulement quand l'email n'a pas été envoyé.
        invitation_url=None if delivery == "sent" else raw_url,
    )
