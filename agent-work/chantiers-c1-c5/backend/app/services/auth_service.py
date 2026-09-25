"""Logique métier d'authentification."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models import Organization, User, UserRole
from app.schemas.auth import TokenPair, UserLogin, UserOut, UserRegister

logger = logging.getLogger(__name__)


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


async def register_organization_owner(db: AsyncSession, payload: UserRegister) -> TokenPair:
    """Inscription : crée une organisation et son premier utilisateur (rôle admin)."""
    existing = await db.execute(select(User).where(User.email == payload.email.lower()))
    if existing.scalar_one_or_none() is not None:
        raise AuthError("Un compte existe déjà avec cet email.", status_code=409)

    org = Organization(
        name=payload.organization_name,
        country=(payload.organization_country or "FR").upper(),
        eori=payload.eori,
        contact_email=payload.email.lower(),
        plan="pme",
    )
    db.add(org)
    await db.flush()

    user = User(
        organization_id=org.id,
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        first_name=payload.first_name,
        last_name=payload.last_name,
        role=UserRole.admin,
        is_active=True,
        email_verified_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    return _build_token_pair(user)


async def authenticate(db: AsyncSession, payload: UserLogin) -> TokenPair:
    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalar_one_or_none()
    if user is None or user.password_hash is None or not verify_password(payload.password, user.password_hash):
        raise AuthError("Email ou mot de passe incorrect.", status_code=401)
    if not user.is_active:
        raise AuthError("Compte désactivé. Contactez votre administrateur.", status_code=403)

    user.last_login_at = datetime.now(timezone.utc)
    db.add(user)

    return _build_token_pair(user)


async def refresh_tokens(db: AsyncSession, refresh_token: str) -> TokenPair:
    payload = decode_token(refresh_token)
    if payload.get("type") != "refresh":
        raise AuthError("Type de token invalide (refresh attendu).", status_code=401)
    user_id = payload.get("sub")
    if not user_id:
        raise AuthError("Token mal formé.", status_code=401)
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise AuthError("Utilisateur indisponible.", status_code=401)
    return _build_token_pair(user)


def _build_token_pair(user: User) -> TokenPair:
    access = create_access_token(user)
    refresh = create_refresh_token(user)
    return TokenPair(
        access_token=access,
        refresh_token=refresh,
        expires_in=int(settings.access_token_expire_timedelta.total_seconds()),
        user=UserOut.model_validate(user),
    )
