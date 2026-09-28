"""API du centre de notifications persistantes, tenant et destinataire scopée."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_active_user, get_tenant_org_id
from app.models import User
from app.models.alerts import AlertCategory, AlertLevel
from app.schemas.alerts import AlertListOut, AlertReadAllOut, AlertUnreadCountOut
from app.services.notifications import (
    count_user_unread_alerts,
    list_user_alerts,
    mark_all_user_alerts_read,
    set_user_alert_read,
)

router = APIRouter()


@router.get("", response_model=AlertListOut, summary="Lister les notifications visibles par l'utilisateur")
async def list_alerts(
    is_read: bool | None = Query(default=None),
    level: AlertLevel | None = Query(default=None),
    category: AlertCategory | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
    organization_id: uuid.UUID = Depends(get_tenant_org_id),
) -> AlertListOut:
    result = await list_user_alerts(
        db,
        organization_id=organization_id,
        user_id=user.id,
        limit=limit,
        offset=offset,
        is_read=is_read,
        level=level,
        category=category,
    )
    return AlertListOut.model_validate(result)


@router.get("/unread-count", response_model=AlertUnreadCountOut, summary="Compter les notifications non lues")
async def unread_count(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
    organization_id: uuid.UUID = Depends(get_tenant_org_id),
) -> AlertUnreadCountOut:
    count = await count_user_unread_alerts(db, organization_id=organization_id, user_id=user.id)
    return AlertUnreadCountOut(count=count)


@router.post("/read-all", response_model=AlertReadAllOut, summary="Tout marquer comme lu pour l'utilisateur courant")
async def read_all_alerts(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
    organization_id: uuid.UUID = Depends(get_tenant_org_id),
) -> AlertReadAllOut:
    updated_count = await mark_all_user_alerts_read(
        db,
        organization_id=organization_id,
        user_id=user.id,
    )
    await db.commit()
    return AlertReadAllOut(updated_count=updated_count)


@router.post("/{alert_id}/read", summary="Marquer une notification comme lue")
async def mark_alert_read(
    alert_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
    organization_id: uuid.UUID = Depends(get_tenant_org_id),
) -> dict[str, object]:
    alert = await set_user_alert_read(
        db,
        organization_id=organization_id,
        user_id=user.id,
        alert_id=alert_id,
        is_read=True,
    )
    if alert is None:
        raise HTTPException(status_code=404, detail="Notification introuvable")
    await db.commit()
    return {"ok": True, "alert_id": str(alert.id)}


@router.post("/{alert_id}/unread", summary="Marquer une notification comme non lue")
async def mark_alert_unread(
    alert_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
    organization_id: uuid.UUID = Depends(get_tenant_org_id),
) -> dict[str, object]:
    alert = await set_user_alert_read(
        db,
        organization_id=organization_id,
        user_id=user.id,
        alert_id=alert_id,
        is_read=False,
    )
    if alert is None:
        raise HTTPException(status_code=404, detail="Notification introuvable")
    await db.commit()
    return {"ok": True, "alert_id": str(alert.id)}
