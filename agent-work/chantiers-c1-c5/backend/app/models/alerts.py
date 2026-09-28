"""Notifications in-app persistantes et état de lecture par destinataire."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, UUIDType, JSONType


class AlertLevel(str, enum.Enum):
    info = "info"
    success = "success"
    warning = "warning"
    critical = "critical"


class AlertCategory(str, enum.Enum):
    onboarding = "onboarding"
    plot = "plot"
    document = "document"
    supplier = "supplier"
    analysis = "analysis"
    dds = "dds"
    compliance = "compliance"
    system = "system"


class Alert(Base):
    """Un événement de notification, propre à un tenant ou adressé à un membre."""

    __tablename__ = "alerts"
    __table_args__ = (
        UniqueConstraint("organization_id", "dedupe_key", name="uq_alerts_org_dedupe_key"),
        Index("ix_alerts_org_created_at", "organization_id", "created_at"),
        Index("ix_alerts_org_user_created_at", "organization_id", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Si renseigné, l'alerte est réservée à ce membre; sinon elle est visible par l'organisation.
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUIDType,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    level: Mapped[AlertLevel] = mapped_column(SAEnum(AlertLevel, name="alertlevel"), nullable=False)
    category: Mapped[AlertCategory] = mapped_column(SAEnum(AlertCategory, name="alertcategory"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[Optional[str]] = mapped_column(Text)
    # Les liens créés par les services doivent rester relatifs à l'application.
    link: Mapped[Optional[str]] = mapped_column(String(300))
    context: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    # Clé d'idempotence de l'événement dans le tenant; NULL reste permis pour les lignes historiques.
    dedupe_key: Mapped[Optional[str]] = mapped_column(String(180), nullable=True)

    # Conservés pour compatibilité des lignes historiques. Le nouvel état de lecture est par membre.
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Alert {self.level.value}/{self.category.value}: {self.title[:40]}>"


class AlertRecipientState(Base):
    """État lu/non lu individuel; une alerte partagée garde un état par destinataire."""

    __tablename__ = "alert_recipient_states"
    __table_args__ = (
        Index("ix_alert_recipient_states_user_read", "user_id", "is_read"),
    )

    alert_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType,
        ForeignKey("alerts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
