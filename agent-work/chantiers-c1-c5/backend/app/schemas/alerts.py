"""Schémas API du centre de notifications."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.alerts import AlertCategory, AlertLevel


class AlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    level: AlertLevel
    category: AlertCategory
    title: str
    message: str | None = None
    link: str | None = None
    context: dict[str, Any] = {}
    is_read: bool
    created_at: datetime


class AlertListOut(BaseModel):
    items: list[AlertOut]
    total: int
    unread_count: int
    limit: int
    offset: int


class AlertUnreadCountOut(BaseModel):
    count: int


class AlertReadAllOut(BaseModel):
    ok: bool = True
    updated_count: int
