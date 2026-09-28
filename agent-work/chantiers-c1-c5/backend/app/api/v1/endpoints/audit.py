"""Audit trail API — tenant-scoped, restricted to admin/compliance."""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import User, UserRole
from app.models.audit import AuditEvent
from app.schemas.audit import AuditEventList, AuditEventOut

router = APIRouter()
_PARIS = ZoneInfo("Europe/Paris")
_GEO_SENSITIVE_FIELDS = {
    "geometry",
    "geojson",
    "geom",
    "centroid",
    "bbox",
    "coordinates",
    "coordinate",
    "latitude",
    "longitude",
    "lat",
    "lon",
    "lng",
    "gps_coordinates",
}
_REDACTED_GEO_VALUE = "[donnée géospatiale masquée]"


def _redact_geo_snapshot(value: Any) -> Any:
    """Hide precise geodata in API responses while retaining the original DB audit snapshot."""
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            normalized = str(key).strip().lower().replace("-", "_")
            if normalized in _GEO_SENSITIVE_FIELDS or normalized.endswith("_coordinates"):
                redacted[str(key)] = None if item is None else _REDACTED_GEO_VALUE
            else:
                redacted[str(key)] = _redact_geo_snapshot(item)
        return redacted
    if isinstance(value, list):
        return [_redact_geo_snapshot(item) for item in value]
    return value


def _paris_day_start_utc(value: date) -> datetime:
    return datetime.combine(value, time.min, tzinfo=_PARIS).astimezone(timezone.utc)


@router.get("/audit-log", response_model=AuditEventList, summary="Journal d'audit de l'organisation")
async def list_audit_events(
    object_type: Optional[str] = Query(default=None, max_length=60),
    object_id: Optional[uuid.UUID] = None,
    action: Optional[str] = Query(default=None, max_length=100),
    actor_user_id: Optional[uuid.UUID] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> AuditEventList:
    if current_user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")
    if current_user.role not in (UserRole.admin, UserRole.compliance):
        raise HTTPException(status_code=403, detail="Seuls les rôles admin et conformité peuvent consulter l'audit trail.")
    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(status_code=422, detail="La date de début doit être antérieure ou égale à la date de fin.")

    filters = [AuditEvent.organization_id == current_user.organization_id]
    if object_type:
        filters.append(AuditEvent.object_type == object_type)
    if action:
        filters.append(AuditEvent.action == action)
    if object_id is not None:
        filters.append(AuditEvent.object_id == object_id)
    if actor_user_id is not None:
        filters.append(AuditEvent.actor_user_id == actor_user_id)
    if from_date is not None:
        filters.append(AuditEvent.occurred_at >= _paris_day_start_utc(from_date))
    if to_date is not None:
        end_exclusive = _paris_day_start_utc(to_date + timedelta(days=1))
        filters.append(AuditEvent.occurred_at < end_exclusive)

    total = (await db.execute(
        select(func.count()).select_from(AuditEvent).where(*filters)
    )).scalar_one() or 0
    rows = (await db.execute(
        select(AuditEvent, User.email)
        .outerjoin(
            User,
            and_(
                User.id == AuditEvent.actor_user_id,
                User.organization_id == current_user.organization_id,
            ),
        )
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
            previous_data=_redact_geo_snapshot(event.previous_data),
            new_data=_redact_geo_snapshot(event.new_data),
        )
        for event, email in rows
    ]
    return AuditEventList(items=items, total=total)
