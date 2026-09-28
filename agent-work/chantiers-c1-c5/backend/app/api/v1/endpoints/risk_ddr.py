"""Tenant-scoped EUDR risk cases, Art. 10/11 workflow and internal DDR preparation.

No endpoint submits a declaration to the EUDR Information System or claims that a
product is legally compliant. Final outcomes are explicit human decisions.
"""
from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import ensure_operator_user, get_current_active_user
from app.models import Organization, User, UserRole
from app.models.documents import Document, DocumentVersion
from app.models.plots import Plot
from app.models.products import Product, Shipment
from app.models.risk_ddr import (
    DeclarationPreparation,
    RiskCase,
    RiskCaseOrigin,
    RiskDecision,
    RiskEvidence,
    RiskFinding,
    RiskFindingEvidence,
    RiskMitigationAction,
)
from app.models.suppliers import Supplier
from app.schemas.risk_ddr import (
    DeclarationPreparationCreate,
    DeclarationPreparationOut,
    RiskCaseCreate,
    RiskCaseListOut,
    RiskCaseOriginCreate,
    RiskCaseOriginOut,
    RiskCaseOriginPatch,
    RiskCaseOut,
    RiskCasePatch,
    RiskDecisionCreate,
    RiskDecisionOut,
    RiskEvidenceCreate,
    RiskEvidenceOut,
    RiskEvidencePatch,
    RiskFindingOut,
    RiskFindingPatch,
    RiskMitigationCreate,
    RiskMitigationOut,
    RiskMitigationPatch,
)
from app.services.audit.service import model_snapshot, record_audit_event
from app.services.eudr_references import (
    COUNTRY_BENCHMARK_VERSION,
    PRODUCT_SCOPE_CATALOG,
    PRODUCT_SCOPE_NOTE,
    PRODUCT_SCOPE_VERSION,
    RISK_CRITERIA,
    classify_country,
    product_scope_candidates,
    reference_manifest,
)

router = APIRouter()
_READ_ROLES = {UserRole.admin, UserRole.compliance, UserRole.procurement, UserRole.analyst, UserRole.viewer}
_DATA_WRITE_ROLES = {UserRole.admin, UserRole.compliance, UserRole.procurement}
_ASSESS_ROLES = {UserRole.admin, UserRole.compliance, UserRole.procurement, UserRole.analyst}
_DECISION_ROLES = {UserRole.admin, UserRole.compliance}
_REFERENCE_VERSION = f"{PRODUCT_SCOPE_VERSION}|{COUNTRY_BENCHMARK_VERSION}"
_CRITERION_LABELS = {entry["code"]: entry["label"] for entry in RISK_CRITERIA}


def _organization_id(user: User, roles: set[UserRole] | None = None) -> uuid.UUID:
    ensure_operator_user(user)
    allowed = roles or _READ_ROLES
    if user.organization_id is None or user.role not in allowed:
        raise HTTPException(status_code=403, detail="Accès refusé.")
    return user.organization_id


def _json_safe(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _hash_text(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _origin_audit_snapshot(origin: RiskCaseOrigin) -> dict[str, Any]:
    """Auditable origin data without duplicating free-text coordinates/addresses."""
    return {
        "id": str(origin.id),
        "case_id": str(origin.case_id),
        "supplier_id": str(origin.supplier_id) if origin.supplier_id else None,
        "plot_id": str(origin.plot_id) if origin.plot_id else None,
        "source_label": origin.source_label,
        "country_code": origin.country_code,
        "subdivision": origin.subdivision,
        "location_description_sha256": _hash_text(origin.location_description),
        "production_period_start": origin.production_period_start.isoformat() if origin.production_period_start else None,
        "production_period_end": origin.production_period_end.isoformat() if origin.production_period_end else None,
        "quantity": _json_safe(origin.quantity),
        "unit": origin.unit,
        "origin_confirmed": origin.origin_confirmed,
        "benchmark_level": origin.benchmark_level,
        "benchmark_version": origin.benchmark_version,
        "notes_sha256": _hash_text(origin.notes),
    }


def _case_query(organization_id: uuid.UUID):
    return (
        select(RiskCase, Shipment, Product, Supplier)
        .join(Shipment, and_(Shipment.id == RiskCase.shipment_id, Shipment.organization_id == organization_id))
        .join(Product, and_(Product.id == Shipment.product_id, Product.organization_id == organization_id))
        .join(Supplier, and_(Supplier.id == Shipment.supplier_id, Supplier.organization_id == organization_id))
        .where(RiskCase.organization_id == organization_id)
        .options(
            selectinload(RiskCase.origins),
            selectinload(RiskCase.evidence_items),
            selectinload(RiskCase.findings).selectinload(RiskFinding.evidence_links),
            selectinload(RiskCase.mitigation_actions),
            selectinload(RiskCase.decisions),
            selectinload(RiskCase.declaration_preparations),
        )
    )


async def _get_case_bundle(
    db: AsyncSession, organization_id: uuid.UUID, case_id: uuid.UUID
) -> tuple[RiskCase, Shipment, Product, Supplier]:
    row = (await db.execute(_case_query(organization_id).where(RiskCase.id == case_id))).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Dossier de diligence raisonnée introuvable.")
    return row


async def _serialize_case(
    db: AsyncSession,
    case: RiskCase,
    shipment: Shipment,
    product: Product,
    supplier: Supplier,
    user: User,
) -> RiskCaseOut:
    plot_ids = [origin.plot_id for origin in case.origins if origin.plot_id]
    plot_map: dict[uuid.UUID, tuple[str | None, str | None]] = {}
    if plot_ids:
        plot_rows = await db.execute(
            select(Plot.id, Plot.name, Plot.internal_ref).where(
                Plot.organization_id == case.organization_id,
                Plot.shipment_id == case.shipment_id,
                Plot.id.in_(plot_ids),
            )
        )
        plot_map = {plot_id: (name, internal_ref) for plot_id, name, internal_ref in plot_rows.all()}

    version_ids = [item.document_version_id for item in case.evidence_items if item.document_version_id]
    document_map: dict[uuid.UUID, tuple[uuid.UUID, int, str, str]] = {}
    if version_ids:
        document_rows = await db.execute(
            select(
                DocumentVersion.id,
                DocumentVersion.document_id,
                DocumentVersion.version_number,
                DocumentVersion.sha256,
                Document.title,
            )
            .join(Document, Document.id == DocumentVersion.document_id)
            .where(
                DocumentVersion.organization_id == case.organization_id,
                Document.organization_id == case.organization_id,
                DocumentVersion.id.in_(version_ids),
            )
        )
        document_map = {
            version_id: (document_id, number, sha256, title)
            for version_id, document_id, number, sha256, title in document_rows.all()
        }

    origins = []
    for origin in case.origins:
        plot_name, plot_ref = plot_map.get(origin.plot_id, (None, None)) if origin.plot_id else (None, None)
        benchmark = classify_country(origin.country_code)
        benchmark_reason = benchmark["reason"] if origin.benchmark_version == COUNTRY_BENCHMARK_VERSION else (
            f"Niveau conservé selon le jeu de références {origin.benchmark_version}; comparez avec la référence actuelle avant une nouvelle décision."
        )
        origins.append(
            RiskCaseOriginOut(
                id=origin.id,
                supplier_id=origin.supplier_id,
                plot_id=origin.plot_id if user.role in _DATA_WRITE_ROLES else None,
                plot_reference=(plot_name or plot_ref or origin.source_label) if user.role in _DATA_WRITE_ROLES else None,
                source_label=origin.source_label,
                country_code=origin.country_code,
                subdivision=origin.subdivision,
                # Precise free-text location is limited to compliance/admin; plot geometry is never serialized here.
                location_description=origin.location_description if user.role in _DATA_WRITE_ROLES else None,
                production_period_start=origin.production_period_start,
                production_period_end=origin.production_period_end,
                quantity=float(origin.quantity) if origin.quantity is not None else None,
                unit=origin.unit,
                origin_confirmed=origin.origin_confirmed,
                benchmark_level=origin.benchmark_level,
                benchmark_version=origin.benchmark_version,
                benchmark_reason=benchmark_reason,
                notes=origin.notes if user.role in _DATA_WRITE_ROLES else None,
            )
        )

    evidence_items = []
    for item in case.evidence_items:
        document = document_map.get(item.document_version_id) if item.document_version_id else None
        evidence_items.append(
            RiskEvidenceOut(
                id=item.id,
                evidence_type=item.evidence_type,
                title=item.title,
                summary=item.summary,
                origin_id=item.origin_id,
                document_version_id=item.document_version_id,
                document_id=document[0] if document else None,
                document_version_number=document[1] if document else None,
                document_sha256=document[2] if document else None,
                source_url=item.source_url,
                source_reference=item.source_reference,
                review_status=item.review_status,
                review_note=item.review_note if user.role in _DECISION_ROLES else None,
                reviewed_by_user_id=item.reviewed_by_user_id,
                reviewed_at=item.reviewed_at,
                created_at=item.created_at,
            )
        )

    findings = [
        RiskFindingOut(
            id=finding.id,
            criterion=finding.criterion,
            label=_CRITERION_LABELS.get(finding.criterion, finding.criterion),
            assessment_status=finding.assessment_status,
            rationale=finding.rationale,
            source_note=finding.source_note,
            evidence_ids=[link.evidence_id for link in finding.evidence_links],
            assessed_by_user_id=finding.assessed_by_user_id,
            assessed_at=finding.assessed_at,
        )
        for finding in case.findings
    ]
    actions = [
        RiskMitigationOut(
            id=action.id,
            title=action.title,
            description=action.description,
            responsible_name=action.responsible_name,
            due_date=action.due_date,
            status=action.status,
            effectiveness_assessed=action.effectiveness_assessed,
            effectiveness_note=action.effectiveness_note,
            evidence_id=action.evidence_id,
            finding_id=action.finding_id,
            created_at=action.created_at,
            updated_at=action.updated_at,
        )
        for action in case.mitigation_actions
    ]
    decisions = [
        RiskDecisionOut(
            id=decision.id,
            decision_number=decision.decision_number,
            outcome=decision.outcome,
            rationale=decision.rationale,
            conditions_or_follow_up=decision.conditions_or_follow_up,
            reference_version=decision.reference_version,
            actor_user_id=decision.actor_user_id,
            created_at=decision.created_at,
        )
        for decision in case.decisions
    ]
    preparations = []
    for preparation in case.declaration_preparations:
        snapshot = json.loads(json.dumps(preparation.snapshot, ensure_ascii=False, default=str))
        if user.role not in _DECISION_ROLES:
            for origin_item in snapshot.get("supply_chain", {}).get("production_origins", []):
                origin_item.pop("location_description", None)
                origin_item["location_redacted"] = True
                origin_item.pop("plot_reference", None)
                origin_item["plot_reference_redacted"] = True
        preparations.append(DeclarationPreparationOut(
            id=preparation.id,
            sequence_number=preparation.sequence_number,
            status=preparation.status,
            internal_format_version=preparation.internal_format_version,
            snapshot=snapshot,
            missing_fields=preparation.missing_fields,
            stale_reason=preparation.stale_reason,
            created_by_user_id=preparation.created_by_user_id,
            created_at=preparation.created_at,
        ))
    return RiskCaseOut(
        id=case.id,
        case_reference=case.case_reference,
        shipment_id=shipment.id,
        shipment_reference=shipment.reference,
        product_id=product.id,
        product_name=product.name,
        commodity=product.commodity,
        hs_code=product.hs_code,
        supplier_id=supplier.id,
        supplier_name=supplier.name,
        quantity=float(shipment.quantity) if shipment.quantity is not None else None,
        unit=shipment.unit,
        country_of_production=shipment.country_of_production,
        economic_role=case.economic_role,
        company_size=case.company_size,
        role_confirmed=case.role_confirmed,
        role_confirmation_note=case.role_confirmation_note if user.role in _DATA_WRITE_ROLES else None,
        assessment_route=case.assessment_route,
        article13_complexity_assessed=case.article13_complexity_assessed,
        article13_mixing_assessed=case.article13_mixing_assessed,
        article13_assessment_note=case.article13_assessment_note if user.role in _DATA_WRITE_ROLES else None,
        product_scope_status=case.product_scope_status,
        product_scope_note=case.product_scope_note if user.role in _DATA_WRITE_ROLES else None,
        status=case.status,
        decision_state=case.decision_state,
        decision_outcome=case.decision_outcome,
        decision_rationale=case.decision_rationale if user.role in _DECISION_ROLES else None,
        decision_at=case.decision_at,
        regulatory_reference_version=case.regulatory_reference_version,
        origins=origins,
        evidence_items=evidence_items,
        findings=findings,
        mitigation_actions=actions,
        decisions=decisions,
        declaration_preparations=preparations,
        created_at=case.created_at,
        updated_at=case.updated_at,
    )


async def _serialize_bundle(db: AsyncSession, row, user: User) -> RiskCaseOut:
    return await _serialize_case(db, row[0], row[1], row[2], row[3], user)


def _validate_origin_confirmation(origin: RiskCaseOrigin) -> None:
    if origin.origin_confirmed:
        if not origin.country_code or not (origin.plot_id or (origin.location_description or "").strip()):
            raise HTTPException(status_code=422, detail="Une origine confirmée doit préciser le pays et une parcelle ou une localisation.")
        if len((origin.notes or "").strip()) < 10:
            raise HTTPException(status_code=422, detail="Une origine confirmée exige une justification (10 caractères minimum).")
        result = classify_country(origin.country_code)
        if result["level"] == "unknown":
            raise HTTPException(status_code=422, detail="Le code pays n'est pas vérifié dans le benchmark sélectionné.")


def _case_changed(
    db: AsyncSession,
    request: Request,
    user: User,
    case: RiskCase,
    *,
    reason: str,
) -> None:
    """Mark a prior human decision and all dependent prefill snapshots stale."""
    if case.decision_state == "current":
        case.decision_state = "stale"
        case.status = "in_assessment"
    elif case.status == "prepared_for_declaration":
        case.status = "in_assessment"
    case.updated_by_user_id = user.id
    for preparation in case.declaration_preparations:
        if preparation.status == "stale":
            continue
        previous = {"status": preparation.status, "stale_reason": preparation.stale_reason}
        preparation.status = "stale"
        preparation.stale_reason = reason[:2000]
        record_audit_event(
            db,
            request,
            organization_id=case.organization_id,
            actor_user_id=user.id,
            action="declaration_preparation.staled",
            object_type="declaration_preparation",
            object_id=preparation.id,
            previous_data=previous,
            new_data={"status": preparation.status, "stale_reason": preparation.stale_reason},
        )


def _require_case_write(user: User) -> uuid.UUID:
    return _organization_id(user, _ASSESS_ROLES)


async def _validate_origin_links(
    db: AsyncSession,
    organization_id: uuid.UUID,
    shipment_id: uuid.UUID,
    supplier_id: uuid.UUID | None,
    plot_id: uuid.UUID | None,
) -> None:
    if supplier_id is not None:
        exists = (await db.execute(select(Supplier.id).where(
            Supplier.id == supplier_id, Supplier.organization_id == organization_id
        ))).scalar_one_or_none()
        if exists is None:
            raise HTTPException(status_code=404, detail="Fournisseur source introuvable dans l'organisation.")
    if plot_id is not None:
        exists = (await db.execute(select(Plot.id).where(
            Plot.id == plot_id,
            Plot.organization_id == organization_id,
            Plot.shipment_id == shipment_id,
        ))).scalar_one_or_none()
        if exists is None:
            raise HTTPException(status_code=404, detail="Parcelle introuvable pour ce lot dans l'organisation.")


async def _validate_case_evidence_ids(
    db: AsyncSession, organization_id: uuid.UUID, case_id: uuid.UUID, evidence_ids: list[uuid.UUID]
) -> list[RiskEvidence]:
    if not evidence_ids:
        return []
    if len(evidence_ids) != len(set(evidence_ids)):
        raise HTTPException(status_code=422, detail="Une preuve ne peut apparaître qu'une fois dans le même constat.")
    result = await db.execute(
        select(RiskEvidence).where(
            RiskEvidence.organization_id == organization_id,
            RiskEvidence.case_id == case_id,
            RiskEvidence.id.in_(evidence_ids),
        )
    )
    rows = result.scalars().all()
    if len(rows) != len(evidence_ids):
        raise HTTPException(status_code=404, detail="Une preuve liée est introuvable dans ce dossier.")
    return rows


def _assessment_snapshot(case: RiskCase) -> dict[str, Any]:
    return _json_safe(
        {
            "case_id": case.id,
            "case_reference": case.case_reference,
            "role": case.economic_role,
            "company_size": case.company_size,
            "role_confirmed": case.role_confirmed,
            "role_confirmation_note": case.role_confirmation_note,
            "assessment_route": case.assessment_route,
            "article13_complexity_assessed": case.article13_complexity_assessed,
            "article13_mixing_assessed": case.article13_mixing_assessed,
            "article13_assessment_note": case.article13_assessment_note,
            "product_scope_status": case.product_scope_status,
            "product_scope_note": case.product_scope_note,
            "reference_version": case.regulatory_reference_version,
            "origins": [
                {
                    "id": origin.id,
                    "country_code": origin.country_code,
                    "subdivision": origin.subdivision,
                    "plot_id": origin.plot_id,
                    "location_description_sha256": _hash_text(origin.location_description),
                    "production_period_start": origin.production_period_start,
                    "production_period_end": origin.production_period_end,
                    "quantity": origin.quantity,
                    "unit": origin.unit,
                    "origin_confirmed": origin.origin_confirmed,
                    "benchmark_level": origin.benchmark_level,
                    "benchmark_version": origin.benchmark_version,
                }
                for origin in case.origins
            ],
            "findings": [
                {
                    "criterion": finding.criterion,
                    "assessment_status": finding.assessment_status,
                    "rationale": finding.rationale,
                    "source_note": finding.source_note,
                    "evidence_ids": [str(link.evidence_id) for link in finding.evidence_links],
                }
                for finding in case.findings
            ],
            "evidence": [
                {
                    "id": evidence.id,
                    "type": evidence.evidence_type,
                    "title": evidence.title,
                    "summary_sha256": _hash_text(evidence.summary),
                    "review_status": evidence.review_status,
                    "document_version_id": evidence.document_version_id,
                    "source_reference": evidence.source_reference,
                }
                for evidence in case.evidence_items
            ],
            "mitigation_actions": [
                {
                    "id": action.id,
                    "finding_id": action.finding_id,
                    "status": action.status,
                    "effectiveness_assessed": action.effectiveness_assessed,
                    "effectiveness_note": action.effectiveness_note,
                }
                for action in case.mitigation_actions
            ],
        }
    )


@router.get("/risks/reference", summary="Références EUDR versionnées utilisées par le workflow")
async def get_risk_reference(
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    _organization_id(current_user)
    manifest = reference_manifest()
    entries = []
    for entry in PRODUCT_SCOPE_CATALOG:
        entries.append({**entry, "applies_from": entry["applies_from"].isoformat() if entry["applies_from"] else None})
    return {
        **manifest,
        "product_scope_entries": entries,
        "product_scope_note": PRODUCT_SCOPE_NOTE,
        "country_lookup_note": "Les pays non mappés sont inconnus dans ce jeu de références; vérifiez le code et la classification officielle. Un niveau bas ne suffit pas, à lui seul, à conclure à un risque nul ou négligeable.",
    }


@router.get("/risk-cases", response_model=RiskCaseListOut, summary="Lister les dossiers Risques et DDR de l'organisation")
async def list_risk_cases(
    status: str | None = Query(default=None, max_length=40),
    shipment_id: uuid.UUID | None = None,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RiskCaseListOut:
    organization_id = _organization_id(current_user)
    filters = [RiskCase.organization_id == organization_id]
    if status:
        allowed = {"draft", "in_assessment", "mitigation_required", "human_decision_recorded", "preparation_incomplete", "prepared_for_declaration", "blocked"}
        if status not in allowed:
            raise HTTPException(status_code=422, detail="Filtre de statut inconnu.")
        filters.append(RiskCase.status == status)
    if shipment_id:
        filters.append(RiskCase.shipment_id == shipment_id)
    count = (await db.execute(select(func.count()).select_from(RiskCase).where(*filters))).scalar_one() or 0
    base = _case_query(organization_id).where(*filters)
    status_rows = await db.execute(
        select(RiskCase.status, func.count()).where(RiskCase.organization_id == organization_id).group_by(RiskCase.status)
    )
    by_status = {key: value for key, value in status_rows.all()}
    rows = (await db.execute(base.order_by(RiskCase.updated_at.desc()).limit(limit).offset(offset))).all()
    return RiskCaseListOut(items=[await _serialize_bundle(db, row, current_user) for row in rows], total=count, by_status=by_status)


@router.post("/risk-cases", response_model=RiskCaseOut, status_code=201, summary="Créer un dossier Risques/DDR depuis un lot")
async def create_risk_case(
    payload: RiskCaseCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RiskCaseOut:
    organization_id = _organization_id(current_user, _DATA_WRITE_ROLES)
    shipment_row = await db.execute(
        select(Shipment, Product, Supplier)
        .join(Product, and_(Product.id == Shipment.product_id, Product.organization_id == organization_id))
        .join(Supplier, and_(Supplier.id == Shipment.supplier_id, Supplier.organization_id == organization_id))
        .where(Shipment.id == payload.shipment_id, Shipment.organization_id == organization_id)
    )
    bundle = shipment_row.first()
    if bundle is None:
        raise HTTPException(status_code=404, detail="Lot introuvable dans l'organisation.")
    shipment, product, supplier = bundle
    duplicate = await db.execute(
        select(RiskCase.id).where(
            RiskCase.organization_id == organization_id,
            RiskCase.shipment_id == shipment.id,
        )
    )
    if duplicate.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Un dossier Risques/DDR existe déjà pour ce lot.")
    if payload.assessment_route == "article13_simplified":
        raise HTTPException(status_code=422, detail="Créez d'abord le dossier en voie complète, vérifiez et confirmez chaque origine, puis demandez la route simplifiée Article 13.")

    case = RiskCase(
        id=uuid.uuid4(),
        organization_id=organization_id,
        shipment_id=shipment.id,
        case_reference=f"DDR-{uuid.uuid4().hex[:10].upper()}",
        economic_role=payload.economic_role,
        company_size=payload.company_size,
        role_confirmed=payload.role_confirmed,
        role_confirmation_note=payload.role_confirmation_note.strip() if payload.role_confirmation_note else None,
        assessment_route=payload.assessment_route,
        article13_complexity_assessed=payload.article13_complexity_assessed,
        article13_mixing_assessed=payload.article13_mixing_assessed,
        article13_assessment_note=payload.article13_assessment_note.strip() if payload.article13_assessment_note else None,
        product_scope_status=payload.product_scope_status,
        product_scope_note=payload.product_scope_note.strip() if payload.product_scope_note else None,
        status="draft",
        decision_state="none",
        regulatory_reference_version=_REFERENCE_VERSION,
        created_by_user_id=current_user.id,
        updated_by_user_id=current_user.id,
    )
    db.add(case)
    plot_rows = await db.execute(
        select(Plot.id, Plot.name, Plot.internal_ref).where(
            Plot.organization_id == organization_id,
            Plot.shipment_id == shipment.id,
        ).order_by(Plot.created_at, Plot.id)
    )
    plots = plot_rows.all()
    if plots:
        for plot_id, name, internal_ref in plots:
            benchmark = classify_country(shipment.country_of_production)
            db.add(RiskCaseOrigin(
                id=uuid.uuid4(),
                organization_id=organization_id,
                case_id=case.id,
                supplier_id=supplier.id,
                plot_id=plot_id,
                source_label=name or internal_ref,
                country_code=(shipment.country_of_production or "").upper() or None,
                quantity=None,  # allocation between plots must be entered by a human
                unit=shipment.unit,
                origin_confirmed=False,
                benchmark_level=benchmark["level"],
                benchmark_version=COUNTRY_BENCHMARK_VERSION,
                created_by_user_id=current_user.id,
            ))
    else:
        benchmark = classify_country(shipment.country_of_production)
        db.add(RiskCaseOrigin(
            id=uuid.uuid4(),
            organization_id=organization_id,
            case_id=case.id,
            supplier_id=supplier.id,
            country_code=(shipment.country_of_production or "").upper() or None,
            quantity=shipment.quantity,
            unit=shipment.unit,
            origin_confirmed=False,
            benchmark_level=benchmark["level"],
            benchmark_version=COUNTRY_BENCHMARK_VERSION,
            created_by_user_id=current_user.id,
        ))
    for criterion in RISK_CRITERIA:
        db.add(RiskFinding(
            id=uuid.uuid4(),
            organization_id=organization_id,
            case_id=case.id,
            criterion=criterion["code"],
            assessment_status="not_assessed",
        ))
    await db.flush()
    record_audit_event(
        db,
        request,
        organization_id=organization_id,
        actor_user_id=current_user.id,
        action="risk_case.created",
        object_type="risk_case",
        object_id=case.id,
        new_data={
            "case_reference": case.case_reference,
            "shipment_id": str(shipment.id),
            "shipment_reference": shipment.reference,
            "product_id": str(product.id),
            "supplier_id": str(supplier.id),
            "economic_role": case.economic_role,
            "company_size": case.company_size,
            "reference_version": case.regulatory_reference_version,
        },
    )
    row = await _get_case_bundle(db, organization_id, case.id)
    return await _serialize_bundle(db, row, current_user)


@router.get("/risk-cases/{case_id}", response_model=RiskCaseOut, summary="Consulter un dossier Risques/DDR")
async def get_risk_case(
    case_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RiskCaseOut:
    organization_id = _organization_id(current_user)
    row = await _get_case_bundle(db, organization_id, case_id)
    return await _serialize_bundle(db, row, current_user)


@router.patch("/risk-cases/{case_id}", response_model=RiskCaseOut, summary="Mettre à jour le rôle, la route et le périmètre produit")
async def patch_risk_case(
    case_id: uuid.UUID,
    payload: RiskCasePatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RiskCaseOut:
    organization_id = _organization_id(current_user, _DATA_WRITE_ROLES)
    row = await _get_case_bundle(db, organization_id, case_id)
    case = row[0]
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return await _serialize_bundle(db, row, current_user)
    if "economic_role" in changes and changes["economic_role"] != case.economic_role and "role_confirmed" not in changes:
        changes["role_confirmed"] = False
        changes["role_confirmation_note"] = None
    if changes.get("role_confirmed", case.role_confirmed) is True:
        role = changes.get("economic_role", case.economic_role)
        note = changes.get("role_confirmation_note", case.role_confirmation_note)
        if role == "unknown" or len((note or "").strip()) < 12:
            raise HTTPException(status_code=422, detail="La confirmation du rôle exige un rôle renseigné et une justification.")
    if changes.get("product_scope_status") == "confirmed_in_scope":
        note = changes.get("product_scope_note", case.product_scope_note)
        if len((note or "").strip()) < 12:
            raise HTTPException(status_code=422, detail="La confirmation humaine du champ produit exige une justification.")
    previous = model_snapshot(case)
    for key, value in changes.items():
        setattr(case, key, value.strip() if isinstance(value, str) else value)
    if case.assessment_route == "article13_simplified":
        origins = list(case.origins)
        if not origins or not case.article13_complexity_assessed or not case.article13_mixing_assessed or len((case.article13_assessment_note or "").strip()) < 20:
            raise HTTPException(status_code=422, detail="La route de l'article 13 exige l'appréciation documentée de la complexité et du mélange/contournement.")
        if any(not origin.origin_confirmed or origin.benchmark_level != "low" for origin in origins):
            raise HTTPException(status_code=422, detail="La route simplifiée de l'article 13 exige des origines confirmées classées faibles; cela ne constitue pas une décision de risque nul.")
    _case_changed(db, request, current_user, case, reason="Les données du dossier ont changé après la précédente appréciation.")
    if case.product_scope_status == "not_in_scope":
        case.status = "blocked"
    else:
        case.status = "in_assessment"
    await db.flush()
    record_audit_event(
        db,
        request,
        organization_id=organization_id,
        actor_user_id=current_user.id,
        action="risk_case.updated",
        object_type="risk_case",
        object_id=case.id,
        previous_data=previous,
        new_data=model_snapshot(case),
    )
    updated = await _get_case_bundle(db, organization_id, case.id)
    return await _serialize_bundle(db, updated, current_user)


@router.post("/risk-cases/{case_id}/origins", response_model=RiskCaseOut, status_code=201, summary="Ajouter une origine/allocation au dossier")
async def create_risk_origin(
    case_id: uuid.UUID,
    payload: RiskCaseOriginCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RiskCaseOut:
    organization_id = _organization_id(current_user, _DATA_WRITE_ROLES)
    row = await _get_case_bundle(db, organization_id, case_id)
    case, shipment = row[0], row[1]
    await _validate_origin_links(db, organization_id, shipment.id, payload.supplier_id, payload.plot_id)
    benchmark = classify_country(payload.country_code)
    origin = RiskCaseOrigin(
        id=uuid.uuid4(), organization_id=organization_id, case_id=case.id,
        supplier_id=payload.supplier_id, plot_id=payload.plot_id,
        source_label=payload.source_label.strip() if payload.source_label else None,
        country_code=payload.country_code, subdivision=payload.subdivision,
        location_description=payload.location_description,
        production_period_start=payload.production_period_start,
        production_period_end=payload.production_period_end,
        quantity=payload.quantity, unit=payload.unit,
        origin_confirmed=payload.origin_confirmed,
        benchmark_level=benchmark["level"], benchmark_version=COUNTRY_BENCHMARK_VERSION,
        notes=payload.notes, created_by_user_id=current_user.id,
    )
    _validate_origin_confirmation(origin)
    case.origins.append(origin)
    previous_case = model_snapshot(case)
    _case_changed(db, request, current_user, case, reason="Une origine supplémentaire a été ajoutée.")
    case.status = "in_assessment"
    case.updated_by_user_id = current_user.id
    await db.flush()
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_case_origin.created", object_type="risk_case_origin", object_id=origin.id,
        new_data=_origin_audit_snapshot(origin),
    )
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_case.origin_added", object_type="risk_case", object_id=case.id,
        previous_data=previous_case, new_data=model_snapshot(case),
    )
    updated = await _get_case_bundle(db, organization_id, case.id)
    return await _serialize_bundle(db, updated, current_user)


@router.patch("/risk-cases/{case_id}/origins/{origin_id}", response_model=RiskCaseOut, summary="Mettre à jour une origine/allocation")
async def patch_risk_origin(
    case_id: uuid.UUID,
    origin_id: uuid.UUID,
    payload: RiskCaseOriginPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RiskCaseOut:
    organization_id = _organization_id(current_user, _DATA_WRITE_ROLES)
    row = await _get_case_bundle(db, organization_id, case_id)
    case, shipment = row[0], row[1]
    origin = next((item for item in case.origins if item.id == origin_id), None)
    if origin is None:
        raise HTTPException(status_code=404, detail="Origine introuvable dans ce dossier.")
    previous = _origin_audit_snapshot(origin)
    changes = payload.model_dump(exclude_unset=True)
    if "supplier_id" in changes and changes["supplier_id"] is None:
        pass
    await _validate_origin_links(
        db, organization_id, shipment.id,
        changes.get("supplier_id", origin.supplier_id),
        changes.get("plot_id", origin.plot_id),
    )
    for key, value in changes.items():
        setattr(origin, key, value.strip() if isinstance(value, str) else value)
    if "country_code" in changes:
        benchmark = classify_country(origin.country_code)
        origin.benchmark_level = benchmark["level"]
        origin.benchmark_version = COUNTRY_BENCHMARK_VERSION
    if origin.production_period_start and origin.production_period_end and origin.production_period_end < origin.production_period_start:
        raise HTTPException(status_code=422, detail="La fin de période doit être postérieure au début.")
    _validate_origin_confirmation(origin)
    previous_case = model_snapshot(case)
    _case_changed(db, request, current_user, case, reason="Les données d'origine ont changé après la précédente appréciation.")
    case.status = "in_assessment"
    case.updated_by_user_id = current_user.id
    await db.flush()
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_case_origin.updated", object_type="risk_case_origin", object_id=origin.id,
        previous_data=previous, new_data=_origin_audit_snapshot(origin),
    )
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_case.origin_updated", object_type="risk_case", object_id=case.id,
        previous_data=previous_case, new_data=model_snapshot(case),
    )
    updated = await _get_case_bundle(db, organization_id, case.id)
    return await _serialize_bundle(db, updated, current_user)


@router.post("/risk-cases/{case_id}/evidence", response_model=RiskCaseOut, status_code=201, summary="Ajouter une source ou une pièce justificative")
async def create_risk_evidence(
    case_id: uuid.UUID,
    payload: RiskEvidenceCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RiskCaseOut:
    organization_id = _require_case_write(current_user)
    row = await _get_case_bundle(db, organization_id, case_id)
    case = row[0]
    if payload.origin_id and not any(origin.id == payload.origin_id for origin in case.origins):
        raise HTTPException(status_code=404, detail="Origine introuvable dans ce dossier.")
    if payload.document_version_id:
        document_row = await db.execute(
            select(DocumentVersion, Document)
            .join(Document, Document.id == DocumentVersion.document_id)
            .where(
                DocumentVersion.id == payload.document_version_id,
                DocumentVersion.organization_id == organization_id,
                Document.organization_id == organization_id,
                Document.is_archived.is_(False),
            )
        )
        found = document_row.first()
        if found is None:
            raise HTTPException(status_code=404, detail="Version documentaire introuvable dans l'organisation.")
        version, _document = found
        if version.scan_status != "clean":
            raise HTTPException(status_code=422, detail="Seule une version dont le contrôle antivirus est sain peut être reliée comme preuve.")
    evidence = RiskEvidence(
        id=uuid.uuid4(), organization_id=organization_id, case_id=case.id,
        origin_id=payload.origin_id, document_version_id=payload.document_version_id,
        evidence_type=payload.evidence_type, title=payload.title.strip(), summary=payload.summary.strip(),
        source_url=payload.source_url, source_reference=payload.source_reference,
        review_status="to_review", created_by_user_id=current_user.id,
    )
    case.evidence_items.append(evidence)
    previous_case = model_snapshot(case)
    _case_changed(db, request, current_user, case, reason="Une nouvelle source ou pièce justificative a été ajoutée.")
    case.status = "in_assessment"
    case.updated_by_user_id = current_user.id
    await db.flush()
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_evidence.created", object_type="risk_case_evidence", object_id=evidence.id,
        new_data={
            "case_id": str(case.id), "evidence_type": evidence.evidence_type,
            "title": evidence.title, "summary_sha256": _hash_text(evidence.summary),
            "origin_id": str(evidence.origin_id) if evidence.origin_id else None,
            "document_version_id": str(evidence.document_version_id) if evidence.document_version_id else None,
            "source_url": evidence.source_url, "source_reference": evidence.source_reference,
            "review_status": evidence.review_status,
        },
    )
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_case.evidence_added", object_type="risk_case", object_id=case.id,
        previous_data=previous_case, new_data=model_snapshot(case),
    )
    updated = await _get_case_bundle(db, organization_id, case.id)
    return await _serialize_bundle(db, updated, current_user)


@router.patch("/risk-cases/{case_id}/evidence/{evidence_id}", response_model=RiskCaseOut, summary="Revoir une source ou une pièce justificative")
async def patch_risk_evidence(
    case_id: uuid.UUID,
    evidence_id: uuid.UUID,
    payload: RiskEvidencePatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RiskCaseOut:
    organization_id = _require_case_write(current_user)
    row = await _get_case_bundle(db, organization_id, case_id)
    case = row[0]
    evidence = next((item for item in case.evidence_items if item.id == evidence_id), None)
    if evidence is None:
        raise HTTPException(status_code=404, detail="Élément de preuve introuvable dans ce dossier.")
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("review_status") == "reviewed" and current_user.role not in _DECISION_ROLES:
        raise HTTPException(status_code=403, detail="Seuls admin/conformité peuvent valider la revue d'une preuve.")
    previous = {
        "review_status": evidence.review_status, "review_note": evidence.review_note,
        "reviewed_by_user_id": str(evidence.reviewed_by_user_id) if evidence.reviewed_by_user_id else None,
        "reviewed_at": evidence.reviewed_at.isoformat() if evidence.reviewed_at else None,
    }
    if "review_status" in changes:
        evidence.review_status = changes["review_status"]
        if evidence.review_status == "reviewed":
            evidence.reviewed_by_user_id = current_user.id
            evidence.reviewed_at = datetime.now(timezone.utc)
        else:
            evidence.reviewed_by_user_id = None
            evidence.reviewed_at = None
    if "review_note" in changes:
        evidence.review_note = changes["review_note"].strip() if changes["review_note"] else None
    _case_changed(db, request, current_user, case, reason="Le statut de revue d'une preuve a changé.")
    case.status = "in_assessment"
    case.updated_by_user_id = current_user.id
    await db.flush()
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_evidence.review_updated", object_type="risk_case_evidence", object_id=evidence.id,
        previous_data=previous,
        new_data={
            "review_status": evidence.review_status, "review_note": evidence.review_note,
            "reviewed_by_user_id": str(evidence.reviewed_by_user_id) if evidence.reviewed_by_user_id else None,
            "reviewed_at": evidence.reviewed_at.isoformat() if evidence.reviewed_at else None,
        },
    )
    updated = await _get_case_bundle(db, organization_id, case.id)
    return await _serialize_bundle(db, updated, current_user)


@router.patch("/risk-cases/{case_id}/findings/{criterion}", response_model=RiskCaseOut, summary="Mettre à jour un constat humain Article 10")
async def patch_risk_finding(
    case_id: uuid.UUID,
    criterion: str,
    payload: RiskFindingPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RiskCaseOut:
    organization_id = _require_case_write(current_user)
    row = await _get_case_bundle(db, organization_id, case_id)
    case = row[0]
    finding = next((item for item in case.findings if item.criterion == criterion), None)
    if finding is None:
        raise HTTPException(status_code=404, detail="Critère non référencé dans ce dossier.")
    changes = payload.model_dump(exclude_unset=True)
    evidence_ids = changes.pop("evidence_ids", None)
    if changes.get("assessment_status") == "concern_identified" and evidence_ids is None:
        if not finding.evidence_links and not (changes.get("source_note", finding.source_note) or "").strip():
            raise HTTPException(status_code=422, detail="Un signal identifié doit être relié à une preuve ou à une référence de source.")
    evidence_rows: list[RiskEvidence] | None = None
    if evidence_ids is not None:
        evidence_rows = await _validate_case_evidence_ids(db, organization_id, case.id, evidence_ids)
        if changes.get("assessment_status", finding.assessment_status) == "concern_identified" and not evidence_rows and not (changes.get("source_note", finding.source_note) or "").strip():
            raise HTTPException(status_code=422, detail="Un signal identifié doit être relié à une preuve ou à une référence de source.")
    previous = {
        "criterion": finding.criterion,
        "assessment_status": finding.assessment_status,
        "rationale": finding.rationale,
        "source_note": finding.source_note,
        "evidence_ids": [str(link.evidence_id) for link in finding.evidence_links],
    }
    for key, value in changes.items():
        setattr(finding, key, value.strip() if isinstance(value, str) else value)
    if evidence_rows is not None:
        finding.evidence_links.clear()
        await db.flush()
        for evidence in evidence_rows:
            finding.evidence_links.append(RiskFindingEvidence(
                id=uuid.uuid4(), organization_id=organization_id, case_id=case.id,
                evidence_id=evidence.id, created_by_user_id=current_user.id,
            ))
    finding.assessed_by_user_id = current_user.id
    finding.assessed_at = datetime.now(timezone.utc)
    previous_case = model_snapshot(case)
    _case_changed(db, request, current_user, case, reason="Un constat de risque a été modifié après l'appréciation précédente.")
    case.status = "in_assessment"
    case.updated_by_user_id = current_user.id
    await db.flush()
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_finding.updated", object_type="risk_finding", object_id=finding.id,
        previous_data=previous,
        new_data={
            "criterion": finding.criterion, "assessment_status": finding.assessment_status,
            "rationale": finding.rationale, "source_note": finding.source_note,
            "evidence_ids": [str(link.evidence_id) for link in finding.evidence_links],
        },
    )
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_case.finding_updated", object_type="risk_case", object_id=case.id,
        previous_data=previous_case, new_data=model_snapshot(case),
    )
    updated = await _get_case_bundle(db, organization_id, case.id)
    return await _serialize_bundle(db, updated, current_user)


@router.post("/risk-cases/{case_id}/mitigations", response_model=RiskCaseOut, status_code=201, summary="Créer une mesure d'atténuation Article 11")
async def create_mitigation_action(
    case_id: uuid.UUID,
    payload: RiskMitigationCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RiskCaseOut:
    organization_id = _require_case_write(current_user)
    row = await _get_case_bundle(db, organization_id, case_id)
    case = row[0]
    if payload.evidence_id:
        await _validate_case_evidence_ids(db, organization_id, case.id, [payload.evidence_id])
    if payload.finding_id and not any(finding.id == payload.finding_id for finding in case.findings):
        raise HTTPException(status_code=404, detail="Constat introuvable dans ce dossier.")
    action = RiskMitigationAction(
        id=uuid.uuid4(), organization_id=organization_id, case_id=case.id,
        title=payload.title.strip(), description=payload.description.strip(),
        responsible_name=payload.responsible_name.strip() if payload.responsible_name else None,
        due_date=payload.due_date, evidence_id=payload.evidence_id, finding_id=payload.finding_id,
        status="planned", effectiveness_assessed=False, created_by_user_id=current_user.id,
        updated_by_user_id=current_user.id,
    )
    case.mitigation_actions.append(action)
    previous_case = model_snapshot(case)
    _case_changed(db, request, current_user, case, reason="Une mesure d'atténuation a été ajoutée.")
    case.status = "mitigation_required"
    case.updated_by_user_id = current_user.id
    await db.flush()
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_mitigation.created", object_type="risk_mitigation_action", object_id=action.id,
        new_data=model_snapshot(action),
    )
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_case.mitigation_added", object_type="risk_case", object_id=case.id,
        previous_data=previous_case, new_data=model_snapshot(case),
    )
    updated = await _get_case_bundle(db, organization_id, case.id)
    return await _serialize_bundle(db, updated, current_user)


@router.patch("/risk-cases/{case_id}/mitigations/{action_id}", response_model=RiskCaseOut, summary="Mettre à jour une mesure d'atténuation")
async def patch_mitigation_action(
    case_id: uuid.UUID,
    action_id: uuid.UUID,
    payload: RiskMitigationPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RiskCaseOut:
    organization_id = _require_case_write(current_user)
    row = await _get_case_bundle(db, organization_id, case_id)
    case = row[0]
    action = next((item for item in case.mitigation_actions if item.id == action_id), None)
    if action is None:
        raise HTTPException(status_code=404, detail="Mesure d'atténuation introuvable dans ce dossier.")
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("evidence_id"):
        await _validate_case_evidence_ids(db, organization_id, case.id, [changes["evidence_id"]])
    if changes.get("finding_id") and not any(finding.id == changes["finding_id"] for finding in case.findings):
        raise HTTPException(status_code=404, detail="Constat introuvable dans ce dossier.")
    if changes.get("effectiveness_assessed") is True and len((changes.get("effectiveness_note", action.effectiveness_note) or "").strip()) < 12:
        raise HTTPException(status_code=422, detail="Documentez l'évaluation d'efficacité de la mesure.")
    previous = model_snapshot(action)
    for key, value in changes.items():
        setattr(action, key, value.strip() if isinstance(value, str) else value)
    action.updated_by_user_id = current_user.id
    previous_case = model_snapshot(case)
    _case_changed(db, request, current_user, case, reason="Une mesure d'atténuation a été modifiée après l'appréciation précédente.")
    case.status = "mitigation_required" if action.status in {"planned", "in_progress", "ineffective"} else "in_assessment"
    case.updated_by_user_id = current_user.id
    await db.flush()
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_mitigation.updated", object_type="risk_mitigation_action", object_id=action.id,
        previous_data=previous, new_data=model_snapshot(action),
    )
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_case.mitigation_updated", object_type="risk_case", object_id=case.id,
        previous_data=previous_case, new_data=model_snapshot(case),
    )
    updated = await _get_case_bundle(db, organization_id, case.id)
    return await _serialize_bundle(db, updated, current_user)


def _no_or_negligible_blockers(case: RiskCase, shipment: Shipment, product: Product) -> list[str]:
    missing: list[str] = []
    if not case.role_confirmed or case.economic_role == "unknown":
        missing.append("Confirmer le rôle économique et sa justification.")
    if case.economic_role not in {"operator", "downstream_operator"}:
        missing.append("Confirmer le rôle d'opérateur concerné avant de préparer une déclaration.")
    if case.product_scope_status != "confirmed_in_scope":
        missing.append("Faire confirmer humainement l'appartenance du produit à l'annexe I.")
    if not (product.hs_code or "").strip():
        missing.append("Renseigner le code SH/CN du produit.")
    if not (product.description or "").strip():
        missing.append("Renseigner la description commerciale du produit.")
    if shipment.quantity is None or shipment.quantity <= 0 or not (shipment.unit or "").strip():
        missing.append("Renseigner la quantité et l'unité du lot.")
    if not case.origins:
        missing.append("Renseigner au moins une origine de production.")
    for origin in case.origins:
        if not origin.origin_confirmed:
            missing.append(f"Confirmer l'origine {origin.source_label or str(origin.id)[:8]}.")
        if not origin.country_code or origin.benchmark_level == "unknown":
            missing.append(f"Vérifier le pays d'origine de {origin.source_label or str(origin.id)[:8]}.")
        if not (origin.plot_id or (origin.location_description or "").strip()):
            missing.append(f"Renseigner la parcelle ou la localisation de {origin.source_label or str(origin.id)[:8]}.")
    if case.assessment_route == "unknown":
        missing.append("Confirmer la voie d'évaluation (complète ou simplifiée).")
    if case.assessment_route == "article13_simplified":
        if not case.article13_complexity_assessed or not case.article13_mixing_assessed or len((case.article13_assessment_note or "").strip()) < 20:
            missing.append("Documenter la complexité et le risque de mélange/contournement pour l'article 13.")
        if not case.origins or any(origin.benchmark_level != "low" or not origin.origin_confirmed for origin in case.origins):
            missing.append("La route de l'article 13 exige des origines confirmées classées à faible risque.")
    elif case.assessment_route == "full":
        unassessed = [finding.criterion for finding in case.findings if finding.assessment_status in {"not_assessed", "inconclusive"}]
        if unassessed:
            missing.append("Terminer l'examen humain des facteurs de risque non évalués ou inconclusifs.")
    else:
        missing.append("Choisir une voie d'évaluation documentée.")
    evidence_by_type = {kind: [] for kind in ("deforestation_free", "legality")}
    for evidence in case.evidence_items:
        if evidence.evidence_type in evidence_by_type and evidence.review_status == "reviewed":
            evidence_by_type[evidence.evidence_type].append(evidence)
    if not evidence_by_type["deforestation_free"]:
        missing.append("Revoir au moins une source relative à l'absence de déforestation.")
    if not evidence_by_type["legality"]:
        missing.append("Revoir au moins une source relative à la légalité de production.")
    concerns = [finding for finding in case.findings if finding.assessment_status == "concern_identified"]
    for finding in concerns:
        actions = [action for action in case.mitigation_actions if action.finding_id == finding.id]
        if not any(action.status == "completed" and action.effectiveness_assessed for action in actions):
            missing.append(f"Traiter et évaluer l'efficacité des mesures pour le critère {finding.criterion}.")
    pending_actions = [action for action in case.mitigation_actions if action.status in {"planned", "in_progress", "ineffective"}]
    if pending_actions:
        missing.append("Clore ou réévaluer les mesures d'atténuation ouvertes ou jugées inefficaces.")
    return list(dict.fromkeys(missing))


@router.post("/risk-cases/{case_id}/decisions", response_model=RiskCaseOut, summary="Enregistrer une décision humaine de diligence raisonnée")
async def create_risk_decision(
    case_id: uuid.UUID,
    payload: RiskDecisionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RiskCaseOut:
    organization_id = _organization_id(current_user, _DECISION_ROLES)
    row = await _get_case_bundle(db, organization_id, case_id)
    case, shipment, product = row[0], row[1], row[2]
    if payload.outcome == "no_or_negligible":
        blockers = _no_or_negligible_blockers(case, shipment, product)
        if blockers:
            raise HTTPException(status_code=409, detail={"message": "La décision de risque nul ou négligeable ne peut pas être enregistrée : des prérequis documentaires ou humains manquent.", "missing": blockers})
    previous_case = model_snapshot(case)
    prior_decisions = len(case.decisions)
    decision = RiskDecision(
        id=uuid.uuid4(), organization_id=organization_id, case_id=case.id,
        decision_number=prior_decisions + 1, outcome=payload.outcome,
        rationale=payload.rationale.strip(),
        conditions_or_follow_up=payload.conditions_or_follow_up.strip() if payload.conditions_or_follow_up else None,
        reference_version=case.regulatory_reference_version,
        assessment_snapshot=_assessment_snapshot(case), actor_user_id=current_user.id,
    )
    db.add(decision)
    for preparation in case.declaration_preparations:
        if preparation.status != "stale":
            previous_prep = {"status": preparation.status, "stale_reason": preparation.stale_reason}
            preparation.status = "stale"
            preparation.stale_reason = "Une nouvelle décision humaine a été enregistrée; générer une nouvelle préparation interne."
            record_audit_event(
                db, request, organization_id=organization_id, actor_user_id=current_user.id,
                action="declaration_preparation.staled", object_type="declaration_preparation", object_id=preparation.id,
                previous_data=previous_prep, new_data={"status": preparation.status, "stale_reason": preparation.stale_reason},
            )
    case.decision_state = "current"
    case.decision_outcome = payload.outcome
    case.decision_rationale = payload.rationale.strip()
    case.decision_at = datetime.now(timezone.utc)
    case.status = "human_decision_recorded" if payload.outcome == "no_or_negligible" else "blocked"
    case.updated_by_user_id = current_user.id
    await db.flush()
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_decision.recorded", object_type="risk_decision", object_id=decision.id,
        previous_data={"case_id": str(case.id), "previous_decision_state": previous_case.get("decision_state"), "previous_outcome": previous_case.get("decision_outcome")},
        new_data={
            "case_id": str(case.id), "decision_number": decision.decision_number,
            "outcome": decision.outcome, "rationale": decision.rationale,
            "conditions_or_follow_up": decision.conditions_or_follow_up,
            "reference_version": decision.reference_version,
            "assessment_snapshot_sha256": hashlib.sha256(json.dumps(decision.assessment_snapshot, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest(),
        },
    )
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_case.decision_state_changed", object_type="risk_case", object_id=case.id,
        previous_data=previous_case, new_data=model_snapshot(case),
    )
    updated = await _get_case_bundle(db, organization_id, case.id)
    return await _serialize_bundle(db, updated, current_user)


async def _preparation_missing_fields(
    db: AsyncSession, case: RiskCase, shipment: Shipment, product: Product, organization: Organization
) -> tuple[list[str], list[dict[str, Any]], list[dict[str, Any]]]:
    missing: list[str] = []
    if not (organization.name or organization.legal_name):
        missing.append("Identité de l'opérateur (nom légal ou raison sociale).")
    if not organization.address:
        missing.append("Adresse de l'opérateur.")
    if not organization.eori:
        missing.append("Numéro EORI à vérifier/renseigner pour l'opération concernée (Annexe II, point 1).")
    if case.economic_role != "operator" or not case.role_confirmed:
        missing.append("Rôle d'opérateur concerné confirmé par une personne habilitée.")
    if case.company_size == "unknown":
        missing.append("Taille réglementaire de l'entité à confirmer selon les critères applicables; ne pas la déduire du plan SaaS.")
    if case.decision_state != "current" or case.decision_outcome != "no_or_negligible":
        missing.append("Décision humaine actuelle: risque nul ou seulement négligeable.")
    if case.product_scope_status != "confirmed_in_scope":
        missing.append("Confirmation humaine du code et du périmètre produit de l'annexe I.")
    if not product.hs_code:
        missing.append("Code SH/CN du produit.")
    if not product.description:
        missing.append("Description commerciale du produit.")
    if shipment.quantity is None or shipment.quantity <= 0 or not shipment.unit:
        missing.append("Quantité et unité du produit.")
    if not case.origins:
        missing.append("Au moins une origine de production.")
    elif shipment.harvest_date is None and any(
        not origin.production_period_start or not origin.production_period_end for origin in case.origins
    ):
        missing.append("Date de production ou période complète pour chaque origine.")

    plot_ids = [origin.plot_id for origin in case.origins if origin.plot_id]
    plot_map: dict[uuid.UUID, dict[str, Any]] = {}
    if plot_ids:
        plot_rows = await db.execute(
            select(Plot.id, Plot.name, Plot.internal_ref, Plot.status, Plot.area_ha, Plot.geometry_type)
            .where(Plot.organization_id == case.organization_id, Plot.shipment_id == shipment.id, Plot.id.in_(plot_ids))
        )
        for plot_id, name, internal_ref, status, area_ha, geometry_type in plot_rows.all():
            plot_map[plot_id] = {
                "plot_id": str(plot_id), "reference": name or internal_ref,
                "status": status.value if hasattr(status, "value") else str(status),
                "area_ha": area_ha, "geometry_type": geometry_type,
            }
    origins_snapshot: list[dict[str, Any]] = []
    for origin in case.origins:
        plot = plot_map.get(origin.plot_id) if origin.plot_id else None
        if not origin.origin_confirmed:
            missing.append(f"Origine confirmée: {origin.source_label or str(origin.id)[:8]}.")
        if not origin.country_code or origin.benchmark_level == "unknown":
            missing.append(f"Pays de production vérifié: {origin.source_label or str(origin.id)[:8]}.")
        if plot:
            if plot["status"] not in {"valid", "analyzed"}:
                missing.append(f"Parcelle {plot['reference'] or str(origin.plot_id)[:8]} à valider géospatialement.")
        elif not (origin.location_description or "").strip():
            missing.append(f"Localisation (parcelle ou établissement) de {origin.source_label or str(origin.id)[:8]}.")
        origins_snapshot.append({
            "origin_id": str(origin.id), "country_code": origin.country_code,
            "subdivision": origin.subdivision,
            "production_period_start": origin.production_period_start.isoformat() if origin.production_period_start else None,
            "production_period_end": origin.production_period_end.isoformat() if origin.production_period_end else None,
            "quantity": float(origin.quantity) if origin.quantity is not None else None,
            "unit": origin.unit,
            "origin_confirmed": origin.origin_confirmed,
            "benchmark_level": origin.benchmark_level,
            "benchmark_version": origin.benchmark_version,
            "plot_reference": plot,
            "plot_geometry_included": False,
            "location_description": origin.location_description if origin.location_description else None,
        })
    evidence_refs = []
    for evidence in case.evidence_items:
        if evidence.evidence_type in {"deforestation_free", "legality"} and evidence.review_status != "reviewed":
            continue
        evidence_refs.append({
            "evidence_id": str(evidence.id), "type": evidence.evidence_type,
            "title": evidence.title, "review_status": evidence.review_status,
            "document_version_id": str(evidence.document_version_id) if evidence.document_version_id else None,
            "source_reference": evidence.source_reference,
        })
    if not any(item.evidence_type == "deforestation_free" and item.review_status == "reviewed" for item in case.evidence_items):
        missing.append("Au moins une source de déforestation libre revue.")
    if not any(item.evidence_type == "legality" and item.review_status == "reviewed" for item in case.evidence_items):
        missing.append("Au moins une source de légalité revue.")
    if case.assessment_route == "full" and any(f.assessment_status in {"not_assessed", "inconclusive"} for f in case.findings):
        missing.append("Revue des facteurs de risque à compléter ou à résoudre.")
    if case.assessment_route == "article13_simplified":
        if not case.article13_complexity_assessed or not case.article13_mixing_assessed or len((case.article13_assessment_note or "").strip()) < 20:
            missing.append("Appréciation documentée de la complexité et du mélange/contournement (article 13).")
        if not case.origins or any(origin.benchmark_level != "low" or not origin.origin_confirmed for origin in case.origins):
            missing.append("Origines confirmées à faible risque pour la route simplifiée.")
    return list(dict.fromkeys(missing)), origins_snapshot, evidence_refs


@router.post("/risk-cases/{case_id}/declaration-preparations", response_model=RiskCaseOut, status_code=201, summary="Créer une préparation interne de déclaration, sans soumission")
async def create_declaration_preparation(
    case_id: uuid.UUID,
    payload: DeclarationPreparationCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> RiskCaseOut:
    organization_id = _organization_id(current_user, _DATA_WRITE_ROLES)
    row = await _get_case_bundle(db, organization_id, case_id)
    case, shipment, product, supplier = row
    organization = (await db.execute(select(Organization).where(Organization.id == organization_id))).scalar_one_or_none()
    if organization is None:
        raise HTTPException(status_code=404, detail="Organisation introuvable.")
    missing, origins_snapshot, evidence_refs = await _preparation_missing_fields(db, case, shipment, product, organization)
    matching = product_scope_candidates(product.commodity, product.hs_code)
    sequence = len(case.declaration_preparations) + 1
    prepared = not missing
    snapshot = {
        "schema": "GeoForest internal prefill v1",
        "official_schema": False,
        "submitted_to_eudr_information_system": False,
        "status_label": "Préparé pour déclaration" if prepared else "Préparation incomplète",
        "declaration_reference": None,
        "case_reference": case.case_reference,
        "regulatory_reference_version": case.regulatory_reference_version,
        "source_versions": {
            "country_benchmark": COUNTRY_BENCHMARK_VERSION,
            "product_scope": PRODUCT_SCOPE_VERSION,
        },
        "operator": {
            "name": organization.legal_name or organization.name,
            "address": organization.address,
            "eori": organization.eori,
        },
        "product": {
            "name": product.name,
            "commodity": product.commodity,
            "code_system": "SH/CN saisi par l'organisation; profondeur et nomenclature à confirmer",
            "code": product.hs_code,
            "commercial_description": product.description,
            "quantity": float(shipment.quantity) if shipment.quantity is not None else None,
            "unit": shipment.unit,
            "harvest_date": shipment.harvest_date.isoformat() if shipment.harvest_date else None,
            "annex_i_candidate_references": matching,
            "manual_scope_confirmation": case.product_scope_status,
            "manual_scope_note": case.product_scope_note,
        },
        "supply_chain": {
            "shipment_reference": shipment.reference,
            "supplier_name": supplier.name,
            "supplier_country": supplier.country,
            "production_origins": origins_snapshot,
        },
        "due_diligence": {
            "economic_role": case.economic_role,
            "company_size": case.company_size,
            "assessment_route": case.assessment_route,
            "decision_outcome": case.decision_outcome,
            "decision_rationale": case.decision_rationale,
            "decision_at": case.decision_at.isoformat() if case.decision_at else None,
            "decision_is_current": case.decision_state == "current",
            "evidence_references": evidence_refs,
            "findings": [
                {"criterion": finding.criterion, "status": finding.assessment_status, "rationale": finding.rationale}
                for finding in case.findings
            ],
            "mitigation_actions": [
                {"title": action.title, "status": action.status, "effectiveness_assessed": action.effectiveness_assessed}
                for action in case.mitigation_actions
            ],
        },
        "manual_completion_required": missing,
        "notice": "Préparation et saisie assistées uniquement. Ce JSON n'est pas un format officiel EUDR, ne vaut pas déclaration soumise et ne certifie pas la conformité juridique. Vérifier le formulaire/documentation officiels en vigueur avant toute soumission.",
    }
    preparation = DeclarationPreparation(
        id=uuid.uuid4(), organization_id=organization_id, case_id=case.id,
        sequence_number=sequence,
        status="prepared_for_declaration" if prepared else "incomplete",
        internal_format_version="GeoForest internal prefill v1",
        snapshot=_json_safe(snapshot), missing_fields=missing,
        created_by_user_id=current_user.id,
    )
    case.declaration_preparations.append(preparation)
    previous_case = model_snapshot(case)
    case.status = "prepared_for_declaration" if prepared else ("preparation_incomplete" if case.decision_state == "current" else "in_assessment")
    case.updated_by_user_id = current_user.id
    await db.flush()
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="declaration_preparation.created", object_type="declaration_preparation", object_id=preparation.id,
        new_data={
            "case_id": str(case.id), "sequence_number": sequence, "status": preparation.status,
            "internal_format_version": preparation.internal_format_version,
            "missing_fields": missing,
            "snapshot_sha256": hashlib.sha256(json.dumps(preparation.snapshot, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest(),
            "official_schema": False, "submitted": False,
        },
    )
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="risk_case.preparation_status_changed", object_type="risk_case", object_id=case.id,
        previous_data=previous_case, new_data=model_snapshot(case),
    )
    updated = await _get_case_bundle(db, organization_id, case.id)
    return await _serialize_bundle(db, updated, current_user)


@router.get("/risk-cases/{case_id}/declaration-preparations/{preparation_id}/export", summary="Télécharger le préremplissage interne avec géodonnées référencées")
async def export_declaration_preparation(
    case_id: uuid.UUID,
    preparation_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Response:
    organization_id = _organization_id(current_user, _DECISION_ROLES)
    row = await _get_case_bundle(db, organization_id, case_id)
    case, shipment, product, supplier = row
    preparation = next((item for item in case.declaration_preparations if item.id == preparation_id), None)
    if preparation is None:
        raise HTTPException(status_code=404, detail="Préparation introuvable dans ce dossier.")
    if preparation.status == "stale":
        raise HTTPException(status_code=409, detail="Cette préparation est obsolète; régénérez-la avant tout export de géodonnées.")
    snapshot = json.loads(json.dumps(preparation.snapshot))
    origins = snapshot.get("supply_chain", {}).get("production_origins", [])
    plot_ids = [
        uuid.UUID(plot_reference["plot_id"])
        for item in origins
        if isinstance((plot_reference := item.get("plot_reference")), dict) and plot_reference.get("plot_id")
    ]
    plot_rows = await db.execute(
        select(Plot.id, Plot.name, Plot.internal_ref, Plot.geometry, Plot.geometry_type)
        .where(Plot.organization_id == organization_id, Plot.shipment_id == shipment.id, Plot.id.in_(plot_ids))
    ) if plot_ids else None
    plot_map = {}
    if plot_rows:
        for plot_id, name, internal_ref, geometry, geometry_type in plot_rows.all():
            plot_map[str(plot_id)] = {
                "plot_reference": name or internal_ref,
                "geometry_type": geometry_type,
                "geojson": geometry,
            }
    for item in origins:
        plot_reference = item.get("plot_reference")
        plot_id = plot_reference.get("plot_id") if isinstance(plot_reference, dict) else None
        if plot_id:
            if plot_id not in plot_map:
                raise HTTPException(status_code=409, detail="Une parcelle référencée a été supprimée ou déplacée; régénérez la préparation.")
            item["geolocation"] = plot_map[plot_id]
        else:
            item["geolocation"] = {"location_description": item.get("location_description")}
    snapshot["export_notice"] = "Export interne uniquement; géodonnées sensibles incluses; aucun envoi ou statut officiel EUDR n'est associé à ce téléchargement."
    body = json.dumps(snapshot, ensure_ascii=False, indent=2, default=str).encode("utf-8")
    filename = quote(f"preparation-interne-{case.case_reference}-{preparation.sequence_number}.json")
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=current_user.id,
        action="declaration_preparation.exported", object_type="declaration_preparation",
        object_id=preparation.id,
        new_data={
            "case_id": str(case.id), "sequence_number": preparation.sequence_number,
            "origin_count": len(origins), "plot_count": len(plot_map),
            "sha256": hashlib.sha256(body).hexdigest(),
            "sensitive_geodata_included": any(item.get("location_description") or item.get("geolocation", {}).get("geojson") for item in origins),
        },
    )
    return Response(
        content=body,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}", "Cache-Control": "no-store"},
    )
