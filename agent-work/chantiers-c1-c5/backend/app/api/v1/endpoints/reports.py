"""Rapports opérationnels tenant-scopés (C12).

Les exports sont des aides de pilotage internes : ils ne constituent ni une
certification, ni une déclaration EUDR. Les géométries, coordonnées, notes libres,
contacts et clés de stockage ne sont jamais inclus dans les CSV.
"""
from __future__ import annotations

import csv
import io
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_active_user, get_tenant_org_id
from app.models import (
    DeclarationPreparation,
    Document,
    Plot,
    Product,
    RiskCase,
    Shipment,
    Supplier,
    User,
    UserRole,
)

router = APIRouter()


class ReportDataset(str, Enum):
    suppliers = "suppliers"
    products = "products"
    shipments = "shipments"
    plots = "plots"
    documents = "documents"
    ddr = "ddr"


_DATASET_LABELS = {
    ReportDataset.suppliers: "fournisseurs",
    ReportDataset.products: "produits",
    ReportDataset.shipments: "lots",
    ReportDataset.plots: "parcelles",
    ReportDataset.documents: "documents",
    ReportDataset.ddr: "ddr",
}

_PLOT_EXPORT_ROLES = {
    UserRole.admin,
    UserRole.compliance,
    UserRole.procurement,
    UserRole.analyst,
}


def _enum_value(value: Any) -> str:
    return value.value if isinstance(value, Enum) else str(value)


async def _status_counts(db: AsyncSession, model: Any, field: str, organization_id) -> dict[str, int]:
    column = getattr(model, field)
    rows = (
        await db.execute(
            select(column, func.count())
            .where(model.organization_id == organization_id)
            .group_by(column)
            .order_by(column)
        )
    ).all()
    return {_enum_value(status): int(count) for status, count in rows}


@router.get("/reports/overview", summary="Synthèse opérationnelle tenant-scopée")
async def report_overview(
    db: AsyncSession = Depends(get_db),
    organization_id: uuid.UUID = Depends(get_tenant_org_id),
) -> dict[str, Any]:
    datasets: list[dict[str, Any]] = []
    for key, label, model, status_field in (
        ("suppliers", "Fournisseurs", Supplier, "status"),
        ("products", "Produits", Product, "status"),
        ("shipments", "Lots", Shipment, "status"),
        ("plots", "Parcelles", Plot, "status"),
        ("documents", "Documents", Document, "review_status"),
        ("ddr", "Dossiers DDR", RiskCase, "status"),
    ):
        counts = await _status_counts(db, model, status_field, organization_id)
        datasets.append(
            {
                "key": key,
                "label": label,
                "total": sum(counts.values()),
                "status_counts": counts,
            }
        )

    archived_documents = int(
        (
            await db.execute(
                select(func.count())
                .select_from(Document)
                .where(
                    Document.organization_id == organization_id,
                    Document.is_archived.is_(True),
                )
            )
        ).scalar_one()
        or 0
    )
    for item in datasets:
        if item["key"] == "documents":
            item["archived"] = archived_documents
            break

    preparation_counts = await _status_counts(
        db, DeclarationPreparation, "status", organization_id
    )
    ddr_item = next(item for item in datasets if item["key"] == "ddr")
    ddr_item["preparations_total"] = sum(preparation_counts.values())
    ddr_item["preparation_status_counts"] = preparation_counts

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "datasets": datasets,
        "notice": (
            "Rapport de pilotage interne fondé sur les données enregistrées. Il ne constitue "
            "ni une certification juridique, ni une déclaration EUDR, ni un dépôt officiel. "
            "Les géométries et coordonnées précises ne sont pas exportées."
        ),
    }


def _safe_csv_cell(value: Any) -> Any:
    """Serialize values and neutralize spreadsheet formula injection in text cells."""
    if value is None:
        return ""
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, bool):
        return "oui" if value else "non"
    if isinstance(value, (int, float)):
        return value
    text = str(value)
    if text.lstrip(" \t\r\n").startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


def _render_csv(headers: tuple[str, ...], rows: list[tuple[Any, ...]]) -> str:
    buffer = io.StringIO(newline="")
    buffer.write("\ufeff")  # BOM UTF-8 pour Excel et logiciels bureautiques courants.
    writer = csv.writer(buffer, delimiter=";", quotechar='"', lineterminator="\r\n")
    writer.writerow(headers)
    for row in rows:
        writer.writerow([_safe_csv_cell(value) for value in row])
    return buffer.getvalue()


async def _supplier_rows(db: AsyncSession, organization_id) -> tuple[tuple[str, ...], list[tuple[Any, ...]]]:
    suppliers = (
        await db.execute(
            select(Supplier)
            .where(Supplier.organization_id == organization_id)
            .order_by(Supplier.name, Supplier.id)
        )
    ).scalars().all()
    return (
        ("id", "nom", "nom_legal", "type", "statut", "pays", "region", "niveau_risque", "cree_le"),
        [
            (s.id, s.name, s.legal_name, s.supplier_type, s.status, s.country, s.region, s.risk_rating, s.created_at)
            for s in suppliers
        ],
    )


async def _product_rows(db: AsyncSession, organization_id) -> tuple[tuple[str, ...], list[tuple[Any, ...]]]:
    products = (
        await db.execute(
            select(Product)
            .where(Product.organization_id == organization_id)
            .order_by(Product.name, Product.id)
        )
    ).scalars().all()
    return (
        ("id", "nom", "commodite", "code_sh", "statut", "cree_le"),
        [(p.id, p.name, p.commodity, p.hs_code, p.status, p.created_at) for p in products],
    )


async def _shipment_rows(db: AsyncSession, organization_id) -> tuple[tuple[str, ...], list[tuple[Any, ...]]]:
    rows = (
        await db.execute(
            select(Shipment, Supplier.name, Product.name)
            .outerjoin(
                Supplier,
                and_(
                    Supplier.id == Shipment.supplier_id,
                    Supplier.organization_id == organization_id,
                ),
            )
            .outerjoin(
                Product,
                and_(
                    Product.id == Shipment.product_id,
                    Product.organization_id == organization_id,
                ),
            )
            .where(Shipment.organization_id == organization_id)
            .order_by(Shipment.reference, Shipment.id)
        )
    ).all()
    return (
        (
            "id", "reference", "fournisseur", "produit", "quantite", "unite",
            "pays_production", "date_recolte", "date_reception", "statut", "cree_le",
        ),
        [
            (
                shipment.id,
                shipment.reference,
                supplier_name,
                product_name,
                shipment.quantity,
                shipment.unit,
                shipment.country_of_production,
                shipment.harvest_date,
                shipment.received_date,
                shipment.status,
                shipment.created_at,
            )
            for shipment, supplier_name, product_name in rows
        ],
    )


async def _plot_rows(db: AsyncSession, organization_id) -> tuple[tuple[str, ...], list[tuple[Any, ...]]]:
    rows = (
        await db.execute(
            select(Plot, Shipment.reference)
            .outerjoin(
                Shipment,
                and_(
                    Shipment.id == Plot.shipment_id,
                    Shipment.organization_id == organization_id,
                ),
            )
            .where(Plot.organization_id == organization_id)
            .order_by(Shipment.reference, Plot.internal_ref, Plot.id)
        )
    ).all()
    return (
        (
            "id", "reference_lot", "reference_interne", "nom", "type_geometrie",
            "surface_ha", "surface_declaree_ha", "statut", "precision_ok", "cree_le",
        ),
        [
            (
                plot.id,
                shipment_reference,
                plot.internal_ref,
                plot.name,
                plot.geometry_type,
                plot.area_ha,
                plot.declared_area_ha,
                plot.status,
                plot.precision_ok,
                plot.created_at,
            )
            for plot, shipment_reference in rows
        ],
    )


async def _document_rows(db: AsyncSession, organization_id) -> tuple[tuple[str, ...], list[tuple[Any, ...]]]:
    documents = (
        await db.execute(
            select(Document)
            .where(Document.organization_id == organization_id)
            .order_by(Document.title, Document.id)
        )
    ).scalars().all()
    return (
        (
            "id", "titre", "categorie", "statut_revue", "date_emission",
            "date_expiration", "archive", "version_courante", "cree_le",
        ),
        [
            (
                document.id,
                document.title,
                document.category,
                document.review_status,
                document.issued_at,
                document.expires_at,
                document.is_archived,
                document.current_version_number,
                document.created_at,
            )
            for document in documents
        ],
    )


async def _ddr_rows(db: AsyncSession, organization_id) -> tuple[tuple[str, ...], list[tuple[Any, ...]]]:
    preparation_rows = (
        await db.execute(
            select(DeclarationPreparation.case_id, DeclarationPreparation.status)
            .join(
                RiskCase,
                and_(
                    RiskCase.id == DeclarationPreparation.case_id,
                    RiskCase.organization_id == organization_id,
                ),
            )
            .where(DeclarationPreparation.organization_id == organization_id)
            .order_by(
                DeclarationPreparation.case_id,
                DeclarationPreparation.created_at.desc(),
                DeclarationPreparation.id.desc(),
            )
        )
    ).all()
    latest_preparation_status: dict[Any, str] = {}
    for case_id, status in preparation_rows:
        latest_preparation_status.setdefault(case_id, status)

    cases = (
        await db.execute(
            select(RiskCase, Shipment.reference)
            .outerjoin(
                Shipment,
                and_(
                    Shipment.id == RiskCase.shipment_id,
                    Shipment.organization_id == organization_id,
                ),
            )
            .where(RiskCase.organization_id == organization_id)
            .order_by(RiskCase.case_reference, RiskCase.id)
        )
    ).all()
    return (
        (
            "id", "reference_dossier", "reference_lot", "statut_dossier", "etat_decision",
            "issue_decision_humaine", "statut_derniere_preparation", "mis_a_jour_le",
        ),
        [
            (
                case.id,
                case.case_reference,
                shipment_reference,
                case.status,
                case.decision_state,
                case.decision_outcome,
                latest_preparation_status.get(case.id),
                case.updated_at,
            )
            for case, shipment_reference in cases
        ],
    )


@router.get("/reports/export/{dataset}", summary="Exporter un rapport CSV opérationnel")
async def export_report_csv(
    dataset: ReportDataset,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user),
    organization_id=Depends(get_tenant_org_id),
) -> StreamingResponse:
    if dataset == ReportDataset.plots and user.role not in _PLOT_EXPORT_ROLES:
        raise HTTPException(status_code=403, detail="L'export des références de parcelles est réservé aux rôles autorisés aux géodonnées.")

    exporters = {
        ReportDataset.suppliers: _supplier_rows,
        ReportDataset.products: _product_rows,
        ReportDataset.shipments: _shipment_rows,
        ReportDataset.plots: _plot_rows,
        ReportDataset.documents: _document_rows,
        ReportDataset.ddr: _ddr_rows,
    }
    headers, rows = await exporters[dataset](db, organization_id)
    content = _render_csv(headers, rows)
    local_date = datetime.now(ZoneInfo("Europe/Paris")).date().isoformat()
    filename = f"rapport-{_DATASET_LABELS[dataset]}-{local_date}.csv"
    return StreamingResponse(
        iter([content]),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
