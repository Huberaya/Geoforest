"""Schémas API d'audit trail."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AuditEventOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    actor_user_id: uuid.UUID | None
    actor_email: str | None = None
    action: str
    object_type: str
    object_id: uuid.UUID
    occurred_at: datetime
    ip_address: str | None
    user_agent: str | None
    previous_data: dict[str, Any] | None
    new_data: dict[str, Any] | None


class AuditEventList(BaseModel):
    items: list[AuditEventOut]
    total: int
