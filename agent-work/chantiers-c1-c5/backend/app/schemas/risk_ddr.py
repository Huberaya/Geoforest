"""Pydantic schemas for the tenant-scoped risk and DDR workflow."""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

EconomicRole = Literal["operator", "downstream_operator", "trader", "producer", "unknown"]
CompanySize = Literal["micro", "small", "medium", "large", "individual", "unknown"]
AssessmentRoute = Literal["full", "article13_simplified", "unknown"]
ProductScopeStatus = Literal["unknown", "manual_review", "confirmed_in_scope", "not_in_scope"]
OriginRiskLevel = Literal["low", "standard", "high", "unknown"]
EvidenceType = Literal["deforestation_free", "legality", "origin", "supply_chain", "risk_context", "mitigation", "other"]
FindingStatus = Literal["not_assessed", "not_relevant", "no_concern_identified", "concern_identified", "inconclusive"]
MitigationStatus = Literal["planned", "in_progress", "completed", "ineffective", "cancelled"]
DecisionOutcome = Literal["no_or_negligible", "non_negligible"]


class RiskCaseCreate(BaseModel):
    shipment_id: uuid.UUID
    economic_role: EconomicRole = "unknown"
    company_size: CompanySize = "unknown"
    role_confirmed: bool = False
    role_confirmation_note: str | None = Field(default=None, max_length=5000)
    assessment_route: AssessmentRoute = "full"
    article13_complexity_assessed: bool = False
    article13_mixing_assessed: bool = False
    article13_assessment_note: str | None = Field(default=None, max_length=5000)
    product_scope_status: ProductScopeStatus = "unknown"
    product_scope_note: str | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def validate_confirmations(self):
        if self.role_confirmed and (self.economic_role == "unknown" or len((self.role_confirmation_note or "").strip()) < 12):
            raise ValueError("La confirmation du rôle exige un rôle renseigné et une justification (12 caractères minimum).")
        if self.company_size != "unknown" and len((self.role_confirmation_note or "").strip()) < 12:
            raise ValueError("La qualification de taille exige une justification documentée (12 caractères minimum).")
        if self.product_scope_status == "confirmed_in_scope" and len((self.product_scope_note or "").strip()) < 12:
            raise ValueError("La confirmation humaine du champ produit exige une justification (12 caractères minimum).")
        if self.assessment_route == "article13_simplified":
            if not (self.article13_complexity_assessed and self.article13_mixing_assessed):
                raise ValueError("La route de l'article 13 exige l'appréciation de la complexité et des risques de mélange/contournement.")
            if len((self.article13_assessment_note or "").strip()) < 20:
                raise ValueError("Documentez l'appréciation de la route simplifiée (20 caractères minimum).")
        return self


class RiskCasePatch(BaseModel):
    economic_role: EconomicRole | None = None
    company_size: CompanySize | None = None
    role_confirmed: bool | None = None
    role_confirmation_note: str | None = Field(default=None, max_length=5000)
    assessment_route: AssessmentRoute | None = None
    article13_complexity_assessed: bool | None = None
    article13_mixing_assessed: bool | None = None
    article13_assessment_note: str | None = Field(default=None, max_length=5000)
    product_scope_status: ProductScopeStatus | None = None
    product_scope_note: str | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def validate_confirmations(self):
        if self.role_confirmed is True and self.economic_role == "unknown":
            raise ValueError("Le rôle économique ne peut pas être confirmé comme « inconnu ».")
        if self.role_confirmed is True and len((self.role_confirmation_note or "").strip()) < 12:
            raise ValueError("La confirmation du rôle exige une justification (12 caractères minimum).")
        if self.company_size is not None and self.company_size != "unknown" and len((self.role_confirmation_note or "").strip()) < 12:
            raise ValueError("La qualification de taille exige une justification documentée (12 caractères minimum).")
        if self.product_scope_status == "confirmed_in_scope" and len((self.product_scope_note or "").strip()) < 12:
            raise ValueError("La confirmation humaine du champ produit exige une justification (12 caractères minimum).")
        if self.assessment_route == "article13_simplified":
            if self.article13_complexity_assessed is not True or self.article13_mixing_assessed is not True:
                raise ValueError("La route de l'article 13 exige l'appréciation de la complexité et des risques de mélange/contournement.")
            if len((self.article13_assessment_note or "").strip()) < 20:
                raise ValueError("Documentez l'appréciation de la route simplifiée (20 caractères minimum).")
        return self


class RiskCaseOriginCreate(BaseModel):
    supplier_id: uuid.UUID | None = None
    plot_id: uuid.UUID | None = None
    source_label: str | None = Field(default=None, max_length=200)
    country_code: str | None = Field(default=None, pattern=r"^[A-Za-z]{2}$")
    subdivision: str | None = Field(default=None, max_length=200)
    location_description: str | None = Field(default=None, max_length=3000)
    production_period_start: date | None = None
    production_period_end: date | None = None
    quantity: float | None = Field(default=None, gt=0, le=1_000_000_000)
    unit: str | None = Field(default=None, max_length=20)
    origin_confirmed: bool = False
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("country_code")
    @classmethod
    def upper_country(cls, value: str | None) -> str | None:
        return value.upper() if value else None

    @model_validator(mode="after")
    def validate_period(self):
        if self.production_period_start and self.production_period_end and self.production_period_end < self.production_period_start:
            raise ValueError("La fin de période de production doit être postérieure au début.")
        if self.origin_confirmed:
            if not self.country_code or not (self.plot_id or (self.location_description or "").strip()):
                raise ValueError("Une origine confirmée doit préciser le pays et une parcelle ou une description de localisation.")
            if len((self.notes or "").strip()) < 10:
                raise ValueError("Ajoutez une justification de la confirmation d'origine (10 caractères minimum).")
        return self


class RiskCaseOriginPatch(BaseModel):
    supplier_id: uuid.UUID | None = None
    plot_id: uuid.UUID | None = None
    source_label: str | None = Field(default=None, max_length=200)
    country_code: str | None = Field(default=None, pattern=r"^[A-Za-z]{2}$")
    subdivision: str | None = Field(default=None, max_length=200)
    location_description: str | None = Field(default=None, max_length=3000)
    production_period_start: date | None = None
    production_period_end: date | None = None
    quantity: float | None = Field(default=None, gt=0, le=1_000_000_000)
    unit: str | None = Field(default=None, max_length=20)
    origin_confirmed: bool | None = None
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("country_code")
    @classmethod
    def upper_country(cls, value: str | None) -> str | None:
        return value.upper() if value else None

    @model_validator(mode="after")
    def validate_period(self):
        if self.production_period_start and self.production_period_end and self.production_period_end < self.production_period_start:
            raise ValueError("La fin de période de production doit être postérieure au début.")
        if self.origin_confirmed is True and self.notes is not None and len(self.notes.strip()) < 10:
            raise ValueError("Ajoutez une justification de la confirmation d'origine (10 caractères minimum).")
        return self


class RiskEvidenceCreate(BaseModel):
    evidence_type: EvidenceType
    title: str = Field(min_length=3, max_length=200)
    summary: str = Field(min_length=10, max_length=10000)
    origin_id: uuid.UUID | None = None
    document_version_id: uuid.UUID | None = None
    source_url: str | None = Field(default=None, max_length=1000)
    source_reference: str | None = Field(default=None, max_length=200)

    @field_validator("source_url")
    @classmethod
    def validate_source_url(cls, value: str | None) -> str | None:
        if value:
            from urllib.parse import urlsplit
            parsed = urlsplit(value)
            if parsed.scheme != "https" or not parsed.netloc:
                raise ValueError("La source externe doit être une URL HTTPS.")
        return value


class RiskEvidencePatch(BaseModel):
    review_status: Literal["to_review", "reviewed", "follow_up"] | None = None
    review_note: str | None = Field(default=None, max_length=5000)


class RiskFindingPatch(BaseModel):
    assessment_status: FindingStatus
    rationale: str | None = Field(default=None, max_length=10000)
    source_note: str | None = Field(default=None, max_length=5000)
    evidence_ids: list[uuid.UUID] | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def rationale_required(self):
        if self.assessment_status != "not_assessed" and len((self.rationale or "").strip()) < 12:
            raise ValueError("Chaque constat doit comporter une justification (12 caractères minimum).")
        return self


class RiskEvidenceOut(BaseModel):
    id: uuid.UUID
    evidence_type: EvidenceType
    title: str
    summary: str
    origin_id: uuid.UUID | None
    document_version_id: uuid.UUID | None
    document_id: uuid.UUID | None = None
    document_version_number: int | None = None
    document_sha256: str | None = None
    source_url: str | None
    source_reference: str | None
    review_status: Literal["to_review", "reviewed", "follow_up"]
    review_note: str | None
    reviewed_by_user_id: uuid.UUID | None
    reviewed_at: datetime | None
    created_at: datetime


class RiskCaseOriginOut(BaseModel):
    id: uuid.UUID
    supplier_id: uuid.UUID | None
    plot_id: uuid.UUID | None
    plot_reference: str | None = None
    source_label: str | None
    country_code: str | None
    subdivision: str | None
    location_description: str | None
    production_period_start: date | None
    production_period_end: date | None
    quantity: float | None
    unit: str | None
    origin_confirmed: bool
    benchmark_level: OriginRiskLevel
    benchmark_version: str
    benchmark_reason: str
    notes: str | None


class RiskFindingOut(BaseModel):
    id: uuid.UUID
    criterion: str
    label: str
    assessment_status: FindingStatus
    rationale: str | None
    source_note: str | None
    evidence_ids: list[uuid.UUID]
    assessed_by_user_id: uuid.UUID | None
    assessed_at: datetime | None


class RiskMitigationCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10, max_length=10000)
    responsible_name: str | None = Field(default=None, max_length=200)
    due_date: date | None = None
    evidence_id: uuid.UUID | None = None
    finding_id: uuid.UUID | None = None


class RiskMitigationPatch(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    description: str | None = Field(default=None, min_length=10, max_length=10000)
    responsible_name: str | None = Field(default=None, max_length=200)
    due_date: date | None = None
    status: MitigationStatus | None = None
    effectiveness_assessed: bool | None = None
    effectiveness_note: str | None = Field(default=None, max_length=10000)
    evidence_id: uuid.UUID | None = None
    finding_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def effectiveness_has_note(self):
        if self.effectiveness_assessed is True and len((self.effectiveness_note or "").strip()) < 12:
            raise ValueError("Documentez l'évaluation de l'efficacité (12 caractères minimum).")
        return self


class RiskMitigationOut(BaseModel):
    id: uuid.UUID
    title: str
    description: str
    responsible_name: str | None
    due_date: date | None
    status: MitigationStatus
    effectiveness_assessed: bool
    effectiveness_note: str | None
    evidence_id: uuid.UUID | None
    finding_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class RiskDecisionCreate(BaseModel):
    outcome: DecisionOutcome
    rationale: str = Field(min_length=25, max_length=10000)
    conditions_or_follow_up: str | None = Field(default=None, max_length=10000)


class RiskDecisionOut(BaseModel):
    id: uuid.UUID
    decision_number: int
    outcome: DecisionOutcome
    rationale: str
    conditions_or_follow_up: str | None
    reference_version: str
    actor_user_id: uuid.UUID | None
    created_at: datetime


class DeclarationPreparationOut(BaseModel):
    id: uuid.UUID
    sequence_number: int
    status: Literal["incomplete", "prepared_for_declaration", "stale"]
    internal_format_version: str
    snapshot: dict[str, Any]
    missing_fields: list[str]
    stale_reason: str | None
    created_by_user_id: uuid.UUID | None
    created_at: datetime


class RiskCaseOut(BaseModel):
    id: uuid.UUID
    case_reference: str
    shipment_id: uuid.UUID
    shipment_reference: str
    product_id: uuid.UUID
    product_name: str
    commodity: str
    hs_code: str | None
    supplier_id: uuid.UUID
    supplier_name: str
    quantity: float | None
    unit: str | None
    country_of_production: str | None
    economic_role: EconomicRole
    company_size: CompanySize
    role_confirmed: bool
    role_confirmation_note: str | None
    assessment_route: AssessmentRoute
    article13_complexity_assessed: bool
    article13_mixing_assessed: bool
    article13_assessment_note: str | None
    product_scope_status: ProductScopeStatus
    product_scope_note: str | None
    status: str
    decision_state: Literal["none", "current", "stale"]
    decision_outcome: DecisionOutcome | None
    decision_rationale: str | None
    decision_at: datetime | None
    regulatory_reference_version: str
    origins: list[RiskCaseOriginOut]
    evidence_items: list[RiskEvidenceOut]
    findings: list[RiskFindingOut]
    mitigation_actions: list[RiskMitigationOut]
    decisions: list[RiskDecisionOut]
    declaration_preparations: list[DeclarationPreparationOut]
    created_at: datetime
    updated_at: datetime


class RiskCaseListOut(BaseModel):
    items: list[RiskCaseOut]
    total: int
    by_status: dict[str, int]


class RiskDecisionSnapshotOut(BaseModel):
    case_id: uuid.UUID
    decision: RiskDecisionOut
    case_status: str


class DeclarationPreparationCreate(BaseModel):
    confirm_internal_prefill_only: bool = Field(
        description="Confirmation explicite que cette action crée une préparation interne et ne soumet rien à l'EUDR Information System."
    )

    @field_validator("confirm_internal_prefill_only")
    @classmethod
    def must_confirm(cls, value: bool) -> bool:
        if not value:
            raise ValueError("La préparation est interne et ne soumet pas de déclaration officielle.")
        return value
