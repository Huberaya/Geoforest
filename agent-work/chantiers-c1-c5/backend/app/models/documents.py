"""C7 — Coffre documentaire, versions et checklist configurée par le tenant.

Les pièces sont des éléments de dossier; les modèles ne donnent jamais un verdict de légalité.
Les binaires restent dans le stockage objet privé, pas dans PostgreSQL.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, UUIDType


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Document(Base):
    """Fiche logique d'une pièce; chaque nouveau binaire est une version immuable."""

    __tablename__ = "documents"
    __table_args__ = (
        CheckConstraint(
            "review_status IN ('to_review', 'reviewed', 'follow_up')",
            name="ck_documents_review_status",
        ),
        Index("ix_documents_org_expires", "organization_id", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    issuer_name: Mapped[str | None] = mapped_column(String(200))
    reference_number: Mapped[str | None] = mapped_column(String(120))
    issued_at: Mapped[date | None] = mapped_column(Date)
    expires_at: Mapped[date | None] = mapped_column(Date)
    country_code: Mapped[str | None] = mapped_column(String(2))
    commodity_code: Mapped[str | None] = mapped_column(String(50))

    current_version_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    review_status: Mapped[str] = mapped_column(String(20), default="to_review", nullable=False)
    review_note: Mapped[str | None] = mapped_column(Text)
    supplier_visible: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow, nullable=False
    )

    versions: Mapped[list["DocumentVersion"]] = relationship(
        "DocumentVersion",
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="DocumentVersion.version_number",
    )
    links: Mapped[list["DocumentLink"]] = relationship(
        "DocumentLink", back_populates="document", cascade="all, delete-orphan"
    )


class DocumentVersion(Base):
    """Une version binaire analysée et stockée sous une clé objet non réutilisée."""

    __tablename__ = "document_versions"
    __table_args__ = (
        UniqueConstraint("document_id", "version_number", name="uq_document_version_number"),
        UniqueConstraint("storage_key", name="uq_document_version_storage_key"),
        CheckConstraint("file_size_bytes > 0", name="ck_document_version_positive_size"),
        CheckConstraint(
            "scan_status IN ('clean', 'infected', 'error')",
            name="ck_document_version_scan_status",
        ),
        Index("ix_document_versions_org_doc", "organization_id", "document_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    scan_status: Mapped[str] = mapped_column(String(20), default="clean", nullable=False)
    scanner_name: Mapped[str] = mapped_column(String(80), default="ClamAV", nullable=False)
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )

    document: Mapped[Document] = relationship("Document", back_populates="versions")


class DocumentLink(Base):
    """Lien tenant-scopé vers un fournisseur, un produit, un lot ou une parcelle.

    `target_id` est polymorphe; les routes valident systématiquement que la cible appartient
    à l'organisation avant de créer le lien ou de le lire.
    """

    __tablename__ = "document_links"
    __table_args__ = (
        UniqueConstraint("document_id", "target_type", "target_id", name="uq_document_link_target"),
        CheckConstraint(
            "target_type IN ('supplier', 'shipment', 'product', 'plot')",
            name="ck_document_link_target_type",
        ),
        Index("ix_document_links_org_target", "organization_id", "target_type", "target_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUIDType, nullable=False)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )

    document: Mapped[Document] = relationship("Document", back_populates="links")


class DocumentChecklistItem(Base):
    """Élément de checklist explicitement configuré par l'organisation.

    Le champ source est une référence saisie par le tenant, pas une règle juridique validée
    par le système. Le statut reçu/manquant est un suivi documentaire uniquement.
    """

    __tablename__ = "document_checklist_items"
    __table_args__ = (
        CheckConstraint(
            "scope_type IN ('organization', 'supplier', 'shipment', 'product', 'plot')",
            name="ck_document_checklist_scope_type",
        ),
        CheckConstraint(
            "(scope_type = 'organization' AND scope_id IS NULL) OR "
            "(scope_type <> 'organization' AND scope_id IS NOT NULL)",
            name="ck_document_checklist_scope_id",
        ),
        Index("ix_document_checklist_org_active", "organization_id", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False, default="organization")
    scope_id: Mapped[uuid.UUID | None] = mapped_column(UUIDType)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    country_code: Mapped[str | None] = mapped_column(String(2))
    commodity_code: Mapped[str | None] = mapped_column(String(50))
    source_title: Mapped[str | None] = mapped_column(String(200))
    source_url: Mapped[str | None] = mapped_column(String(500))
    note: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow, nullable=False
    )
