"""Tenant-scoped EUDR risk cases, evidence, human decisions and DDR preparations."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    event,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, JSONType, UUIDType


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RiskCase(Base):
    """A human-reviewed due-diligence case attached to a tenant shipment."""

    __tablename__ = "risk_cases"
    __table_args__ = (
        UniqueConstraint("organization_id", "case_reference", name="uq_risk_case_org_reference"),
        UniqueConstraint("organization_id", "shipment_id", name="uq_risk_case_org_shipment"),
        CheckConstraint(
            "economic_role IN ('operator', 'downstream_operator', 'trader', 'producer', 'unknown')",
            name="ck_risk_case_economic_role",
        ),
        CheckConstraint(
            "company_size IN ('micro', 'small', 'medium', 'large', 'individual', 'unknown')",
            name="ck_risk_case_company_size",
        ),
        CheckConstraint(
            "assessment_route IN ('full', 'article13_simplified', 'unknown')",
            name="ck_risk_case_assessment_route",
        ),
        CheckConstraint(
            "product_scope_status IN ('unknown', 'manual_review', 'confirmed_in_scope', 'not_in_scope')",
            name="ck_risk_case_product_scope_status",
        ),
        CheckConstraint(
            "status IN ('draft', 'in_assessment', 'mitigation_required', 'human_decision_recorded', "
            "'preparation_incomplete', 'prepared_for_declaration', 'blocked')",
            name="ck_risk_case_status",
        ),
        CheckConstraint(
            "decision_state IN ('none', 'current', 'stale')",
            name="ck_risk_case_decision_state",
        ),
        CheckConstraint(
            "decision_outcome IS NULL OR decision_outcome IN ('no_or_negligible', 'non_negligible')",
            name="ck_risk_case_decision_outcome",
        ),
        Index("ix_risk_cases_org_status_created", "organization_id", "status", "created_at"),
        Index("ix_risk_cases_org_shipment", "organization_id", "shipment_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shipment_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("shipments.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    case_reference: Mapped[str] = mapped_column(String(40), nullable=False)
    economic_role: Mapped[str] = mapped_column(String(32), default="unknown", nullable=False)
    company_size: Mapped[str] = mapped_column(String(20), default="unknown", nullable=False)
    role_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    role_confirmation_note: Mapped[str | None] = mapped_column(Text)
    assessment_route: Mapped[str] = mapped_column(String(32), default="full", nullable=False)
    article13_complexity_assessed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    article13_mixing_assessed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    article13_assessment_note: Mapped[str | None] = mapped_column(Text)
    product_scope_status: Mapped[str] = mapped_column(String(32), default="unknown", nullable=False)
    product_scope_note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default="draft", nullable=False, index=True)
    decision_state: Mapped[str] = mapped_column(String(20), default="none", nullable=False)
    decision_outcome: Mapped[str | None] = mapped_column(String(32))
    decision_rationale: Mapped[str | None] = mapped_column(Text)
    decision_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    regulatory_reference_version: Mapped[str] = mapped_column(String(120), nullable=False)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow, nullable=False
    )

    origins: Mapped[list["RiskCaseOrigin"]] = relationship(
        "RiskCaseOrigin", back_populates="risk_case", cascade="all, delete-orphan", order_by="RiskCaseOrigin.created_at"
    )
    evidence_items: Mapped[list["RiskEvidence"]] = relationship(
        "RiskEvidence", back_populates="risk_case", cascade="all, delete-orphan", order_by="RiskEvidence.created_at"
    )
    findings: Mapped[list["RiskFinding"]] = relationship(
        "RiskFinding", back_populates="risk_case", cascade="all, delete-orphan", order_by="RiskFinding.criterion"
    )
    mitigation_actions: Mapped[list["RiskMitigationAction"]] = relationship(
        "RiskMitigationAction", back_populates="risk_case", cascade="all, delete-orphan", order_by="RiskMitigationAction.created_at"
    )
    decisions: Mapped[list["RiskDecision"]] = relationship(
        "RiskDecision", back_populates="risk_case", order_by="RiskDecision.decision_number"
    )
    declaration_preparations: Mapped[list["DeclarationPreparation"]] = relationship(
        "DeclarationPreparation", back_populates="risk_case", order_by="DeclarationPreparation.created_at"
    )


class RiskCaseOrigin(Base):
    """One production source/plot allocation; deliberately excludes raw geometry."""

    __tablename__ = "risk_case_origins"
    __table_args__ = (
        CheckConstraint(
            "benchmark_level IN ('low', 'standard', 'high', 'unknown')",
            name="ck_risk_case_origin_benchmark_level",
        ),
        CheckConstraint("quantity IS NULL OR quantity > 0", name="ck_risk_case_origin_quantity_positive"),
        CheckConstraint(
            "production_period_end IS NULL OR production_period_start IS NULL OR "
            "production_period_end >= production_period_start",
            name="ck_risk_case_origin_period_order",
        ),
        Index("ix_risk_case_origins_org_case", "organization_id", "case_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("risk_cases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    plot_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("plots.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    source_label: Mapped[str | None] = mapped_column(String(200))
    country_code: Mapped[str | None] = mapped_column(String(2), index=True)
    subdivision: Mapped[str | None] = mapped_column(String(200))
    location_description: Mapped[str | None] = mapped_column(Text)
    production_period_start: Mapped[date | None] = mapped_column(Date)
    production_period_end: Mapped[date | None] = mapped_column(Date)
    quantity: Mapped[float | None] = mapped_column(Numeric(18, 4))
    unit: Mapped[str | None] = mapped_column(String(20))
    origin_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    benchmark_level: Mapped[str] = mapped_column(String(20), default="unknown", nullable=False)
    benchmark_version: Mapped[str] = mapped_column(String(100), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow, nullable=False
    )

    risk_case: Mapped[RiskCase] = relationship("RiskCase", back_populates="origins")


class RiskEvidence(Base):
    """A source note or tenant document reference supporting an assessment."""

    __tablename__ = "risk_case_evidence"
    __table_args__ = (
        CheckConstraint(
            "evidence_type IN ('deforestation_free', 'legality', 'origin', 'supply_chain', "
            "'risk_context', 'mitigation', 'other')",
            name="ck_risk_case_evidence_type",
        ),
        CheckConstraint(
            "review_status IN ('to_review', 'reviewed', 'follow_up')",
            name="ck_risk_case_evidence_review_status",
        ),
        Index("ix_risk_case_evidence_org_case", "organization_id", "case_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("risk_cases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    origin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("risk_case_origins.id", ondelete="SET NULL"), nullable=True, index=True
    )
    document_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("document_versions.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    evidence_type: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(1000))
    source_reference: Mapped[str | None] = mapped_column(String(200))
    review_status: Mapped[str] = mapped_column(String(20), default="to_review", nullable=False)
    review_note: Mapped[str | None] = mapped_column(Text)
    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow, nullable=False
    )

    risk_case: Mapped[RiskCase] = relationship("RiskCase", back_populates="evidence_items")


class RiskFinding(Base):
    """Structured factor-by-factor record; statuses never compute a global risk score."""

    __tablename__ = "risk_findings"
    __table_args__ = (
        UniqueConstraint("case_id", "criterion", name="uq_risk_finding_case_criterion"),
        CheckConstraint(
            "assessment_status IN ('not_assessed', 'not_relevant', 'no_concern_identified', "
            "'concern_identified', 'inconclusive')",
            name="ck_risk_finding_assessment_status",
        ),
        Index("ix_risk_findings_org_case", "organization_id", "case_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("risk_cases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    criterion: Mapped[str] = mapped_column(String(60), nullable=False)
    assessment_status: Mapped[str] = mapped_column(String(32), default="not_assessed", nullable=False)
    rationale: Mapped[str | None] = mapped_column(Text)
    source_note: Mapped[str | None] = mapped_column(Text)
    assessed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow, nullable=False
    )

    risk_case: Mapped[RiskCase] = relationship("RiskCase", back_populates="findings")
    evidence_links: Mapped[list["RiskFindingEvidence"]] = relationship(
        "RiskFindingEvidence", back_populates="finding", cascade="all, delete-orphan"
    )


class RiskFindingEvidence(Base):
    """Tenant-scoped association between a factor and one evidence item."""

    __tablename__ = "risk_finding_evidence"
    __table_args__ = (
        UniqueConstraint("finding_id", "evidence_id", name="uq_risk_finding_evidence_pair"),
        Index("ix_risk_finding_evidence_org_case", "organization_id", "case_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("risk_cases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    finding_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("risk_findings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    evidence_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("risk_case_evidence.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )

    finding: Mapped[RiskFinding] = relationship("RiskFinding", back_populates="evidence_links")


class RiskMitigationAction(Base):
    """An action plan and recorded human assessment of effectiveness."""

    __tablename__ = "risk_mitigation_actions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('planned', 'in_progress', 'completed', 'ineffective', 'cancelled')",
            name="ck_risk_mitigation_status",
        ),
        Index("ix_risk_mitigation_org_case", "organization_id", "case_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("risk_cases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    evidence_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("risk_case_evidence.id", ondelete="SET NULL"), nullable=True, index=True
    )
    finding_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("risk_findings.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    responsible_name: Mapped[str | None] = mapped_column(String(200))
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)
    effectiveness_assessed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    effectiveness_note: Mapped[str | None] = mapped_column(Text)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow, nullable=False
    )

    risk_case: Mapped[RiskCase] = relationship("RiskCase", back_populates="mitigation_actions")


class RiskDecision(Base):
    """Append-only decision by an authorized human, including its evidence snapshot."""

    __tablename__ = "risk_decisions"
    __table_args__ = (
        UniqueConstraint("case_id", "decision_number", name="uq_risk_decision_number"),
        CheckConstraint(
            "outcome IN ('no_or_negligible', 'non_negligible')",
            name="ck_risk_decision_outcome",
        ),
        Index("ix_risk_decisions_org_case", "organization_id", "case_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("risk_cases.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    decision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    outcome: Mapped[str] = mapped_column(String(32), nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    conditions_or_follow_up: Mapped[str | None] = mapped_column(Text)
    reference_version: Mapped[str] = mapped_column(String(120), nullable=False)
    assessment_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )

    risk_case: Mapped[RiskCase] = relationship("RiskCase", back_populates="decisions")


class DeclarationPreparation(Base):
    """Immutable content snapshot; status can become stale, but never submitted/declared."""

    __tablename__ = "declaration_preparations"
    __table_args__ = (
        CheckConstraint(
            "status IN ('incomplete', 'prepared_for_declaration', 'stale')",
            name="ck_declaration_preparation_status",
        ),
        Index("ix_declaration_preparations_org_case", "organization_id", "case_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("risk_cases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="incomplete", nullable=False)
    internal_format_version: Mapped[str] = mapped_column(String(80), nullable=False)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False)
    missing_fields: Mapped[list[str]] = mapped_column(JSONType, nullable=False)
    stale_reason: Mapped[str | None] = mapped_column(Text)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow, nullable=False
    )

    risk_case: Mapped[RiskCase] = relationship("RiskCase", back_populates="declaration_preparations")


@event.listens_for(RiskDecision, "before_update")
def _risk_decisions_are_immutable(mapper, connection, target) -> None:
    raise ValueError("RiskDecision est immuable : créer une nouvelle décision versionnée.")


@event.listens_for(RiskDecision, "before_delete")
def _risk_decisions_are_not_deleted(mapper, connection, target) -> None:
    raise ValueError("RiskDecision est immuable : les décisions ne peuvent pas être supprimées via l'ORM.")
