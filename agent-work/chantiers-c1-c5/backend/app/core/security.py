"""Sécurité : hachage Argon2, JWT, dépendances d'auth et RBAC."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models import User, UserRole

logger = logging.getLogger(__name__)

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.api_v1_prefix}/auth/login",
    auto_error=False,
)


# --------------------------------------------------------------------------- Mots de passe
def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        return False


# --------------------------------------------------------------------------- JWT
def _create_token(sub: str, token_type: str, expires_delta_seconds: int, extra: dict[str, Any] | None = None) -> tuple[str, str]:
    """Retourne (token, jti)."""
    now = datetime.now(timezone.utc)
    jti = uuid.uuid4().hex
    payload: dict[str, Any] = {
        "sub": sub,
        "type": token_type,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(now.timestamp()) + expires_delta_seconds,
        "iss": "geoforest-trace",
    }
    if extra:
        payload.update(extra)
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    return token, jti


def create_access_token(user: User) -> str:
    extra = {
        "org_id": str(user.organization_id) if user.organization_id else None,
        "role": user.role.value,
    }
    token, _ = _create_token(
        sub=str(user.id),
        token_type="access",
        expires_delta_seconds=int(settings.access_token_expire_timedelta.total_seconds()),
        extra=extra,
    )
    return token


def create_refresh_token(user: User) -> str:
    token, _ = _create_token(
        sub=str(user.id),
        token_type="refresh",
        expires_delta_seconds=int(settings.refresh_token_expire_timedelta.total_seconds()),
    )
    return token


def decode_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            issuer="geoforest-trace",
        )
        return payload
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalide ou expiré",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# --------------------------------------------------------------------------- Dépendances FastAPI
async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentification requise",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Type de token invalide")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token mal formé")
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur indisponible")
    return user


async def get_current_active_user(user: User = Depends(get_current_user)) -> User:
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Compte désactivé")
    return user


def require_roles(*roles: UserRole):
    """Dépendance : exige un rôle donné (OU sur les rôles)."""

    async def _check(user: User = Depends(get_current_active_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Rôle '{user.role.value}' insuffisant. Rôles requis : {', '.join(r.value for r in roles)}",
            )
        return user

    return _check


# --------------------------------------------------------------------------- Isolation tenant

def ensure_operator_user(user: User) -> User:
    """Interdit aux comptes fournisseurs d'utiliser les vues globales de l'opérateur."""
    if user.role == UserRole.supplier:
        raise HTTPException(
            status_code=403,
            detail="Un compte fournisseur doit utiliser les routes dédiées à son portail.",
        )
    return user


async def get_tenant_org_id(user: User = Depends(get_current_active_user)) -> uuid.UUID:
    """Retourne l'organisation d'un membre interne, jamais un scope fournisseur global."""
    ensure_operator_user(user)
    if not user.organization_id:
        raise HTTPException(status_code=403, detail="Utilisateur sans organisation")
    return user.organization_id


def require_org_member(db_model_class):
    """Décorateur futur : assure que la ressource appartient à l'organisation du user.
    Non utilisé pour les chantiers 1 car pas de ressources métier créées à ce stade."""
    ...
