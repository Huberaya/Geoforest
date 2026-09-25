"""Schémas utilisateur étendus."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserProfileUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=50)
    locale: Optional[str] = Field(default="fr", min_length=2, max_length=5)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=10, max_length=128)
