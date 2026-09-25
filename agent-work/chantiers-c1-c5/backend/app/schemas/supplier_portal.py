"""Schémas du portail à scope fournisseur."""
from __future__ import annotations

import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.suppliers import SupplierRiskRating, SupplierStatus, SupplierType


class SupplierPortalProfileUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    legal_name: Optional[str] = Field(default=None, max_length=250)
    address: Optional[str] = Field(default=None, max_length=2000)
    region: Optional[str] = Field(default=None, max_length=150)
    phone: Optional[str] = Field(default=None, max_length=50)
    contact_name: Optional[str] = Field(default=None, max_length=200)
    contact_phone: Optional[str] = Field(default=None, max_length=50)
    tax_id: Optional[str] = Field(default=None, max_length=100)
    registration_number: Optional[str] = Field(default=None, max_length=100)
    eori: Optional[str] = Field(default=None, max_length=50)


class CompletenessItem(BaseModel):
    key: str
    label: str
    complete: bool


class SupplierPortalProfile(BaseModel):
    supplier_id: uuid.UUID
    name: str
    legal_name: Optional[str]
    supplier_type: SupplierType
    status: SupplierStatus
    country: str
    address: Optional[str]
    region: Optional[str]
    phone: Optional[str]
    contact_name: Optional[str]
    contact_email: Optional[str]
    contact_phone: Optional[str]
    tax_id: Optional[str]
    registration_number: Optional[str]
    eori: Optional[str]
    risk_rating: SupplierRiskRating
    risk_label: str
    completeness_percent: int
    completeness_completed: int
    completeness_total: int
    completeness_items: list[CompletenessItem]


class SupplierMagicLinkRequest(BaseModel):
    email: EmailStr


class SupplierMagicLinkAccept(BaseModel):
    token: str = Field(..., min_length=20, max_length=4096)


class SupplierPortalMessage(BaseModel):
    message: str
