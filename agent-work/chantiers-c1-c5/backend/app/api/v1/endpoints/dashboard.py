"""Endpoint du dashboard B2B principal."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_active_user, get_tenant_org_id
from app.models import User
from app.services.dashboard.overview import build_overview, mark_alert_read, seed_onboarding_alerts

router = APIRouter()


@router.get("/overview", summary="Vue d'ensemble du dashboard (KPIs + alertes)")
async def dashboard_overview(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
    org_id: uuid.UUID = Depends(get_tenant_org_id),
) -> dict:
    # Crée paresseusement les alertes d'onboarding si c'est la 1re visite
    await seed_onboarding_alerts(db, org_id)
    await db.commit()
    return await build_overview(db, org_id)


@router.post("/alerts/{alert_id}/read", summary="Marquer une alerte comme lue")
async def read_alert(
    alert_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
    org_id: uuid.UUID = Depends(get_tenant_org_id),
) -> dict:
    a = await mark_alert_read(db, org_id, alert_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Alerte introuvable")
    await db.commit()
    return {"ok": True, "alert_id": str(a.id)}
