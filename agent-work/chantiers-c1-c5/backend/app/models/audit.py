"""Append-only audit events for sensitive and consequential changes.

Chantier 4 adds the first audited actions for geospatial parcel data. The model is
intentionally generic so later modules can record the same actor/action/object/change/IP fields.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, event, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, JSONType, UUIDType


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    object_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    object_id: Mapped[uuid.UUID] = mapped_column(UUIDType, nullable=False, index=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=func.now(), index=True
    )
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(500))
    previous_data: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    new_data: Mapped[dict[str, Any] | None] = mapped_column(JSONType)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<AuditEvent {self.action} {self.object_type}:{self.object_id}>"


@event.listens_for(AuditEvent, "before_update")
def _audit_events_are_immutable(mapper, connection, target) -> None:
    raise ValueError("AuditEvent est immuable : les événements doivent être ajoutés, jamais modifiés.")


@event.listens_for(AuditEvent, "before_delete")
def _audit_events_are_not_deleted(mapper, connection, target) -> None:
    raise ValueError("AuditEvent est immuable : les événements ne peuvent pas être supprimés via l'ORM.")
