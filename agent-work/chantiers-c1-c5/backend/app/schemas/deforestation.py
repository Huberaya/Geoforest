"""Contrats API du dépistage C5 — résultat descriptif, sans verdict EUDR."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


ScreeningStatusValue = Literal[
    "signal_post_2020",
    "no_signal_observed",
    "non_evaluable",
    "source_unavailable",
]


class DeforScreeningCandidate(BaseModel):
    id: uuid.UUID
    shipment_id: uuid.UUID
    shipment_reference: str | None = None
    supplier_name: str | None = None
    product_name: str | None = None
    name: str | None = None
    internal_ref: str | None = None
    geometry_type: str | None = None
    area_ha: float | None = None
    status: str
    can_screen: bool
    screening_reason: str | None = None


class DeforScreeningCandidateList(BaseModel):
    items: list[DeforScreeningCandidate]
    total: int
    limit: int
    offset: int


class AnnualLoss(BaseModel):
    year: int
    area_ha_10pct: float
    area_ha_30pct: float


class DeforestationScreeningOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    screening_id: uuid.UUID
    plot_id: uuid.UUID
    status: ScreeningStatusValue
    review_required: bool
    source: str
    dataset: str
    dataset_version: str
    api_spec_version: str
    algorithm_version: str
    cutoff_date: str
    data_first_year: int
    data_last_year: int
    spatial_resolution_m: int
    canopy_thresholds_pct: list[int]
    plot_area_ha: float | None
    geometry_sha256: str | None
    loss_by_year: list[AnnualLoss]
    pre_cutoff_loss_ha_10pct: float | None
    post_cutoff_loss_ha_10pct: float | None
    pre_cutoff_loss_ha_30pct: float | None
    post_cutoff_loss_ha_30pct: float | None
    post_cutoff_share_pct_10pct: float | None
    first_post_cutoff_year_10pct: int | None
    boundary_year_uncertainty: bool
    caveats: list[str]
    message: str
    error_code: str | None
    analyzed_at: datetime


class DeforestationScreeningHistory(BaseModel):
    items: list[DeforestationScreeningOut]
    total: int
    limit: int
    offset: int
