from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Role = Literal[
    "Admin", "Compliance Manager", "Procurement", "Analyst", "Viewer", "Supplier"
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class OrganizationCreate(StrictModel):
    name: str = Field(min_length=2, max_length=160)


class OrganizationUpdate(OrganizationCreate):
    version: int = Field(ge=1)


class MemberInput(StrictModel):
    email: str = Field(
        min_length=3, max_length=320, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$"
    )
    role: Role
    supplier_id: UUID | None = None

    @model_validator(mode="after")
    def supplier_scope(self):
        if (self.role == "Supplier") != (self.supplier_id is not None):
            raise ValueError("Supplier requires an exclusive supplier scope")
        return self
