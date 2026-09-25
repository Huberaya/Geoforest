"""Modèles Product & Shipment — GeoForest Trace (Chantier 3).

- Product : une commodité EUDR (Annexe I du Règl. 2023/1115) référencée par un opérateur.
- Shipment (lot) : un lot physique liant un fournisseur à un produit, avec quantité et dates.
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import (
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import UUIDType, Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ProductStatus(str, enum.Enum):
    active = "active"
    archived = "archived"


class ShipmentStatus(str, enum.Enum):
    draft = "draft"
    awaiting_data = "awaiting_data"    # en attente de parcelles/documents
    analyzed = "analyzed"              # analyse déforestation/légalité faite
    ready = "ready"                    # DDR prêt / déclaré
    rejected = "rejected"              # non-conforme


# Commodités EUDR Annexe I — liste canonique utilisée dans les sélecteurs.
# Source : Règlement (UE) 2023/1115, Annexe I (liste non figée dans la loi ; codes SH indicatifs à 4 chiffres).
# Nous utilisons des codes SH à 4 chiffres comme première classification ; l'affinage à 6/8 chiffres
# se fera au chantier 7 (DDR) selon le guide officiel de la Commission.
EUDR_COMMODITIES: list[dict[str, str]] = [
    {"code": "cattle",    "hs": "0102", "label": "Bovins vivants",                    "category": "animal"},
    {"code": "cocoa",     "hs": "1801", "label": "Cacao (fèves et brisures)",         "category": "agricultural"},
    {"code": "coffee",    "hs": "0901", "label": "Café (vert/torréfié)",              "category": "agricultural"},
    {"code": "rubber",    "hs": "4001", "label": "Caoutchouc naturel",                "category": "forest"},
    {"code": "palm_oil",  "hs": "1511", "label": "Huile de palme et ses fractions",   "category": "agricultural"},
    {"code": "soy",       "hs": "1201", "label": "Soja (fèves, même concassées)",     "category": "agricultural"},
    {"code": "wood",      "hs": "4403", "label": "Bois brut",                         "category": "forest"},
    {"code": "wood_chips","hs": "4401", "label": "Bois de chauffage et plaquettes",   "category": "forest"},
    {"code": "charcoal",  "hs": "4402", "label": "Charbon de bois",                   "category": "forest"},
    {"code": "pulp",      "hs": "4701", "label": "Pâtes de bois",                     "category": "forest"},
    {"code": "paper",     "hs": "4801", "label": "Papiers et cartons",                "category": "derived"},
    {"code": "furniture", "hs": "9403", "label": "Meubles en bois",                   "category": "derived"},
    {"code": "cocoa_prep","hs": "1806", "label": "Préparations alimentaires au cacao","category": "derived"},
    {"code": "palm_kernel","hs": "1207","label": "Amandes de palmiste",               "category": "agricultural"},
    {"code": "rubber_products","hs":"4011","label":"Pneumatiques neufs en caoutchouc","category": "derived"},
]


class Product(Base):
    """Un produit / commodité EUDR référencé par un opérateur."""
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", "commodity", name="uq_product_org_name_commodity"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    commodity: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # code interne, ex "cocoa"
    hs_code: Mapped[str | None] = mapped_column(String(15))  # code SH (4–8 chiffres)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[ProductStatus] = mapped_column(
        SAEnum(ProductStatus, name="productstatus"), default=ProductStatus.active, nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Product {self.name} ({self.commodity}) org={self.organization_id}>"


class Shipment(Base):
    """Un lot (shipment) liant un fournisseur à un produit."""
    __tablename__ = "shipments"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=_uuid)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reference: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    supplier_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType, ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    quantity: Mapped[Optional[float]] = mapped_column(Numeric(18, 4))
    unit: Mapped[str | None] = mapped_column(String(20), default="kg")  # kg, t, m3, units, l...

    # Données critiques pour l'EUDR
    country_of_production: Mapped[str | None] = mapped_column(String(2), index=True)
    harvest_date: Mapped[date | None] = mapped_column(Date)  # date de récolte/coupe
    received_date: Mapped[date | None] = mapped_column(Date)  # date de réception par l'opérateur

    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[ShipmentStatus] = mapped_column(
        SAEnum(ShipmentStatus, name="shipmentstatus"), default=ShipmentStatus.draft, nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now(), onupdate=_utcnow
    )

    supplier: Mapped["Supplier"] = relationship("Supplier", foreign_keys=[supplier_id])
    product: Mapped["Product"] = relationship("Product", foreign_keys=[product_id])

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Shipment {self.reference} sup={self.supplier_id} prod={self.product_id}>"
