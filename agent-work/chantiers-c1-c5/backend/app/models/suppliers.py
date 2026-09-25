"""Modèle Supplier (fournisseurs) — GeoForest Trace (Chantier 3).

Un fournisseur est un acteur de la chaîne d'approvisionnement d'un opérateur (tenant).
Il peut être un producteur direct, une coopérative, un négociant, un transformateur, etc.
Les utilisateurs ayant le rôle `supplier` sont rattachés à un Supplier via User.supplier_id.
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
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import UUIDType, Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SupplierType(str, enum.Enum):
    producer = "producer"          # Producteur direct / exploitation agricole ou forestière
    cooperative = "cooperative"    # Coopérative / groupement de producteurs
    trader = "trader"              # Négociant / courtier
    processor = "processor"        # Transformateur / usine
    other = "other"


class SupplierStatus(str, enum.Enum):
    pending = "pending"            # Créé, aucune donnée validée
    active = "active"              # Actif
    suspended = "suspended"        # Suspendu (anomalie)
    archived = "archived"          # Archivé (inactif)


class SupplierRiskRating(str, enum.Enum):
    unknown = "unknown"
    low = "low"
    medium = "medium"
    high = "high"


class Supplier(Base):
    """Un fournisseur dans la base d'un opérateur (tenant)."""
    __tablename__ = "suppliers"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", "country", name="uq_supplier_org_name_country"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Identité
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    legal_name: Mapped[str | None] = mapped_column(String(250))
    supplier_type: Mapped[SupplierType] = mapped_column(
        SAEnum(SupplierType, name="suppliertype"), default=SupplierType.other, nullable=False
    )
    status: Mapped[SupplierStatus] = mapped_column(
        SAEnum(SupplierStatus, name="supplierstatus"), default=SupplierStatus.pending, nullable=False
    )

    # Localisation
    country: Mapped[str] = mapped_column(String(2), nullable=False, index=True)  # ISO 3166-1 alpha-2
    address: Mapped[str | None] = mapped_column(Text)
    region: Mapped[str | None] = mapped_column(String(150))

    # Coordonnées
    email: Mapped[str | None] = mapped_column(String(250))
    phone: Mapped[str | None] = mapped_column(String(50))
    website: Mapped[str | None] = mapped_column(String(250))

    # Identifiants légaux
    tax_id: Mapped[str | None] = mapped_column(String(100))
    registration_number: Mapped[str | None] = mapped_column(String(100))
    eori: Mapped[str | None] = mapped_column(String(50))

    # Contact privilégié
    contact_name: Mapped[str | None] = mapped_column(String(200))
    contact_email: Mapped[str | None] = mapped_column(String(250))
    contact_phone: Mapped[str | None] = mapped_column(String(50))

    # Évaluation du risque (sera alimentée par le moteur de risque au chantier 8)
    risk_rating: Mapped[SupplierRiskRating] = mapped_column(
        SAEnum(SupplierRiskRating, name="supplierriskrating"),
        default=SupplierRiskRating.unknown,
        nullable=False,
    )

    notes: Mapped[str | None] = mapped_column(Text)

    # Invitations portail fournisseur
    portal_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    invite_token: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    invite_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow
    )

    # Relations
    def __repr__(self) -> str:  # pragma: no cover
        return f"<Supplier {self.name} ({self.country}) org={self.organization_id}>"


class SupplierInvitation(Base):
    """Invitation ou lien magique fournisseur; aucun jeton brut n'est conservé."""
    __tablename__ = "supplier_invitations"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    target_email: Mapped[str] = mapped_column(String(250), nullable=False, index=True)
    purpose: Mapped[str] = mapped_column(String(20), nullable=False, default="invitation")
    jti_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def __repr__(self) -> str:  # pragma: no cover
        return f"<SupplierInvitation {self.id} purpose={self.purpose} supplier={self.supplier_id}>"
