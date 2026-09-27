"""Règles de liaison métier, statuts de checklist et sérialisation C7."""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Document, DocumentChecklistItem, DocumentLink, Plot, Product, Shipment, Supplier
from app.schemas.documents import DocumentOut, DocumentVersionOut, DocumentLinkOut

TARGET_TYPES = {"supplier", "shipment", "product", "plot"}


async def validate_document_targets(
    db: AsyncSession,
    organization_id: uuid.UUID,
    *,
    supplier_id: uuid.UUID | None = None,
    shipment_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    plot_id: uuid.UUID | None = None,
) -> list[tuple[str, uuid.UUID]]:
    """Vérifie l'appartenance tenant de chaque cible avant de créer les liens."""
    targets: list[tuple[str, uuid.UUID]] = []
    supplier = None
    shipment = None
    product = None
    plot = None
    if supplier_id:
        supplier = (await db.execute(select(Supplier).where(
            Supplier.id == supplier_id, Supplier.organization_id == organization_id
        ))).scalar_one_or_none()
        if supplier is None:
            raise HTTPException(status_code=404, detail="Fournisseur introuvable.")
        targets.append(("supplier", supplier_id))
    if shipment_id:
        shipment = (await db.execute(select(Shipment).where(
            Shipment.id == shipment_id, Shipment.organization_id == organization_id
        ))).scalar_one_or_none()
        if shipment is None:
            raise HTTPException(status_code=404, detail="Lot introuvable.")
        targets.append(("shipment", shipment_id))
    if product_id:
        product = (await db.execute(select(Product).where(
            Product.id == product_id, Product.organization_id == organization_id
        ))).scalar_one_or_none()
        if product is None:
            raise HTTPException(status_code=404, detail="Produit introuvable.")
        targets.append(("product", product_id))
    if plot_id:
        plot = (await db.execute(select(Plot).where(
            Plot.id == plot_id, Plot.organization_id == organization_id
        ))).scalar_one_or_none()
        if plot is None:
            raise HTTPException(status_code=404, detail="Parcelle introuvable.")
        targets.append(("plot", plot_id))
        if plot.shipment_id and shipment is None:
            shipment = (await db.execute(select(Shipment).where(
                Shipment.id == plot.shipment_id, Shipment.organization_id == organization_id
            ))).scalar_one_or_none()
            if shipment is None:
                raise HTTPException(status_code=422, detail="La parcelle référence un lot hors du tenant.")

    if supplier is not None and shipment is not None and shipment.supplier_id != supplier.id:
        raise HTTPException(status_code=422, detail="Le fournisseur ne correspond pas au lot choisi.")
    if product is not None and shipment is not None and shipment.product_id != product.id:
        raise HTTPException(status_code=422, detail="Le produit ne correspond pas au lot choisi.")
    if plot is not None and shipment is not None and plot.shipment_id != shipment.id:
        raise HTTPException(status_code=422, detail="La parcelle ne correspond pas au lot choisi.")
    if plot is not None and supplier is not None and shipment is not None and shipment.supplier_id != supplier.id:
        raise HTTPException(status_code=422, detail="Le fournisseur ne correspond pas à la parcelle choisie.")
    return targets


async def validate_checklist_scope(
    db: AsyncSession,
    organization_id: uuid.UUID,
    scope_type: str,
    scope_id: uuid.UUID | None,
) -> None:
    if scope_type == "organization":
        if scope_id is not None:
            raise HTTPException(status_code=422, detail="Une checklist d'organisation ne prend pas d'identifiant de cible.")
        return
    if scope_id is None or scope_type not in TARGET_TYPES:
        raise HTTPException(status_code=422, detail="La cible de checklist est invalide.")
    if scope_type == "plot":
        await validate_document_targets(db, organization_id, plot_id=scope_id)
        return
    model = {"supplier": Supplier, "shipment": Shipment, "product": Product}[scope_type]
    obj = (await db.execute(select(model.id).where(
        model.id == scope_id, model.organization_id == organization_id
    ))).scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Cible de checklist introuvable.")


def serialize_document(document: Document) -> DocumentOut:
    versions = sorted(document.versions or [], key=lambda v: v.version_number)
    latest = next((v for v in versions if v.version_number == document.current_version_number), None)
    latest_out = DocumentVersionOut.model_validate(latest) if latest else None
    links = [
        DocumentLinkOut(target_type=link.target_type, target_id=link.target_id)
        for link in (document.links or [])
    ]
    return DocumentOut(
        id=document.id,
        title=document.title,
        category=document.category,
        description=document.description,
        issuer_name=document.issuer_name,
        reference_number=document.reference_number,
        issued_at=document.issued_at,
        expires_at=document.expires_at,
        country_code=document.country_code,
        commodity_code=document.commodity_code,
        review_status=document.review_status,
        review_note=document.review_note,
        supplier_visible=document.supplier_visible,
        is_archived=document.is_archived,
        current_version_number=document.current_version_number,
        latest_version=latest_out,
        versions_count=len(versions),
        links=links,
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


async def checklist_out(db: AsyncSession, item: DocumentChecklistItem) -> dict[str, Any]:
    stmt = select(Document).where(
        Document.organization_id == item.organization_id,
        Document.category == item.category,
        Document.is_archived.is_(False),
    ).options(selectinload(Document.versions))
    if item.country_code:
        stmt = stmt.where(Document.country_code == item.country_code)
    if item.commodity_code:
        stmt = stmt.where(Document.commodity_code == item.commodity_code)
    if item.scope_type != "organization" and item.scope_id is not None:
        stmt = stmt.join(DocumentLink, DocumentLink.document_id == Document.id).where(
            DocumentLink.organization_id == item.organization_id,
            DocumentLink.target_type == item.scope_type,
            DocumentLink.target_id == item.scope_id,
        )
    docs = (await db.execute(stmt)).scalars().unique().all()
    current = []
    for doc in docs:
        version = next((v for v in doc.versions if v.version_number == doc.current_version_number), None)
        if version is not None and version.scan_status == "clean":
            current.append(doc)
    today = date.today()
    if not current:
        state = "missing"
    elif all(doc.expires_at is not None and doc.expires_at < today for doc in current):
        state = "expired"
    elif any(doc.expires_at is not None and today <= doc.expires_at <= today + timedelta(days=30) for doc in current):
        state = "expiring_soon"
    else:
        state = "received"
    return {
        "id": item.id,
        "title": item.title,
        "category": item.category,
        "scope_type": item.scope_type,
        "scope_id": item.scope_id,
        "country_code": item.country_code,
        "commodity_code": item.commodity_code,
        "source_title": item.source_title,
        "source_url": item.source_url,
        "note": item.note,
        "state": state,
        "matched_document_ids": [doc.id for doc in current],
        "created_at": item.created_at,
    }
