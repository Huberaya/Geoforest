"""Modèles du Chantier 2 : Alertes.

Les alertes sont générées par le système (ex: "parcelle non géolocalisée",
"document expirant dans 30 jours") ou par des actions utilisateur.
Elles sont filtrées par organisation et (optionnellement) assignées à un utilisateur.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, String, Text, Boolean, func
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
    """Une alerte affichée dans le centre d'alertes et sur le dashboard."""
    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Si assignée à un utilisateur spécifique ; sinon visible par toute l'organisation
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
    # Lien relatif dans l'application (ex: '/plots/xxx')
    link: Mapped[Optional[str]] = mapped_column(String(300))
    # Métadonnées (ids d'entités liées, etc.)
    context: Mapped[dict] = mapped_column(JSONType, default=dict)

    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(), server_default=func.now()
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Alert {self.level.value}/{self.category.value}: {self.title[:40]}>"
