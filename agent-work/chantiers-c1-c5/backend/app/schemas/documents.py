"""Contrats API du coffre documentaire C7."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


DocumentReviewStatus = Literal["to_review", "reviewed", "follow_up"]
DocumentScopeType = Literal["organization", "supplier", "shipment", "product", "plot"]
ChecklistState = Literal["received", "missing", "expired", "expiring_soon"]


class DocumentVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version_number: int
    original_filename: str
    content_type: str
    file_size_bytes: int
    sha256: str
    scan_status: str
    scanned_at: datetime
    created_at: datetime


class DocumentLinkOut(BaseModel):
    target_type: Literal["supplier", "shipment", "product", "plot"]
    target_id: uuid.UUID
    display_label: str | None = None


class DocumentOut(BaseModel):
    id: uuid.UUID
    title: str
    category: str
    description: str | None = None
    issuer_name: str | None = None
    reference_number: str | None = None
    issued_at: date | None = None
    expires_at: date | None = None
    country_code: str | None = None
    commodity_code: str | None = None
    review_status: DocumentReviewStatus
    review_note: str | None = None
    supplier_visible: bool
    is_archived: bool
    current_version_number: int
    latest_version: DocumentVersionOut | None = None
    versions_count: int
    links: list[DocumentLinkOut]
    created_at: datetime
    updated_at: datetime


class DocumentListOut(BaseModel):
    items: list[DocumentOut]
    total: int
    limit: int
    offset: int


class DocumentPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, min_length=1, max_length=50)
    description: str | None = Field(default=None, max_length=4000)
    issuer_name: str | None = Field(default=None, max_length=200)
    reference_number: str | None = Field(default=None, max_length=120)
    issued_at: date | None = None
    expires_at: date | None = None
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    commodity_code: str | None = Field(default=None, max_length=50)
    supplier_visible: bool | None = None


class DocumentReviewIn(BaseModel):
    review_status: DocumentReviewStatus
    review_note: str | None = Field(default=None, max_length=4000)


class DocumentChecklistCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=50)
    scope_type: DocumentScopeType = "organization"
    scope_id: uuid.UUID | None = None
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    commodity_code: str | None = Field(default=None, max_length=50)
    source_title: str | None = Field(default=None, max_length=200)
    source_url: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=4000)


class DocumentChecklistOut(BaseModel):
    id: uuid.UUID
    title: str
    category: str
    scope_type: DocumentScopeType
    scope_id: uuid.UUID | None = None
    country_code: str | None = None
    commodity_code: str | None = None
    source_title: str | None = None
    source_url: str | None = None
    note: str | None = None
    state: ChecklistState
    matched_document_ids: list[uuid.UUID]
    created_at: datetime


class DocumentDownloadLinkOut(BaseModel):
    url: str
    presigned: bool
    expires_in: int | None = None
