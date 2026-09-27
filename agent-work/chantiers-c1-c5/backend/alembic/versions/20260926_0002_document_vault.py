"""Add the tenant-scoped C7 document vault, immutable versions and configured checklist.

Revision ID: 20260926_0002
Revises: 20260925_0001
Create Date: 2026-09-26

Additive migration only. It does not delete or rewrite existing audit history.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260926_0002"
down_revision = "20260925_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("category", sa.String(length=50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("issuer_name", sa.String(length=200), nullable=True),
        sa.Column("reference_number", sa.String(length=120), nullable=True),
        sa.Column("issued_at", sa.Date(), nullable=True),
        sa.Column("expires_at", sa.Date(), nullable=True),
        sa.Column("country_code", sa.String(length=2), nullable=True),
        sa.Column("commodity_code", sa.String(length=50), nullable=True),
        sa.Column("current_version_number", sa.Integer(), nullable=False),
        sa.Column("review_status", sa.String(length=20), server_default="to_review", nullable=False),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("supplier_visible", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("is_archived", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("review_status IN ('to_review', 'reviewed', 'follow_up')", name="ck_documents_review_status"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_documents_organization_id", "documents", ["organization_id"], unique=False)
    op.create_index("ix_documents_created_by_user_id", "documents", ["created_by_user_id"], unique=False)
    op.create_index("ix_documents_category", "documents", ["category"], unique=False)
    op.create_index("ix_documents_org_expires", "documents", ["organization_id", "expires_at"], unique=False)

    op.create_table(
        "document_versions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("uploaded_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("scan_status", sa.String(length=20), server_default="clean", nullable=False),
        sa.Column("scanner_name", sa.String(length=80), server_default="ClamAV", nullable=False),
        sa.Column("scanned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("file_size_bytes > 0", name="ck_document_version_positive_size"),
        sa.CheckConstraint("scan_status IN ('clean', 'infected', 'error')", name="ck_document_version_scan_status"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "version_number", name="uq_document_version_number"),
        sa.UniqueConstraint("storage_key", name="uq_document_version_storage_key"),
    )
    op.create_index("ix_document_versions_organization_id", "document_versions", ["organization_id"], unique=False)
    op.create_index("ix_document_versions_document_id", "document_versions", ["document_id"], unique=False)
    op.create_index("ix_document_versions_uploaded_by_user_id", "document_versions", ["uploaded_by_user_id"], unique=False)
    op.create_index("ix_document_versions_sha256", "document_versions", ["sha256"], unique=False)
    op.create_index("ix_document_versions_org_doc", "document_versions", ["organization_id", "document_id"], unique=False)

    op.create_table(
        "document_links",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("target_type", sa.String(length=20), nullable=False),
        sa.Column("target_id", sa.String(length=36), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("target_type IN ('supplier', 'shipment', 'product', 'plot')", name="ck_document_link_target_type"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "target_type", "target_id", name="uq_document_link_target"),
    )
    op.create_index("ix_document_links_organization_id", "document_links", ["organization_id"], unique=False)
    op.create_index("ix_document_links_document_id", "document_links", ["document_id"], unique=False)
    op.create_index("ix_document_links_org_target", "document_links", ["organization_id", "target_type", "target_id"], unique=False)

    op.create_table(
        "document_checklist_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("scope_type", sa.String(length=20), server_default="organization", nullable=False),
        sa.Column("scope_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("category", sa.String(length=50), nullable=False),
        sa.Column("country_code", sa.String(length=2), nullable=True),
        sa.Column("commodity_code", sa.String(length=50), nullable=True),
        sa.Column("source_title", sa.String(length=200), nullable=True),
        sa.Column("source_url", sa.String(length=500), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("scope_type IN ('organization', 'supplier', 'shipment', 'product', 'plot')", name="ck_document_checklist_scope_type"),
        sa.CheckConstraint(
            "(scope_type = 'organization' AND scope_id IS NULL) OR "
            "(scope_type <> 'organization' AND scope_id IS NOT NULL)",
            name="ck_document_checklist_scope_id",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_document_checklist_items_organization_id", "document_checklist_items", ["organization_id"], unique=False)
    op.create_index("ix_document_checklist_items_created_by_user_id", "document_checklist_items", ["created_by_user_id"], unique=False)
    op.create_index("ix_document_checklist_org_active", "document_checklist_items", ["organization_id", "is_active"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_document_checklist_org_active", table_name="document_checklist_items")
    op.drop_index("ix_document_checklist_items_created_by_user_id", table_name="document_checklist_items")
    op.drop_index("ix_document_checklist_items_organization_id", table_name="document_checklist_items")
    op.drop_table("document_checklist_items")

    op.drop_index("ix_document_links_org_target", table_name="document_links")
    op.drop_index("ix_document_links_document_id", table_name="document_links")
    op.drop_index("ix_document_links_organization_id", table_name="document_links")
    op.drop_table("document_links")

    op.drop_index("ix_document_versions_org_doc", table_name="document_versions")
    op.drop_index("ix_document_versions_sha256", table_name="document_versions")
    op.drop_index("ix_document_versions_uploaded_by_user_id", table_name="document_versions")
    op.drop_index("ix_document_versions_document_id", table_name="document_versions")
    op.drop_index("ix_document_versions_organization_id", table_name="document_versions")
    op.drop_table("document_versions")

    op.drop_index("ix_documents_org_expires", table_name="documents")
    op.drop_index("ix_documents_category", table_name="documents")
    op.drop_index("ix_documents_created_by_user_id", table_name="documents")
    op.drop_index("ix_documents_organization_id", table_name="documents")
    op.drop_table("documents")
