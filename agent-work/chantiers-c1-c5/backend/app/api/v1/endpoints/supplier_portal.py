"""Portail fournisseur à liens magiques à usage unique et scope fournisseur."""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limiter import supplier_link_accept_limiter, supplier_link_request_limiter
from app.core.security import create_access_token, create_refresh_token, get_current_active_user
from app.models import User, UserRole
from app.models.suppliers import Supplier, SupplierInvitation, SupplierStatus
from app.schemas.auth import TokenPair, UserOut
from app.schemas.supplier_portal import (
    CompletenessItem,
    SupplierMagicLinkAccept,
    SupplierMagicLinkRequest,
    SupplierPortalMessage,
    SupplierPortalProfile,
    SupplierPortalProfileUpdate,
)
from app.services.audit.service import model_snapshot, record_audit_event
from app.services.supplier_portal import (
    PURPOSE_INVITATION,
    PURPOSE_LOGIN,
    decode_supplier_link,
    deliver_supplier_link,
    hash_jti,
    issue_supplier_link,
    profile_completeness,
    risk_label,
    supplier_link_url,
    utc_now,
)

router = APIRouter()

_GENERIC_LINK_MESSAGE = (
    "Si cette adresse correspond à un compte fournisseur actif, un lien de connexion sera envoyé "
    "si le service email est disponible. Sinon, contactez l'opérateur qui vous a invité."
)


def _peer_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _require_supplier_user(user: User) -> tuple[uuid.UUID, uuid.UUID]:
    if user.role != UserRole.supplier or user.organization_id is None or user.supplier_id is None:
        raise HTTPException(status_code=403, detail="Accès réservé au compte fournisseur rattaché à un fournisseur.")
    return user.organization_id, user.supplier_id


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


async def _get_current_supplier(db: AsyncSession, user: User) -> Supplier:
    organization_id, supplier_id = _require_supplier_user(user)
    supplier = (await db.execute(
        select(Supplier).where(
            Supplier.id == supplier_id,
            Supplier.organization_id == organization_id,
            Supplier.portal_enabled.is_(True),
            Supplier.status.notin_((SupplierStatus.suspended, SupplierStatus.archived)),
        )
    )).scalar_one_or_none()
    if supplier is None:
        raise HTTPException(status_code=403, detail="L'accès au portail fournisseur est désactivé.")
    return supplier


def _profile_out(supplier: Supplier) -> SupplierPortalProfile:
    percent, completed, items = profile_completeness(supplier)
    return SupplierPortalProfile(
        supplier_id=supplier.id,
        name=supplier.name,
        legal_name=supplier.legal_name,
        supplier_type=supplier.supplier_type,
        status=supplier.status,
        country=supplier.country,
        address=supplier.address,
        region=supplier.region,
        phone=supplier.phone,
        contact_name=supplier.contact_name,
        contact_email=supplier.contact_email or supplier.email,
        contact_phone=supplier.contact_phone,
        tax_id=supplier.tax_id,
        registration_number=supplier.registration_number,
        eori=supplier.eori,
        risk_rating=supplier.risk_rating,
        risk_label=risk_label(supplier.risk_rating.value),
        completeness_percent=percent,
        completeness_completed=completed,
        completeness_total=len(items),
        completeness_items=[CompletenessItem(**item) for item in items],
    )


@router.post(
    "/request-link",
    response_model=SupplierPortalMessage,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Demander un lien magique de connexion fournisseur",
)
async def request_magic_link(
    payload: SupplierMagicLinkRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> SupplierPortalMessage:
    email = str(payload.email).strip().lower()
    email_digest = hashlib.sha256(email.encode("utf-8")).hexdigest()
    allowed, _ = supplier_link_request_limiter.hit(f"{_peer_key(request)}:{email_digest}")
    if not allowed:
        raise HTTPException(status_code=429, detail="Trop de demandes. Réessayez plus tard.")

    # Réponse identique pour comptes existants/inexistants afin de limiter l'énumération.
    if settings.smtp_host:
        user = (await db.execute(
            select(User).where(
                func.lower(User.email) == email,
                User.role == UserRole.supplier,
                User.is_active.is_(True),
                User.supplier_id.is_not(None),
                User.organization_id.is_not(None),
            )
        )).scalar_one_or_none()
        if user:
            try:
                supplier = await _get_current_supplier(db, user)
            except HTTPException:
                # Garder la même réponse pour les comptes désactivés/sans portail.
                return SupplierPortalMessage(message=_GENERIC_LINK_MESSAGE)
            now = utc_now()
            # Sérialise la génération de liens concurrents pour ce fournisseur (PostgreSQL).
            await db.execute(
                select(Supplier.id).where(Supplier.id == supplier.id).with_for_update()
            )
            prior_links = (await db.execute(
                select(SupplierInvitation)
                .where(
                    SupplierInvitation.supplier_id == supplier.id,
                    SupplierInvitation.target_email == email,
                    SupplierInvitation.purpose == PURPOSE_LOGIN,
                    SupplierInvitation.consumed_at.is_(None),
                    SupplierInvitation.revoked_at.is_(None),
                )
                .with_for_update()
            )).scalars().all()
            for old_link in prior_links:
                old_link.revoked_at = now

            token, jti, expires_at = issue_supplier_link(
                supplier_id=supplier.id,
                organization_id=supplier.organization_id,
                email=email,
                purpose=PURPOSE_LOGIN,
                now=now,
            )
            invitation = SupplierInvitation(
                organization_id=supplier.organization_id,
                supplier_id=supplier.id,
                target_email=email,
                purpose=PURPOSE_LOGIN,
                jti_hash=hash_jti(jti),
                expires_at=expires_at,
            )
            db.add(invitation)
            await db.flush()
            record_audit_event(
                db, request,
                organization_id=supplier.organization_id,
                actor_user_id=None,
                action="supplier.login_link_generated",
                object_type="supplier",
                object_id=supplier.id,
                new_data={"invitation_id": str(invitation.id), "purpose": PURPOSE_LOGIN, "expires_at": expires_at.isoformat()},
            )
            await db.commit()

            delivery = await deliver_supplier_link(email, supplier.name, supplier_link_url(token), PURPOSE_LOGIN)
            if delivery == "sent":
                invitation.sent_at = utc_now()
                record_audit_event(
                    db, request,
                    organization_id=supplier.organization_id,
                    actor_user_id=None,
                    action="supplier.magic_link_sent",
                    object_type="supplier",
                    object_id=supplier.id,
                    new_data={"invitation_id": str(invitation.id), "sent_at": invitation.sent_at.isoformat()},
                )
                await db.commit()
            else:
                invitation.revoked_at = utc_now()
                record_audit_event(
                    db, request,
                    organization_id=supplier.organization_id,
                    actor_user_id=None,
                    action="supplier.magic_link_delivery_failed",
                    object_type="supplier",
                    object_id=supplier.id,
                    previous_data={"invitation_id": str(invitation.id), "delivery_status": "generated"},
                    new_data={"invitation_id": str(invitation.id), "delivery_status": "failed"},
                )
                record_audit_event(
                    db, request,
                    organization_id=supplier.organization_id,
                    actor_user_id=None,
                    action="supplier.invitation_revoked",
                    object_type="supplier",
                    object_id=supplier.id,
                    previous_data={"invitation_id": str(invitation.id), "status": "pending"},
                    new_data={"invitation_id": str(invitation.id), "status": "revoked", "reason": "delivery_failed"},
                )
                await db.commit()
    return SupplierPortalMessage(message=_GENERIC_LINK_MESSAGE)


@router.post(
    "/accept-link",
    response_model=TokenPair,
    summary="Consommer une invitation ou un lien magique fournisseur",
)
async def accept_magic_link(
    payload: SupplierMagicLinkAccept,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TokenPair:
    allowed, _ = supplier_link_accept_limiter.hit(_peer_key(request))
    if not allowed:
        raise HTTPException(status_code=429, detail="Trop de tentatives. Réessayez plus tard.")

    claims = decode_supplier_link(payload.token)
    if claims is None:
        raise HTTPException(status_code=401, detail="Lien invalide ou expiré.")
    try:
        supplier_id = uuid.UUID(claims["sub"])
        organization_id = uuid.UUID(claims["org_id"])
    except (ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Lien invalide ou expiré.") from None

    email = claims["email"].strip().lower()
    purpose = claims["purpose"]
    jti_hash = hash_jti(claims["jti"])
    invitation = (await db.execute(
        select(SupplierInvitation)
        .where(
            SupplierInvitation.jti_hash == jti_hash,
            SupplierInvitation.supplier_id == supplier_id,
            SupplierInvitation.organization_id == organization_id,
            SupplierInvitation.target_email == email,
            SupplierInvitation.purpose == purpose,
        )
        .with_for_update()
    )).scalar_one_or_none()
    now = utc_now()
    if (
        invitation is None
        or invitation.consumed_at is not None
        or invitation.revoked_at is not None
        or _as_utc(invitation.expires_at) <= now
    ):
        raise HTTPException(status_code=401, detail="Lien invalide, expiré ou déjà utilisé.")

    supplier = (await db.execute(
        select(Supplier).where(
            Supplier.id == supplier_id,
            Supplier.organization_id == organization_id,
            Supplier.portal_enabled.is_(True),
            Supplier.status.notin_((SupplierStatus.suspended, SupplierStatus.archived)),
        )
    )).scalar_one_or_none()
    if supplier is None:
        raise HTTPException(status_code=401, detail="Lien invalide, expiré ou déjà utilisé.")

    user = (await db.execute(
        select(User).where(func.lower(User.email) == email)
    )).scalar_one_or_none()
    user_created = False
    if user is None and purpose != PURPOSE_INVITATION:
        raise HTTPException(status_code=401, detail="Lien invalide, expiré ou déjà utilisé.")
    if user is not None and (
        user.role != UserRole.supplier
        or user.supplier_id != supplier.id
        or user.organization_id != supplier.organization_id
        or not user.is_active
    ):
        raise HTTPException(status_code=409, detail="Cet email est déjà associé à un autre compte.")

    # Consommation atomique : deux requêtes concurrentes ne peuvent pas obtenir deux sessions.
    consumed = await db.execute(
        update(SupplierInvitation)
        .where(
            SupplierInvitation.id == invitation.id,
            SupplierInvitation.jti_hash == jti_hash,
            SupplierInvitation.consumed_at.is_(None),
            SupplierInvitation.revoked_at.is_(None),
            SupplierInvitation.expires_at > now,
        )
        .values(consumed_at=now)
        .execution_options(synchronize_session=False)
    )
    if consumed.rowcount != 1:
        raise HTTPException(status_code=401, detail="Lien invalide, expiré ou déjà utilisé.")

    if user is None:
        user = User(
            organization_id=supplier.organization_id,
            supplier_id=supplier.id,
            email=email,
            password_hash=None,
            first_name=supplier.contact_name,
            role=UserRole.supplier,
            is_active=True,
            email_verified_at=now,
            locale="fr",
        )
        db.add(user)
        await db.flush()
        user_created = True
        if not supplier.contact_email:
            supplier.contact_email = email

    invitation.consumed_at = now
    user.last_login_at = now
    db.add(invitation)
    db.add(user)
    db.add(supplier)

    if user_created:
        record_audit_event(
            db, request,
            organization_id=supplier.organization_id,
            actor_user_id=user.id,
            action="supplier.portal_user_created",
            object_type="user",
            object_id=user.id,
            new_data=model_snapshot(user, exclude_fields={"password_hash", "refresh_token_jti"}),
        )
    record_audit_event(
        db, request,
        organization_id=supplier.organization_id,
        actor_user_id=user.id,
        action="supplier.invitation_accepted" if purpose == PURPOSE_INVITATION else "supplier.magic_link_used",
        object_type="supplier",
        object_id=supplier.id,
        previous_data={"invitation_id": str(invitation.id), "status": "pending"},
        new_data={"invitation_id": str(invitation.id), "status": "consumed", "user_id": str(user.id)},
    )
    await db.commit()

    return TokenPair(
        access_token=create_access_token(user),
        refresh_token=create_refresh_token(user),
        expires_in=int(settings.access_token_expire_timedelta.total_seconds()),
        user=UserOut.model_validate(user),
    )


@router.get("/me", response_model=SupplierPortalProfile, summary="Profil fournisseur et complétude")
async def supplier_portal_me(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SupplierPortalProfile:
    supplier = await _get_current_supplier(db, current_user)
    return _profile_out(supplier)


@router.patch("/me", response_model=SupplierPortalProfile, summary="Compléter mon profil fournisseur")
async def update_supplier_portal_profile(
    payload: SupplierPortalProfileUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> SupplierPortalProfile:
    supplier = await _get_current_supplier(db, current_user)
    before = model_snapshot(supplier, exclude_fields={"invite_token"})
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(supplier, field, value)
    after = model_snapshot(supplier, exclude_fields={"invite_token"})
    if before != after:
        record_audit_event(
            db, request,
            organization_id=supplier.organization_id,
            actor_user_id=current_user.id,
            action="supplier.profile_updated_by_supplier",
            object_type="supplier",
            object_id=supplier.id,
            previous_data=before,
            new_data=after,
        )
    db.add(supplier)
    await db.commit()
    await db.refresh(supplier)
    return _profile_out(supplier)
