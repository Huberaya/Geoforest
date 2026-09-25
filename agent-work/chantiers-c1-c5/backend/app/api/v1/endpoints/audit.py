"""Audit trail API — tenant-scoped, restricted to admin/compliance."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import User, UserRole
from app.models.audit import AuditEvent
from app.schemas.audit import AuditEventList, AuditEventOut

router = APIRouter()


@router.get("/audit-log", response_model=AuditEventList, summary="Journal d'audit de l'organisation")
async def list_audit_events(
    object_type: Optional[str] = Query(default=None, max_length=60),
    object_id: Optional[uuid.UUID] = None,
    action: Optional[str] = Query(default=None, max_length=100),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> AuditEventList:
    if current_user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")
    if current_user.role not in (UserRole.admin, UserRole.compliance):
        raise HTTPException(status_code=403, detail="Seuls les rôles admin et conformité peuvent consulter l'audit trail.")

    filters = [AuditEvent.organization_id == current_user.organization_id]
    if object_type:
        filters.append(AuditEvent.object_type == object_type)
    if action:
        filters.append(AuditEvent.action == action)
    if object_id is not None:
        filters.append(AuditEvent.object_id == object_id)

    total = (await db.execute(
        select(func.count()).select_from(AuditEvent).where(*filters)
    )).scalar_one() or 0
    rows = (await db.execute(
        select(AuditEvent, User.email)
        .outerjoin(User, User.id == AuditEvent.actor_user_id)
        .where(*filters)
        .order_by(AuditEvent.occurred_at.desc(), AuditEvent.id.desc())
        .limit(limit)
        .offset(offset)
    )).all()

    items = [
        AuditEventOut(
            id=event.id,
            organization_id=event.organization_id,
            actor_user_id=event.actor_user_id,
            actor_email=email,
            action=event.action,
            object_type=event.object_type,
            object_id=event.object_id,
            occurred_at=event.occurred_at,
            ip_address=event.ip_address,
            user_agent=event.user_agent,
            previous_data=event.previous_data,
            new_data=event.new_data,
        )
        for event, email in rows
    ]
    return AuditEventList(items=items, total=total)
