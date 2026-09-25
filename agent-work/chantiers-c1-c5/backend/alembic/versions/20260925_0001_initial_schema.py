"""Initial PostgreSQL schema for the current GeoForest Trace models.

Revision ID: 20260925_0001
Revises:
Create Date: 2026-09-25

This is a frozen Alembic revision: it intentionally does not import live ORM
metadata at runtime. The models store plot geometries as JSONB and perform
spatial checks in the application layer; no PostGIS extension is required here.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260925_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("legal_name", sa.String(length=250), nullable=True),
        sa.Column("siret", sa.String(length=50), nullable=True),
        sa.Column("eori", sa.String(length=50), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("plan", sa.String(length=30), nullable=False),
        sa.Column("contact_email", sa.String(length=200), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_organizations_eori"), "organizations", ["eori"], unique=False)
    op.create_table(
        "products",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("commodity", sa.String(length=50), nullable=False),
        sa.Column("hs_code", sa.String(length=15), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.Enum("active", "archived", name="productstatus"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id", "name", "commodity", name="uq_product_org_name_commodity"
        ),
    )
    op.create_index(op.f("ix_products_commodity"), "products", ["commodity"], unique=False)
    op.create_index(
        op.f("ix_products_organization_id"), "products", ["organization_id"], unique=False
    )
    op.create_table(
        "suppliers",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("legal_name", sa.String(length=250), nullable=True),
        sa.Column(
            "supplier_type",
            sa.Enum("producer", "cooperative", "trader", "processor", "other", name="suppliertype"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("pending", "active", "suspended", "archived", name="supplierstatus"),
            nullable=False,
        ),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("region", sa.String(length=150), nullable=True),
        sa.Column("email", sa.String(length=250), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("website", sa.String(length=250), nullable=True),
        sa.Column("tax_id", sa.String(length=100), nullable=True),
        sa.Column("registration_number", sa.String(length=100), nullable=True),
        sa.Column("eori", sa.String(length=50), nullable=True),
        sa.Column("contact_name", sa.String(length=200), nullable=True),
        sa.Column("contact_email", sa.String(length=250), nullable=True),
        sa.Column("contact_phone", sa.String(length=50), nullable=True),
        sa.Column(
            "risk_rating",
            sa.Enum("unknown", "low", "medium", "high", name="supplierriskrating"),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("portal_enabled", sa.Boolean(), nullable=False),
        sa.Column("invite_token", sa.String(length=64), nullable=True),
        sa.Column("invite_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id", "name", "country", name="uq_supplier_org_name_country"
        ),
    )
    op.create_index(op.f("ix_suppliers_country"), "suppliers", ["country"], unique=False)
    op.create_index(op.f("ix_suppliers_invite_token"), "suppliers", ["invite_token"], unique=True)
    op.create_index(op.f("ix_suppliers_name"), "suppliers", ["name"], unique=False)
    op.create_index(
        op.f("ix_suppliers_organization_id"), "suppliers", ["organization_id"], unique=False
    )
    op.create_table(
        "shipments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("reference", sa.String(length=100), nullable=False),
        sa.Column("supplier_id", sa.String(length=36), nullable=False),
        sa.Column("product_id", sa.String(length=36), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=18, scale=4), nullable=True),
        sa.Column("unit", sa.String(length=20), nullable=True),
        sa.Column("country_of_production", sa.String(length=2), nullable=True),
        sa.Column("harvest_date", sa.Date(), nullable=True),
        sa.Column("received_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "draft", "awaiting_data", "analyzed", "ready", "rejected", name="shipmentstatus"
            ),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_shipments_country_of_production"),
        "shipments",
        ["country_of_production"],
        unique=False,
    )
    op.create_index(
        op.f("ix_shipments_organization_id"), "shipments", ["organization_id"], unique=False
    )
    op.create_index(op.f("ix_shipments_product_id"), "shipments", ["product_id"], unique=False)
    op.create_index(op.f("ix_shipments_reference"), "shipments", ["reference"], unique=False)
    op.create_index(op.f("ix_shipments_supplier_id"), "shipments", ["supplier_id"], unique=False)
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=True),
        sa.Column("supplier_id", sa.String(length=36), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=512), nullable=True),
        sa.Column("first_name", sa.String(length=100), nullable=True),
        sa.Column("last_name", sa.String(length=100), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column(
            "role",
            sa.Enum(
                "admin",
                "compliance",
                "procurement",
                "analyst",
                "viewer",
                "supplier",
                name="userrole",
            ),
            nullable=False,
        ),
        sa.Column("locale", sa.String(length=5), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refresh_token_jti", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_index(op.f("ix_users_organization_id"), "users", ["organization_id"], unique=False)
    op.create_index(op.f("ix_users_supplier_id"), "users", ["supplier_id"], unique=False)
    op.create_table(
        "alerts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column(
            "level",
            sa.Enum("info", "success", "warning", "critical", name="alertlevel"),
            nullable=False,
        ),
        sa.Column(
            "category",
            sa.Enum(
                "onboarding",
                "plot",
                "document",
                "supplier",
                "analysis",
                "dds",
                "compliance",
                "system",
                name="alertcategory",
            ),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("link", sa.String(length=300), nullable=True),
        sa.Column("context", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_alerts_organization_id"), "alerts", ["organization_id"], unique=False)
    op.create_index(op.f("ix_alerts_user_id"), "alerts", ["user_id"], unique=False)
    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("actor_user_id", sa.String(length=36), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("object_type", sa.String(length=60), nullable=False),
        sa.Column("object_id", sa.String(length=36), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column("previous_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("new_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audit_events_action"), "audit_events", ["action"], unique=False)
    op.create_index(
        op.f("ix_audit_events_actor_user_id"), "audit_events", ["actor_user_id"], unique=False
    )
    op.create_index(op.f("ix_audit_events_object_id"), "audit_events", ["object_id"], unique=False)
    op.create_index(
        op.f("ix_audit_events_object_type"), "audit_events", ["object_type"], unique=False
    )
    op.create_index(
        op.f("ix_audit_events_occurred_at"), "audit_events", ["occurred_at"], unique=False
    )
    op.create_index(
        op.f("ix_audit_events_organization_id"), "audit_events", ["organization_id"], unique=False
    )
    op.create_table(
        "plots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("shipment_id", sa.String(length=36), nullable=False),
        sa.Column("internal_ref", sa.String(length=100), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "source",
            sa.Enum("manual", "geojson", "kml", "csv", "gps", "supplier", name="plotsource"),
            nullable=False,
        ),
        sa.Column("geometry", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("geometry_type", sa.String(length=30), nullable=True),
        sa.Column("area_ha", sa.Float(), nullable=True),
        sa.Column("declared_area_ha", sa.Float(), nullable=True),
        sa.Column("vertex_count", sa.Integer(), nullable=True),
        sa.Column("centroid", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("bbox", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("min_decimals_found", sa.Integer(), nullable=True),
        sa.Column("precision_ok", sa.Boolean(), nullable=False),
        sa.Column("eudr_geometry_rule", sa.String(length=30), nullable=True),
        sa.Column("harvest_year", sa.Integer(), nullable=True),
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("gps_accuracy_m", sa.Float(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "draft", "validating", "valid", "invalid", "analyzed", "rejected", name="plotstatus"
            ),
            nullable=False,
        ),
        sa.Column("validation_errors", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("validation_warnings", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shipment_id"], ["shipments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("shipment_id", "internal_ref", name="uq_plot_shipment_ref"),
    )
    op.create_index(op.f("ix_plots_organization_id"), "plots", ["organization_id"], unique=False)
    op.create_index(op.f("ix_plots_shipment_id"), "plots", ["shipment_id"], unique=False)
    op.create_table(
        "supplier_invitations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("supplier_id", sa.String(length=36), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("target_email", sa.String(length=250), nullable=False),
        sa.Column("purpose", sa.String(length=20), nullable=False),
        sa.Column("jti_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_supplier_invitations_created_by_user_id"),
        "supplier_invitations",
        ["created_by_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_supplier_invitations_expires_at"),
        "supplier_invitations",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_supplier_invitations_jti_hash"), "supplier_invitations", ["jti_hash"], unique=True
    )
    op.create_index(
        op.f("ix_supplier_invitations_organization_id"),
        "supplier_invitations",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_supplier_invitations_supplier_id"),
        "supplier_invitations",
        ["supplier_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_supplier_invitations_target_email"),
        "supplier_invitations",
        ["target_email"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_supplier_invitations_target_email"), table_name="supplier_invitations")
    op.drop_index(op.f("ix_supplier_invitations_supplier_id"), table_name="supplier_invitations")
    op.drop_index(
        op.f("ix_supplier_invitations_organization_id"), table_name="supplier_invitations"
    )
    op.drop_index(op.f("ix_supplier_invitations_jti_hash"), table_name="supplier_invitations")
    op.drop_index(op.f("ix_supplier_invitations_expires_at"), table_name="supplier_invitations")
    op.drop_index(
        op.f("ix_supplier_invitations_created_by_user_id"), table_name="supplier_invitations"
    )
    op.drop_table("supplier_invitations")
    op.drop_index(op.f("ix_plots_shipment_id"), table_name="plots")
    op.drop_index(op.f("ix_plots_organization_id"), table_name="plots")
    op.drop_table("plots")
    op.drop_index(op.f("ix_audit_events_organization_id"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_occurred_at"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_object_type"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_object_id"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_actor_user_id"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_action"), table_name="audit_events")
    op.drop_table("audit_events")
    op.drop_index(op.f("ix_alerts_user_id"), table_name="alerts")
    op.drop_index(op.f("ix_alerts_organization_id"), table_name="alerts")
    op.drop_table("alerts")
    op.drop_index(op.f("ix_users_supplier_id"), table_name="users")
    op.drop_index(op.f("ix_users_organization_id"), table_name="users")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
    op.drop_index(op.f("ix_shipments_supplier_id"), table_name="shipments")
    op.drop_index(op.f("ix_shipments_reference"), table_name="shipments")
    op.drop_index(op.f("ix_shipments_product_id"), table_name="shipments")
    op.drop_index(op.f("ix_shipments_organization_id"), table_name="shipments")
    op.drop_index(op.f("ix_shipments_country_of_production"), table_name="shipments")
    op.drop_table("shipments")
    op.drop_index(op.f("ix_suppliers_organization_id"), table_name="suppliers")
    op.drop_index(op.f("ix_suppliers_name"), table_name="suppliers")
    op.drop_index(op.f("ix_suppliers_invite_token"), table_name="suppliers")
    op.drop_index(op.f("ix_suppliers_country"), table_name="suppliers")
    op.drop_table("suppliers")
    op.drop_index(op.f("ix_products_organization_id"), table_name="products")
    op.drop_index(op.f("ix_products_commodity"), table_name="products")
    op.drop_table("products")
    op.drop_index(op.f("ix_organizations_eori"), table_name="organizations")
    op.drop_table("organizations")

    # PostgreSQL ENUM types outlive their owning table; remove them explicitly
    # so a full downgrade/upgrade cycle is repeatable.
    op.execute("DROP TYPE productstatus")
    op.execute("DROP TYPE suppliertype")
    op.execute("DROP TYPE supplierstatus")
    op.execute("DROP TYPE supplierriskrating")
    op.execute("DROP TYPE shipmentstatus")
    op.execute("DROP TYPE userrole")
    op.execute("DROP TYPE alertlevel")
    op.execute("DROP TYPE alertcategory")
    op.execute("DROP TYPE plotsource")
    op.execute("DROP TYPE plotstatus")
