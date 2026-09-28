"""Add tenant-scoped EUDR risk cases, evidence, human decisions and preparation snapshots.

Revision ID: 20260927_0003
Revises: 20260926_0002
Create Date: 2026-09-27

Additive only. No production database was targeted or written during this change.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260927_0003"
down_revision = "20260926_0002"
branch_labels = None
depends_on = None

UUID = sa.String(length=36)
JSONB = postgresql.JSONB(astext_type=sa.Text())
NOW = sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "risk_cases",
        sa.Column("id", UUID, nullable=False),
        sa.Column("organization_id", UUID, nullable=False),
        sa.Column("shipment_id", UUID, nullable=False),
        sa.Column("case_reference", sa.String(length=40), nullable=False),
        sa.Column("economic_role", sa.String(length=32), nullable=False),
        sa.Column("company_size", sa.String(length=20), nullable=False),
        sa.Column("role_confirmed", sa.Boolean(), nullable=False),
        sa.Column("role_confirmation_note", sa.Text(), nullable=True),
        sa.Column("assessment_route", sa.String(length=32), nullable=False),
        sa.Column("article13_complexity_assessed", sa.Boolean(), nullable=False),
        sa.Column("article13_mixing_assessed", sa.Boolean(), nullable=False),
        sa.Column("article13_assessment_note", sa.Text(), nullable=True),
        sa.Column("product_scope_status", sa.String(length=32), nullable=False),
        sa.Column("product_scope_note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("decision_state", sa.String(length=20), nullable=False),
        sa.Column("decision_outcome", sa.String(length=32), nullable=True),
        sa.Column("decision_rationale", sa.Text(), nullable=True),
        sa.Column("decision_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("regulatory_reference_version", sa.String(length=120), nullable=False),
        sa.Column("created_by_user_id", UUID, nullable=True),
        sa.Column("updated_by_user_id", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint("economic_role IN ('operator', 'downstream_operator', 'trader', 'producer', 'unknown')", name="ck_risk_case_economic_role"),
        sa.CheckConstraint("company_size IN ('micro', 'small', 'medium', 'large', 'individual', 'unknown')", name="ck_risk_case_company_size"),
        sa.CheckConstraint("assessment_route IN ('full', 'article13_simplified', 'unknown')", name="ck_risk_case_assessment_route"),
        sa.CheckConstraint("product_scope_status IN ('unknown', 'manual_review', 'confirmed_in_scope', 'not_in_scope')", name="ck_risk_case_product_scope_status"),
        sa.CheckConstraint("status IN ('draft', 'in_assessment', 'mitigation_required', 'human_decision_recorded', 'preparation_incomplete', 'prepared_for_declaration', 'blocked')", name="ck_risk_case_status"),
        sa.CheckConstraint("decision_state IN ('none', 'current', 'stale')", name="ck_risk_case_decision_state"),
        sa.CheckConstraint("decision_outcome IS NULL OR decision_outcome IN ('no_or_negligible', 'non_negligible')", name="ck_risk_case_decision_outcome"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shipment_id"], ["shipments.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "case_reference", name="uq_risk_case_org_reference"),
        sa.UniqueConstraint("organization_id", "shipment_id", name="uq_risk_case_org_shipment"),
    )
    op.create_index("ix_risk_cases_organization_id", "risk_cases", ["organization_id"], unique=False)
    op.create_index("ix_risk_cases_shipment_id", "risk_cases", ["shipment_id"], unique=False)
    op.create_index("ix_risk_cases_status", "risk_cases", ["status"], unique=False)
    op.create_index("ix_risk_cases_created_by_user_id", "risk_cases", ["created_by_user_id"], unique=False)
    op.create_index("ix_risk_cases_org_status_created", "risk_cases", ["organization_id", "status", "created_at"], unique=False)
    op.create_index("ix_risk_cases_org_shipment", "risk_cases", ["organization_id", "shipment_id"], unique=False)

    op.create_table(
        "risk_case_origins",
        sa.Column("id", UUID, nullable=False),
        sa.Column("organization_id", UUID, nullable=False),
        sa.Column("case_id", UUID, nullable=False),
        sa.Column("supplier_id", UUID, nullable=True),
        sa.Column("plot_id", UUID, nullable=True),
        sa.Column("source_label", sa.String(length=200), nullable=True),
        sa.Column("country_code", sa.String(length=2), nullable=True),
        sa.Column("subdivision", sa.String(length=200), nullable=True),
        sa.Column("location_description", sa.Text(), nullable=True),
        sa.Column("production_period_start", sa.Date(), nullable=True),
        sa.Column("production_period_end", sa.Date(), nullable=True),
        sa.Column("quantity", sa.Numeric(precision=18, scale=4), nullable=True),
        sa.Column("unit", sa.String(length=20), nullable=True),
        sa.Column("origin_confirmed", sa.Boolean(), nullable=False),
        sa.Column("benchmark_level", sa.String(length=20), nullable=False),
        sa.Column("benchmark_version", sa.String(length=100), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint("benchmark_level IN ('low', 'standard', 'high', 'unknown')", name="ck_risk_case_origin_benchmark_level"),
        sa.CheckConstraint("quantity IS NULL OR quantity > 0", name="ck_risk_case_origin_quantity_positive"),
        sa.CheckConstraint("production_period_end IS NULL OR production_period_start IS NULL OR production_period_end >= production_period_start", name="ck_risk_case_origin_period_order"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["case_id"], ["risk_cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["plot_id"], ["plots.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_risk_case_origins_organization_id", "risk_case_origins", ["organization_id"], unique=False)
    op.create_index("ix_risk_case_origins_case_id", "risk_case_origins", ["case_id"], unique=False)
    op.create_index("ix_risk_case_origins_supplier_id", "risk_case_origins", ["supplier_id"], unique=False)
    op.create_index("ix_risk_case_origins_plot_id", "risk_case_origins", ["plot_id"], unique=False)
    op.create_index("ix_risk_case_origins_country_code", "risk_case_origins", ["country_code"], unique=False)
    op.create_index("ix_risk_case_origins_org_case", "risk_case_origins", ["organization_id", "case_id"], unique=False)

    op.create_table(
        "risk_case_evidence",
        sa.Column("id", UUID, nullable=False),
        sa.Column("organization_id", UUID, nullable=False),
        sa.Column("case_id", UUID, nullable=False),
        sa.Column("origin_id", UUID, nullable=True),
        sa.Column("document_version_id", UUID, nullable=True),
        sa.Column("evidence_type", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("source_url", sa.String(length=1000), nullable=True),
        sa.Column("source_reference", sa.String(length=200), nullable=True),
        sa.Column("review_status", sa.String(length=20), nullable=False),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("reviewed_by_user_id", UUID, nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint("evidence_type IN ('deforestation_free', 'legality', 'origin', 'supply_chain', 'risk_context', 'mitigation', 'other')", name="ck_risk_case_evidence_type"),
        sa.CheckConstraint("review_status IN ('to_review', 'reviewed', 'follow_up')", name="ck_risk_case_evidence_review_status"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["case_id"], ["risk_cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["origin_id"], ["risk_case_origins.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["document_version_id"], ["document_versions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_risk_case_evidence_organization_id", "risk_case_evidence", ["organization_id"], unique=False)
    op.create_index("ix_risk_case_evidence_case_id", "risk_case_evidence", ["case_id"], unique=False)
    op.create_index("ix_risk_case_evidence_origin_id", "risk_case_evidence", ["origin_id"], unique=False)
    op.create_index("ix_risk_case_evidence_document_version_id", "risk_case_evidence", ["document_version_id"], unique=False)
    op.create_index("ix_risk_case_evidence_org_case", "risk_case_evidence", ["organization_id", "case_id"], unique=False)

    op.create_table(
        "risk_findings",
        sa.Column("id", UUID, nullable=False),
        sa.Column("organization_id", UUID, nullable=False),
        sa.Column("case_id", UUID, nullable=False),
        sa.Column("criterion", sa.String(length=60), nullable=False),
        sa.Column("assessment_status", sa.String(length=32), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("source_note", sa.Text(), nullable=True),
        sa.Column("assessed_by_user_id", UUID, nullable=True),
        sa.Column("assessed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint("assessment_status IN ('not_assessed', 'not_relevant', 'no_concern_identified', 'concern_identified', 'inconclusive')", name="ck_risk_finding_assessment_status"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["case_id"], ["risk_cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assessed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("case_id", "criterion", name="uq_risk_finding_case_criterion"),
    )
    op.create_index("ix_risk_findings_organization_id", "risk_findings", ["organization_id"], unique=False)
    op.create_index("ix_risk_findings_case_id", "risk_findings", ["case_id"], unique=False)
    op.create_index("ix_risk_findings_org_case", "risk_findings", ["organization_id", "case_id"], unique=False)

    op.create_table(
        "risk_finding_evidence",
        sa.Column("id", UUID, nullable=False),
        sa.Column("organization_id", UUID, nullable=False),
        sa.Column("case_id", UUID, nullable=False),
        sa.Column("finding_id", UUID, nullable=False),
        sa.Column("evidence_id", UUID, nullable=False),
        sa.Column("created_by_user_id", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["case_id"], ["risk_cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["finding_id"], ["risk_findings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["evidence_id"], ["risk_case_evidence.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("finding_id", "evidence_id", name="uq_risk_finding_evidence_pair"),
    )
    op.create_index("ix_risk_finding_evidence_organization_id", "risk_finding_evidence", ["organization_id"], unique=False)
    op.create_index("ix_risk_finding_evidence_case_id", "risk_finding_evidence", ["case_id"], unique=False)
    op.create_index("ix_risk_finding_evidence_finding_id", "risk_finding_evidence", ["finding_id"], unique=False)
    op.create_index("ix_risk_finding_evidence_evidence_id", "risk_finding_evidence", ["evidence_id"], unique=False)
    op.create_index("ix_risk_finding_evidence_org_case", "risk_finding_evidence", ["organization_id", "case_id"], unique=False)

    op.create_table(
        "risk_mitigation_actions",
        sa.Column("id", UUID, nullable=False),
        sa.Column("organization_id", UUID, nullable=False),
        sa.Column("case_id", UUID, nullable=False),
        sa.Column("evidence_id", UUID, nullable=True),
        sa.Column("finding_id", UUID, nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("responsible_name", sa.String(length=200), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("effectiveness_assessed", sa.Boolean(), nullable=False),
        sa.Column("effectiveness_note", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", UUID, nullable=True),
        sa.Column("updated_by_user_id", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint("status IN ('planned', 'in_progress', 'completed', 'ineffective', 'cancelled')", name="ck_risk_mitigation_status"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["case_id"], ["risk_cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["evidence_id"], ["risk_case_evidence.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["finding_id"], ["risk_findings.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_risk_mitigation_actions_organization_id", "risk_mitigation_actions", ["organization_id"], unique=False)
    op.create_index("ix_risk_mitigation_actions_case_id", "risk_mitigation_actions", ["case_id"], unique=False)
    op.create_index("ix_risk_mitigation_actions_evidence_id", "risk_mitigation_actions", ["evidence_id"], unique=False)
    op.create_index("ix_risk_mitigation_actions_finding_id", "risk_mitigation_actions", ["finding_id"], unique=False)
    op.create_index("ix_risk_mitigation_org_case",  "risk_mitigation_actions", ["organization_id", "case_id"], unique=False)

    op.create_table(
        "risk_decisions",
        sa.Column("id", UUID, nullable=False),
        sa.Column("organization_id", UUID, nullable=False),
        sa.Column("case_id", UUID, nullable=False),
        sa.Column("decision_number", sa.Integer(), nullable=False),
        sa.Column("outcome", sa.String(length=32), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("conditions_or_follow_up", sa.Text(), nullable=True),
        sa.Column("reference_version", sa.String(length=120), nullable=False),
        sa.Column("assessment_snapshot", JSONB, nullable=False),
        sa.Column("actor_user_id", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint("outcome IN ('no_or_negligible', 'non_negligible')", name="ck_risk_decision_outcome"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["case_id"], ["risk_cases.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("case_id", "decision_number", name="uq_risk_decision_number"),
    )
    op.create_index("ix_risk_decisions_organization_id", "risk_decisions", ["organization_id"], unique=False)
    op.create_index("ix_risk_decisions_case_id", "risk_decisions", ["case_id"], unique=False)
    op.create_index("ix_risk_decisions_actor_user_id", "risk_decisions", ["actor_user_id"], unique=False)
    op.create_index("ix_risk_decisions_org_case", "risk_decisions", ["organization_id", "case_id"], unique=False)

    op.create_table(
        "declaration_preparations",
        sa.Column("id", UUID, nullable=False),
        sa.Column("organization_id", UUID, nullable=False),
        sa.Column("case_id", UUID, nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("internal_format_version", sa.String(length=80), nullable=False),
        sa.Column("snapshot", JSONB, nullable=False),
        sa.Column("missing_fields", JSONB, nullable=False),
        sa.Column("stale_reason", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint("status IN ('incomplete', 'prepared_for_declaration', 'stale')", name="ck_declaration_preparation_status"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["case_id"], ["risk_cases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_declaration_preparations_organization_id", "declaration_preparations", ["organization_id"], unique=False)
    op.create_index("ix_declaration_preparations_case_id", "declaration_preparations", ["case_id"], unique=False)
    op.create_index("ix_declaration_preparations_org_case", "declaration_preparations", ["organization_id", "case_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_declaration_preparations_org_case", table_name="declaration_preparations")
    op.drop_index("ix_declaration_preparations_case_id", table_name="declaration_preparations")
    op.drop_index("ix_declaration_preparations_organization_id", table_name="declaration_preparations")
    op.drop_table("declaration_preparations")
    op.drop_index("ix_risk_decisions_org_case", table_name="risk_decisions")
    op.drop_index("ix_risk_decisions_actor_user_id", table_name="risk_decisions")
    op.drop_index("ix_risk_decisions_case_id", table_name="risk_decisions")
    op.drop_index("ix_risk_decisions_organization_id", table_name="risk_decisions")
    op.drop_table("risk_decisions")
    op.drop_index("ix_risk_mitigation_org_case", table_name="risk_mitigation_actions")
    op.drop_index("ix_risk_mitigation_actions_finding_id", table_name="risk_mitigation_actions")
    op.drop_index("ix_risk_mitigation_actions_evidence_id", table_name="risk_mitigation_actions")
    op.drop_index("ix_risk_mitigation_actions_case_id",  table_name="risk_mitigation_actions")
    op.drop_index("ix_risk_mitigation_actions_organization_id", table_name="risk_mitigation_actions")
    op.drop_table("risk_mitigation_actions")
    op.drop_index("ix_risk_finding_evidence_org_case", table_name="risk_finding_evidence")
    op.drop_index("ix_risk_finding_evidence_evidence_id", table_name="risk_finding_evidence")
    op.drop_index("ix_risk_finding_evidence_finding_id", table_name="risk_finding_evidence")
    op.drop_index("ix_risk_finding_evidence_case_id", table_name="risk_finding_evidence")
    op.drop_index("ix_risk_finding_evidence_organization_id", table_name="risk_finding_evidence")
    op.drop_table("risk_finding_evidence")
    op.drop_index("ix_risk_findings_org_case", table_name="risk_findings")
    op.drop_index("ix_risk_findings_case_id", table_name="risk_findings")
    op.drop_index("ix_risk_findings_organization_id", table_name="risk_findings")
    op.drop_table("risk_findings")
    op.drop_index("ix_risk_case_evidence_org_case", table_name="risk_case_evidence")
    op.drop_index("ix_risk_case_evidence_document_version_id", table_name="risk_case_evidence")
    op.drop_index("ix_risk_case_evidence_origin_id", table_name="risk_case_evidence")
    op.drop_index("ix_risk_case_evidence_case_id", table_name="risk_case_evidence")
    op.drop_index("ix_risk_case_evidence_organization_id", table_name="risk_case_evidence")
    op.drop_table("risk_case_evidence")
    op.drop_index("ix_risk_case_origins_org_case", table_name="risk_case_origins")
    op.drop_index("ix_risk_case_origins_country_code", table_name="risk_case_origins")
    op.drop_index("ix_risk_case_origins_plot_id", table_name="risk_case_origins")
    op.drop_index("ix_risk_case_origins_supplier_id", table_name="risk_case_origins")
    op.drop_index("ix_risk_case_origins_case_id", table_name="risk_case_origins")
    op.drop_index("ix_risk_case_origins_organization_id", table_name="risk_case_origins")
    op.drop_table("risk_case_origins")
    op.drop_index("ix_risk_cases_org_shipment", table_name="risk_cases")
    op.drop_index("ix_risk_cases_org_status_created", table_name="risk_cases")
    op.drop_index("ix_risk_cases_created_by_user_id", table_name="risk_cases")
    op.drop_index("ix_risk_cases_status", table_name="risk_cases")
    op.drop_index("ix_risk_cases_shipment_id", table_name="risk_cases")
    op.drop_index("ix_risk_cases_organization_id", table_name="risk_cases")
    op.drop_table("risk_cases")
