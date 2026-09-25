"""Schémas d'authentification et d'organisation."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional
import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import UserRole

# Valideurs simples
_EORI_PATTERN = re.compile(r"^[A-Z]{2}[A-Z0-9]{1,15}$")


# --------------------------------------------------------------------------- Organisation
class OrganizationBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(..., min_length=2, max_length=200)
    legal_name: Optional[str] = Field(default=None, max_length=250)
    siret: Optional[str] = Field(default=None, max_length=50)
    eori: Optional[str] = Field(default=None, max_length=50)
    address: Optional[str] = Field(default=None, max_length=500)
    country: str = Field(default="FR", min_length=2, max_length=2)
    contact_email: Optional[EmailStr] = None
    plan: str = Field(default="pme")

    @field_validator("country")
    @classmethod
    def _upper_country(cls, v: str) -> str:
        return v.upper().strip()

    @field_validator("eori")
    @classmethod
    def _validate_eori(cls, v: str | None) -> str | None:
        if v is None:
            return None
        n = v.replace(" ", "").upper()
        if not _EORI_PATTERN.match(n):
            raise ValueError(
                "EORI invalide : code pays (2 lettres) + 1 à 15 caractères alphanumériques"
            )
        return n


class OrganizationCreate(OrganizationBase):
    pass


class OrganizationOut(OrganizationBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    is_active: bool
    created_at: datetime


# --------------------------------------------------------------------------- Utilisateur
class UserRegister(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    email: EmailStr
    password: str = Field(..., min_length=10, max_length=128)
    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    # Pour l'inscription initiale : créer son organisation
    organization_name: str = Field(..., min_length=2, max_length=200)
    organization_country: str = Field(default="FR", min_length=2, max_length=2)
    eori: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: EmailStr
    first_name: Optional[str]
    last_name: Optional[str]
    role: UserRole
    locale: str
    organization_id: Optional[uuid.UUID]
    is_active: bool
    last_login_at: Optional[datetime]
    created_at: datetime

    @property
    def full_name(self) -> str:
        parts = [p for p in (self.first_name, self.last_name) if p]
        return " ".join(parts) if parts else self.email


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class RefreshRequest(BaseModel):
    refresh_token: str


class MessageOut(BaseModel):
    message: str


class HealthOut(BaseModel):
    status: str
    version: str
    environment: str
