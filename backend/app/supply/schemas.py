from datetime import date
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

import pycountry
from app.schemas import StrictModel
from pydantic import AfterValidator, Field, field_validator, model_validator

WRITERS = {"Admin", "Compliance Manager", "Procurement"}
READERS = WRITERS | {"Analyst", "Viewer", "Supplier"}
Commodity = Literal["coffee", "cocoa", "wood", "rubber", "soya", "palm_oil", "cattle"]
Unit = Literal["KG", "T", "M3", "PCS"]
LegalType = Literal["unknown", "company", "cooperative", "individual"]


def country(value):
    value = value.upper()
    if not pycountry.countries.get(alpha_2=value):
        raise ValueError("Code pays ISO 3166-1 alpha-2 attendu")
    return value


Country = Annotated[str, AfterValidator(country)]
Email = Annotated[str, Field(max_length=320, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")]
Ref = Annotated[
    str,
    Field(min_length=2, max_length=40, pattern=r"^[A-Za-z0-9][A-Za-z0-9._/-]+$"),
    AfterValidator(str.upper),
]
Quantity = Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=6)]


class SupplierInput(StrictModel):
    reference: Ref
    name: str = Field(min_length=2, max_length=200)
    country: Country | None = None
    address: str = Field(default="", max_length=1000)
    email: Email | Literal[""] = ""
    legal_type: LegalType = "unknown"
    registration_id: str = Field(default="", max_length=100)
    notes: str = Field(default="", max_length=2000)


class SupplierUpdate(SupplierInput):
    version: int = Field(ge=1)


class ContactInput(StrictModel):
    name: str = Field(min_length=2, max_length=200)
    email: Email
    phone: str = Field(default="", max_length=50)
    position: str = Field(default="", max_length=100)


class ContactUpdate(ContactInput):
    version: int = Field(ge=1)


class ProductInput(StrictModel):
    reference: Ref
    name: str = Field(min_length=2, max_length=200)
    hs_code: str = Field(
        default="", pattern=r"^([0-9]{4}|[0-9]{6}|[0-9]{8})?$", max_length=8
    )
    description: str = Field(default="", max_length=2000)
    commodities: list[Commodity] = Field(min_length=1, max_length=7)
    supplier_ids: list[UUID] = Field(default_factory=list, max_length=100)

    @field_validator("commodities", "supplier_ids")
    @classmethod
    def unique(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("Valeurs dupliquées")
        return value


class ProductUpdate(ProductInput):
    version: int = Field(ge=1)


class LotInput(StrictModel):
    reference: Ref
    supplier_id: UUID
    product_id: UUID
    quantity: Quantity
    unit: Unit
    origin_country: Country | None = None
    production_start: date | None = None
    production_end: date | None = None
    source_collection_id: UUID | None = None
    notes: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def dates(self):
        if (
            self.production_start
            and self.production_end
            and self.production_start > self.production_end
        ):
            raise ValueError("La fin de production précède le début")
        if any(
            d and d > date.today() for d in [self.production_start, self.production_end]
        ):
            raise ValueError("La production déclarée ne peut pas être future")
        return self


class LotUpdate(LotInput):
    version: int = Field(ge=1)


class VersionInput(StrictModel):
    version: int = Field(ge=1)


class CsvInput(StrictModel):
    csv_text: str = Field(min_length=1, max_length=48000)


class InvitationInput(StrictModel):
    expires_in_hours: int = Field(default=72, ge=1, le=168)


class ReviewInput(VersionInput):
    decision: Literal["REVIEWED", "CHANGES_REQUESTED"]
    note: str = Field(min_length=5, max_length=2000)


class CompanyDraft(StrictModel):
    name: str = Field(default="", max_length=200)
    country: Country | None = None
    address: str = Field(default="", max_length=1000)
    email: Email | Literal[""] = ""
    contact_name: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=50)
    legal_type: LegalType = "unknown"


class DeclaredProduct(StrictModel):
    name: str = Field(default="", max_length=200)
    commodity: Commodity | None = None
    quantity: Quantity | None = None
    unit: Unit = "KG"
    origin_country: Country | None = None


class CollectionPayload(StrictModel):
    company: CompanyDraft = Field(default_factory=CompanyDraft)
    products: list[DeclaredProduct] = Field(default_factory=list, max_length=20)


class CollectionSave(VersionInput):
    payload: CollectionPayload


class SubmitInput(VersionInput):
    confirmed: Literal[True]


class ExchangeInput(StrictModel):
    token: str = Field(min_length=60, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")


def completeness(payload):
    data = CollectionPayload.model_validate(payload).model_dump(mode="json")
    required = ["name", "country", "address", "email", "contact_name"]
    missing = [f"company.{key}" for key in required if not data["company"].get(key)]
    products = data["products"]
    denominator = 5 + 5 * max(1, len(products))
    if not products:
        missing += [
            "products.name",
            "products.commodity",
            "products.quantity",
            "products.unit",
            "products.origin_country",
        ]
    for idx, product in enumerate(products):
        for key in ["name", "commodity", "quantity", "unit", "origin_country"]:
            if not product.get(key):
                missing.append(f"products.{idx}.{key}")
    return {
        "percent": round(100 * (denominator - len(missing)) / denominator),
        "missing": missing,
        "scope": "INITIAL_COLLECTION_ONLY",
    }
