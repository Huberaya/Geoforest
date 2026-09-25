"""Helpers for appending auditable changes. Audit writes share the business transaction."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditEvent


def _json_safe(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def model_snapshot(model: Any, *, exclude_fields: set[str] | None = None) -> dict[str, Any]:
    """Serialize SQLAlchemy columns for before/after snapshots; never use ORM `__dict__`."""
    excluded = exclude_fields or set()
    raw = {
        column.name: getattr(model, column.name)
        for column in model.__table__.columns
        if column.name not in excluded
    }
    return _json_safe(raw)


def record_audit_event(
    db: AsyncSession,
    request: Request,
    *,
    organization_id: uuid.UUID,
    actor_user_id: uuid.UUID | None,
    action: str,
    object_type: str,
    object_id: uuid.UUID,
    previous_data: dict[str, Any] | None = None,
    new_data: dict[str, Any] | None = None,
) -> AuditEvent:
    """Append actor, action, date, object, before/after snapshots, and direct peer IP."""
    peer = request.client.host if request.client else None
    event = AuditEvent(
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action=action,
        object_type=object_type,
        object_id=object_id,
        ip_address=peer[:64] if peer else None,
        user_agent=request.headers.get("user-agent", "")[:500] or None,
        previous_data=previous_data,
        new_data=new_data,
    )
    db.add(event)
    return event
