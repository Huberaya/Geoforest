"""Schémas Pydantic — Fournisseurs, Produits, Lots (Chantier 3)."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.products import EUDR_COMMODITIES
from app.models.products import ProductStatus, ShipmentStatus
from app.models.suppliers import SupplierRiskRating, SupplierStatus, SupplierType


# --------------------------------------------------------------------------- Commodités

class Commodity(BaseModel):
    code: str
    hs: str
    label: str
    category: str


class CommoditiesList(BaseModel):
    items: list[Commodity]
    note: str = (
        "Liste basée sur l'Annexe I du Règlement (UE) 2023/1115. "
        "L'affinage des codes SH à 6/8 chiffres sera proposé au chantier 7 (DDR)."
    )


# --------------------------------------------------------------------------- Fournisseurs

class SupplierBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(..., min_length=2, max_length=200)
    legal_name: Optional[str] = Field(default=None, max_length=250)
    supplier_type: SupplierType = SupplierType.other
    country: str = Field(..., min_length=2, max_length=2, description="Code ISO 3166-1 alpha-2")
    address: Optional[str] = Field(default=None, max_length=2000)
    region: Optional[str] = Field(default=None, max_length=150)
    email: Optional[EmailStr] = Field(default=None, max_length=250)
    phone: Optional[str] = Field(default=None, max_length=50)
    website: Optional[str] = Field(default=None, max_length=250)
    tax_id: Optional[str] = Field(default=None, max_length=100)
    registration_number: Optional[str] = Field(default=None, max_length=100)
    eori: Optional[str] = Field(default=None, max_length=50)
    contact_name: Optional[str] = Field(default=None, max_length=200)
    contact_email: Optional[EmailStr] = Field(default=None, max_length=250)
    contact_phone: Optional[str] = Field(default=None, max_length=50)
    notes: Optional[str] = Field(default=None, max_length=5000)


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(SupplierBase):
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    country: Optional[str] = Field(default=None, min_length=2, max_length=2)
    supplier_type: Optional[SupplierType] = None
    status: Optional[SupplierStatus] = None


class SupplierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    legal_name: Optional[str] = None
    supplier_type: SupplierType
    status: SupplierStatus
    country: str
    address: Optional[str] = None
    region: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    tax_id: Optional[str] = None
    registration_number: Optional[str] = None
    eori: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    risk_rating: SupplierRiskRating
    notes: Optional[str] = None
    portal_enabled: bool
    created_at: datetime
    updated_at: datetime
    # Agrégats du dashboard (retournés par la liste)
    shipments_count: int = 0


class SupplierList(BaseModel):
    items: list[SupplierOut]
    total: int
    by_status: dict[str, int]
    by_risk: dict[str, int]


class SupplierInviteOut(SupplierOut):
    invitation_id: uuid.UUID
    invitation_expires_at: datetime
    delivery_status: str
    invitation_url: Optional[str] = None


# --------------------------------------------------------------------------- Produits

class ProductBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(..., min_length=2, max_length=200)
    commodity: str = Field(..., min_length=2, max_length=50)
    hs_code: Optional[str] = Field(default=None, max_length=15, pattern=r"^\d{4,15}$")
    description: Optional[str] = Field(default=None, max_length=2000)


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    commodity: Optional[str] = Field(default=None, min_length=2, max_length=50)
    hs_code: Optional[str] = Field(default=None, max_length=15, pattern=r"^\d{4,15}$")
    description: Optional[str] = Field(default=None, max_length=2000)
    status: Optional[ProductStatus] = None


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    commodity: str
    commodity_label: Optional[str] = None
    hs_code: Optional[str] = None
    description: Optional[str] = None
    status: ProductStatus
    shipments_count: int = 0
    created_at: datetime
    updated_at: datetime


class ProductList(BaseModel):
    items: list[ProductOut]
    total: int


# --------------------------------------------------------------------------- Lots (shipments)

class ShipmentBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    reference: str = Field(..., min_length=2, max_length=100)
    supplier_id: uuid.UUID
    product_id: uuid.UUID
    quantity: Optional[float] = Field(default=None, ge=0)
    unit: Optional[str] = Field(default="kg", max_length=20)
    country_of_production: Optional[str] = Field(default=None, min_length=2, max_length=2)
    harvest_date: Optional[date] = None
    received_date: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=5000)


class ShipmentCreate(ShipmentBase):
    pass


class ShipmentUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    reference: Optional[str] = Field(default=None, min_length=2, max_length=100)
    supplier_id: Optional[uuid.UUID] = None
    product_id: Optional[uuid.UUID] = None
    quantity: Optional[float] = Field(default=None, ge=0)
    unit: Optional[str] = Field(default=None, max_length=20)
    country_of_production: Optional[str] = Field(default=None, min_length=2, max_length=2)
    harvest_date: Optional[date] = None
    received_date: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=5000)
    status: Optional[ShipmentStatus] = None


class ShipmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference: str
    supplier_id: uuid.UUID
    product_id: uuid.UUID
    supplier_name: Optional[str] = None
    product_name: Optional[str] = None
    commodity: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    country_of_production: Optional[str] = None
    harvest_date: Optional[date] = None
    received_date: Optional[date] = None
    status: ShipmentStatus
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ShipmentList(BaseModel):
    items: list[ShipmentOut]
    total: int
    by_status: dict[str, int]
