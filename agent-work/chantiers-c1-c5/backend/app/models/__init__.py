"""Modèles SQLAlchemy — GeoForest Trace.

Chantier 1 : models de base (Organization, User) et enums.
Les autres entités (suppliers, plots, documents…) sont ajoutées dans les chantiers suivants.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import UUIDType
from app.core.database import JSONType  # défini ci-dessous en fonction du dialecte

from app.core.database import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(str, enum.Enum):
    """Rôles au sein d'une organisation (RBAC)."""
    admin = "admin"              # accès complet (tenant)
    compliance = "compliance"    # responsable conformité
    procurement = "procurement"  # achats / fournisseurs
    analyst = "analyst"          # analystes (lecture + actions d'analyse)
    viewer = "viewer"            # lecture seule
    supplier = "supplier"        # utilisateur externe fournisseur


class Organization(Base):
    """Une entreprise cliente du SaaS (tenant)."""
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String(250))
    siret: Mapped[str | None] = mapped_column(String(50))
    eori: Mapped[str | None] = mapped_column(String(50), index=True)
    address: Mapped[str | None] = mapped_column(Text)
    country: Mapped[str] = mapped_column(String(2), default="FR")
    # Plan tarifaire (n'affecte pas les features en MVP, préparé pour la tarification future)
    plan: Mapped[str] = mapped_column(String(30), default="pme")
    contact_email: Mapped[str | None] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow
    )

    # Relations
    users: Mapped[list["User"]] = relationship(back_populates="organization", cascade="all, delete-orphan")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Organization {self.name} ({self.id})>"


class User(Base):
    """Utilisateur du SaaS, rattaché à une organisation (ou à un fournisseur pour rôle=supplier)."""
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,  # nullable pour les super-admins futurs
        index=True,
    )
    # Pour les utilisateurs fournisseurs, référence vers le supplier (ajoutée au chantier 3)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType,
        ForeignKey("suppliers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(512))  # null = magic link (fournisseur)
    first_name: Mapped[str | None] = mapped_column(String(100))
    last_name: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(50))
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole, name="userrole"), default=UserRole.viewer, nullable=False)
    locale: Mapped[str] = mapped_column(String(5), default="fr")

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    refresh_token_jti: Mapped[str | None] = mapped_column(String(128))  # pour invalidation
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow
    )

    # Relations
    organization: Mapped["Organization | None"] = relationship(back_populates="users")
    supplier: Mapped["Supplier | None"] = relationship(
        "Supplier", foreign_keys=[supplier_id], back_populates=None
    )

    @property
    def full_name(self) -> str:
        parts = [p for p in (self.first_name, self.last_name) if p]
        return " ".join(parts) if parts else self.email

    def has_role(self, *roles: UserRole) -> bool:
        return self.role in roles

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User {self.email} role={self.role.value} org={self.organization_id}>"


# Import des sous-modules pour qu'ils soient enregistrés auprès de Base.metadata
from app.models.alerts import Alert  # noqa: E402,F401
from app.models.suppliers import Supplier, SupplierInvitation  # noqa: E402,F401
from app.models.products import Product, Shipment  # noqa: E402,F401
from app.models.plots import Plot  # noqa: E402,F401
from app.models.audit import AuditEvent  # noqa: E402,F401

all_models = (Organization, User, Alert, Supplier, SupplierInvitation, Product, Shipment, Plot, AuditEvent)
