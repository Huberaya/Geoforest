"""Endpoints de gestion de l'organisation (tenant)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import ensure_operator_user, get_current_active_user, require_roles
from app.models import Organization, User, UserRole
from app.schemas.auth import OrganizationOut

router = APIRouter()


@router.get("/me", response_model=OrganizationOut)
async def get_my_organization(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
) -> OrganizationOut:
    """Retourne l'organisation d'un membre interne."""
    ensure_operator_user(user)
    if not user.organization_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Aucune organisation associée à cet utilisateur")
    result = await db.execute(select(Organization).where(Organization.id == user.organization_id))
    org = result.scalar_one_or_none()
    if org is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Organisation introuvable")
    return OrganizationOut.model_validate(org)


@router.get("/stats", dependencies=[Depends(require_roles(UserRole.admin, UserRole.compliance))])
async def org_stats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
) -> dict:
    """KPIs rapides — enrichi au fur et à mesure des chantiers.
    Pour le Chantier 1, retourne les compteurs basiques (users)."""
    return {
        "organization_id": str(user.organization_id),
        "users_count": 0,  # sera calculé avec une requête réelle quand les modèles métier arriveront
        "chantier": 1,
        "note": "Les KPIs métier (fournisseurs, parcelles, dossiers) seront ajoutés par les prochains chantiers.",
    }
