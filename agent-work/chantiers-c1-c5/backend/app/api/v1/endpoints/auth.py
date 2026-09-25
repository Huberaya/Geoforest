"""Endpoints d'authentification."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import Organization, User
from app.schemas.auth import (
    MessageOut,
    RefreshRequest,
    TokenPair,
    UserLogin,
    UserOut,
    UserRegister,
)
from app.services.auth_service import AuthError, authenticate, refresh_tokens, register_organization_owner
from app.services.audit.service import model_snapshot, record_audit_event

router = APIRouter()


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(
    payload: UserRegister,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TokenPair:
    """Inscription : crée une nouvelle organisation et un utilisateur admin."""
    try:
        tokens = await register_organization_owner(db, payload)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    user = (await db.execute(select(User).where(User.id == tokens.user.id))).scalar_one()
    organization = (await db.execute(
        select(Organization).where(Organization.id == user.organization_id)
    )).scalar_one()
    record_audit_event(
        db, request,
        organization_id=organization.id,
        actor_user_id=user.id,
        action="organization.created",
        object_type="organization",
        object_id=organization.id,
        new_data=model_snapshot(organization),
    )
    record_audit_event(
        db, request,
        organization_id=organization.id,
        actor_user_id=user.id,
        action="user.registered",
        object_type="user",
        object_id=user.id,
        new_data=model_snapshot(user, exclude_fields={"password_hash", "refresh_token_jti"}),
    )
    return tokens


@router.post("/login", response_model=TokenPair)
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db)) -> TokenPair:
    try:
        return await authenticate(db, payload)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)) -> TokenPair:
    try:
        return await refresh_tokens(db, payload.refresh_token)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_active_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/logout", response_model=MessageOut)
async def logout(user: User = Depends(get_current_active_user)) -> MessageOut:
    """En pratique, le client doit supprimer les tokens ; le refresh est invalidable
    par rotation côté serveur (implémentation V2)."""
    return MessageOut(message="Déconnecté (supprimez les tokens côté client).")
