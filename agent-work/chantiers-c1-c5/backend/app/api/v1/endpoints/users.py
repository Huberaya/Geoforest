"""Gestion des utilisateurs d'une organisation."""
from __future__ import annotations

import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import ensure_operator_user, get_current_active_user, hash_password, require_roles, verify_password
from app.models import User, UserRole
from app.schemas.auth import UserOut
from app.schemas.user import PasswordChangeRequest, UserProfileUpdate
from app.services.audit.service import model_snapshot, record_audit_event

router = APIRouter()

# Les snapshots de compte ne doivent jamais contenir un hash ni l'identifiant de rotation JWT.
_SENSITIVE_USER_FIELDS = {"password_hash", "refresh_token_jti"}


def _user_snapshot(user: User) -> dict:
    return model_snapshot(user, exclude_fields=_SENSITIVE_USER_FIELDS)


def _audit_user_change(
    db: AsyncSession,
    request: Request,
    *,
    actor: User,
    target: User,
    action: str,
    previous_data: dict | None,
    new_data: dict | None,
) -> None:
    # Les identités sans organisation n'ont pas encore de journal global : refuser la
    # mutation plutôt que de laisser silencieusement une opération critique sans audit.
    if actor.organization_id is None:
        raise HTTPException(
            status_code=403,
            detail="Ce compte n'est rattaché à aucune organisation et ne peut pas effectuer cette opération auditée.",
        )
    record_audit_event(
        db,
        request,
        organization_id=actor.organization_id,
        actor_user_id=actor.id,
        action=action,
        object_type="user",
        object_id=target.id,
        previous_data=previous_data,
        new_data=new_data,
    )


class UserInviteRequest(BaseModel):
    email: str = Field(..., max_length=255)
    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    role: UserRole = UserRole.viewer


@router.get(
    "/me",
    response_model=UserOut,
    summary="Profil de l'utilisateur connecté",
)
async def my_profile(current_user: User = Depends(get_current_active_user)) -> UserOut:
    return UserOut.model_validate(current_user)


@router.patch(
    "/me",
    response_model=UserOut,
    summary="Mettre à jour mon profil",
)
async def update_my_profile(
    payload: UserProfileUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> UserOut:
    before = _user_snapshot(current_user)
    # `exclude_unset` évite de remettre à la valeur par défaut un champ non envoyé.
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    after = _user_snapshot(current_user)
    if before != after:
        _audit_user_change(
            db,
            request,
            actor=current_user,
            target=current_user,
            action="user.profile_updated",
            previous_data=before,
            new_data=after,
        )
    db.add(current_user)
    return UserOut.model_validate(current_user)


@router.post(
    "/me/password",
    summary="Changer mon mot de passe",
)
async def change_my_password(
    payload: PasswordChangeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> dict:
    if not current_user.password_hash or not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Mot de passe actuel incorrect.")
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit être différent.")

    # Seul l'état de credential est journalisé : aucun mot de passe ni hash n'est stocké dans l'audit.
    previous_data = {"credential_state": "password_configured"}
    current_user.password_hash = hash_password(payload.new_password)
    db.add(current_user)
    _audit_user_change(
        db,
        request,
        actor=current_user,
        target=current_user,
        action="user.password_changed",
        previous_data=previous_data,
        new_data={"credential_state": "password_updated"},
    )
    return {"message": "Mot de passe mis à jour."}


@router.get(
    "/",
    response_model=list[UserOut],
    dependencies=[Depends(require_roles(UserRole.admin, UserRole.compliance))],
    summary="Liste des membres de mon organisation",
)
async def list_organization_users(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
) -> list[UserOut]:
    result = await db.execute(
        select(User)
        .where(User.organization_id == user.organization_id)
        .order_by(User.created_at.desc())
    )
    return [UserOut.model_validate(u) for u in result.scalars().all()]


@router.post(
    "/invite",
    response_model=UserOut,
    status_code=201,
    dependencies=[Depends(require_roles(UserRole.admin))],
    summary="Inviter un membre dans l'organisation (admin)",
)
async def invite_user(
    payload: UserInviteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> UserOut:
    existing = await db.execute(select(User).where(User.email == payload.email.lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Un utilisateur avec cet email existe déjà")

    # Le rôle "supplier" ne s'invite pas par ce canal (portail fournisseur uniquement)
    if payload.role == UserRole.supplier:
        raise HTTPException(
            status_code=400,
            detail="Les comptes fournisseurs sont créés via le portail fournisseur dédié.",
        )

    new_user = User(
        organization_id=current_user.organization_id,
        email=payload.email.lower(),
        password_hash=hash_password(secrets.token_urlsafe(24)),
        first_name=payload.first_name,
        last_name=payload.last_name,
        role=payload.role,
        is_active=True,
    )
    db.add(new_user)
    await db.flush()
    await db.refresh(new_user)
    _audit_user_change(
        db,
        request,
        actor=current_user,
        target=new_user,
        action="user.invited",
        previous_data=None,
        new_data=_user_snapshot(new_user),
    )
    # TODO (Chantier 10) : envoyer un email de bienvenue + lien de définition de mot de passe.
    return UserOut.model_validate(new_user)


@router.get(
    "/{user_id}",
    response_model=UserOut,
    summary="Détail d'un membre (isolation tenant)",
)
async def get_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> UserOut:
    ensure_operator_user(current_user)
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if target is None or target.organization_id != current_user.organization_id:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return UserOut.model_validate(target)


@router.delete(
    "/{user_id}",
    dependencies=[Depends(require_roles(UserRole.admin))],
    summary="Désactiver un membre (admin)",
)
async def deactivate_user(
    user_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> dict:
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if target is None or target.organization_id != current_user.organization_id:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas désactiver votre propre compte.")

    before = _user_snapshot(target)
    was_active = target.is_active
    target.is_active = False
    db.add(target)
    if was_active:
        _audit_user_change(
            db,
            request,
            actor=current_user,
            target=target,
            action="user.deactivated",
            previous_data=before,
            new_data=_user_snapshot(target),
        )
    return {"message": "Utilisateur désactivé.", "user_id": str(target.id)}
