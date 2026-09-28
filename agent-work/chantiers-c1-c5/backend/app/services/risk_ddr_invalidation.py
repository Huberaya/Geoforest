"""Invalidate prior human decisions/preparation snapshots when linked source data changes."""
from __future__ import annotations

import uuid
from typing import Iterable

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.products import Shipment
from app.models.risk_ddr import DeclarationPreparation, RiskCase, RiskCaseOrigin
from app.models.suppliers import Supplier
from app.models.plots import Plot
from app.models import User
from app.services.audit.service import model_snapshot, record_audit_event
from app.services.eudr_references import COUNTRY_BENCHMARK_VERSION, classify_country


async def invalidate_risk_cases(
    db: AsyncSession,
    request: Request,
    user: User,
    organization_id: uuid.UUID,
    case_ids: Iterable[uuid.UUID],
    *,
    source_type: str,
    source_id: uuid.UUID,
    reason: str,
) -> int:
    ids = list(set(case_ids))
    if not ids:
        return 0
    rows = await db.execute(
        select(RiskCase)
        .where(RiskCase.organization_id == organization_id, RiskCase.id.in_(ids))
        .options(selectinload(RiskCase.declaration_preparations))
    )
    cases = rows.scalars().all()
    for case in cases:
        previous = model_snapshot(case)
        if case.decision_state == "current":
            case.decision_state = "stale"
            case.status = "in_assessment"
        elif case.status == "prepared_for_declaration":
            case.status = "in_assessment"
        case.updated_by_user_id = user.id
        for preparation in case.declaration_preparations:
            if preparation.status == "stale":
                continue
            prep_previous = {"status": preparation.status, "stale_reason": preparation.stale_reason}
            preparation.status = "stale"
            preparation.stale_reason = reason[:2000]
            record_audit_event(
                db, request, organization_id=organization_id, actor_user_id=user.id,
                action="declaration_preparation.staled", object_type="declaration_preparation",
                object_id=preparation.id, previous_data=prep_previous,
                new_data={"status": preparation.status, "stale_reason": preparation.stale_reason,
                          "source_type": source_type, "source_id": str(source_id)},
            )
        record_audit_event(
            db, request, organization_id=organization_id, actor_user_id=user.id,
            action="risk_case.source_data_changed", object_type="risk_case", object_id=case.id,
            previous_data=previous,
            new_data={**model_snapshot(case), "source_type": source_type, "source_id": str(source_id), "invalidation_reason": reason},
        )
    return len(cases)


async def invalidate_cases_for_plot(
    db: AsyncSession, request: Request, user: User, organization_id: uuid.UUID,
    plot_id: uuid.UUID, reason: str,
) -> int:
    rows = await db.execute(
        select(RiskCaseOrigin.case_id).where(
            RiskCaseOrigin.organization_id == organization_id,
            RiskCaseOrigin.plot_id == plot_id,
        )
    )
    return await invalidate_risk_cases(
        db, request, user, organization_id, rows.scalars().all(),
        source_type="plot", source_id=plot_id, reason=reason,
    )


async def invalidate_cases_for_shipment(
    db: AsyncSession, request: Request, user: User, organization_id: uuid.UUID,
    shipment_id: uuid.UUID, reason: str,
) -> int:
    rows = await db.execute(
        select(RiskCase.id).where(
            RiskCase.organization_id == organization_id,
            RiskCase.shipment_id == shipment_id,
        )
    )
    return await invalidate_risk_cases(
        db, request, user, organization_id, rows.scalars().all(),
        source_type="shipment", source_id=shipment_id, reason=reason,
    )


async def invalidate_cases_for_product(
    db: AsyncSession, request: Request, user: User, organization_id: uuid.UUID,
    product_id: uuid.UUID, reason: str,
) -> int:
    rows = await db.execute(
        select(RiskCase.id)
        .join(Shipment, Shipment.id == RiskCase.shipment_id)
        .where(
            RiskCase.organization_id == organization_id,
            Shipment.organization_id == organization_id,
            Shipment.product_id == product_id,
        )
    )
    return await invalidate_risk_cases(
        db, request, user, organization_id, rows.scalars().all(),
        source_type="product", source_id=product_id, reason=reason,
    )


async def invalidate_cases_for_supplier(
    db: AsyncSession, request: Request, user: User, organization_id: uuid.UUID,
    supplier_id: uuid.UUID, reason: str,
) -> int:
    shipment_cases = select(RiskCase.id).join(Shipment, Shipment.id == RiskCase.shipment_id).where(
        RiskCase.organization_id == organization_id,
        Shipment.organization_id == organization_id,
        Shipment.supplier_id == supplier_id,
    )
    origin_cases = select(RiskCaseOrigin.case_id).where(
        RiskCaseOrigin.organization_id == organization_id,
        RiskCaseOrigin.supplier_id == supplier_id,
    )
    case_ids = set((await db.execute(shipment_cases)).scalars().all())
    case_ids.update((await db.execute(origin_cases)).scalars().all())
    return await invalidate_risk_cases(
        db, request, user, organization_id, case_ids,
        source_type="supplier", source_id=supplier_id, reason=reason,
    )


async def attach_new_plot_to_case_if_present(
    db: AsyncSession, request: Request, user: User, organization_id: uuid.UUID, plot: Plot,
) -> None:
    """A plot added after case creation becomes an explicit unconfirmed origin allocation."""
    row = await db.execute(
        select(RiskCase)
        .where(RiskCase.organization_id == organization_id, RiskCase.shipment_id == plot.shipment_id)
        .options(selectinload(RiskCase.origins), selectinload(RiskCase.declaration_preparations))
    )
    case = row.scalar_one_or_none()
    if case is None or any(origin.plot_id == plot.id for origin in case.origins):
        return
    shipment = (await db.execute(select(Shipment).where(
        Shipment.id == plot.shipment_id, Shipment.organization_id == organization_id
    ))).scalar_one_or_none()
    if shipment is None:
        return
    benchmark = classify_country(shipment.country_of_production)
    origin = RiskCaseOrigin(
        id=uuid.uuid4(), organization_id=organization_id, case_id=case.id,
        supplier_id=shipment.supplier_id, plot_id=plot.id,
        source_label=plot.name or plot.internal_ref,
        country_code=(shipment.country_of_production or "").upper() or None,
        quantity=None, unit=shipment.unit, origin_confirmed=False,
        benchmark_level=benchmark["level"], benchmark_version=COUNTRY_BENCHMARK_VERSION,
        created_by_user_id=user.id,
    )
    case.origins.append(origin)
    previous = model_snapshot(case)
    await invalidate_risk_cases(
        db, request, user, organization_id, [case.id],
        source_type="plot", source_id=plot.id,
        reason="Une nouvelle parcelle a été ajoutée au lot après la création du dossier.",
    )
    case.status = "in_assessment"
    case.updated_by_user_id = user.id
    await db.flush()
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=user.id,
        action="risk_case_origin.created_from_plot", object_type="risk_case_origin", object_id=origin.id,
        new_data={
            "case_id": str(case.id), "plot_id": str(plot.id), "supplier_id": str(shipment.supplier_id),
            "country_code": origin.country_code, "benchmark_level": origin.benchmark_level,
            "benchmark_version": origin.benchmark_version, "origin_confirmed": False,
        },
    )
    record_audit_event(
        db, request, organization_id=organization_id, actor_user_id=user.id,
        action="risk_case.plot_origin_added", object_type="risk_case", object_id=case.id,
        previous_data=previous,
        new_data={"status": case.status, "decision_state": case.decision_state, "plot_id": str(plot.id)},
    )
