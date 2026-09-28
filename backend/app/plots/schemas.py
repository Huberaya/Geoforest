from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal
from uuid import UUID

from app.schemas import StrictModel
from app.supply.schemas import Commodity, Country, Ref, VersionInput
from pydantic import Field, model_validator


class PlotData(StrictModel):
    reference: Ref
    name: str = Field(min_length=2, max_length=200)
    country: Country
    commodity: Commodity | None = None
    declared_area_ha: Decimal | None = Field(
        default=None, gt=0, le=100000, max_digits=12, decimal_places=6
    )
    geometry: dict
    capture_method: Literal["MANUAL", "DRAW", "GPS", "GEOJSON", "KML"] = "MANUAL"
    source_note: str = Field(default="", max_length=1000)
    gps_accuracy_m: float | None = Field(
        default=None, ge=0, le=100000, allow_inf_nan=False
    )
    captured_at: datetime | None = None

    @model_validator(mode="after")
    def capture(self):
        if self.captured_at and (
            self.captured_at.tzinfo is None
            or self.captured_at > datetime.now(timezone.utc) + timedelta(minutes=5)
        ):
            raise ValueError(
                "Date de relevé avec fuseau, non future (tolérance horloge 5 min), requise"
            )
        if self.capture_method == "GPS" and (
            self.gps_accuracy_m is None or self.captured_at is None
        ):
            raise ValueError(
                "Un relevé GPS doit conserver la date et la précision annoncée par le navigateur"
            )
        if self.capture_method != "GPS" and self.gps_accuracy_m is not None:
            raise ValueError("La précision GPS est réservée à un relevé GPS déclaré")
        return self


class PlotCreate(PlotData):
    supplier_id: UUID
    acknowledge_warnings: bool = False


class PlotUpdate(PlotData):
    version: int = Field(ge=1)
    acknowledge_warnings: bool = False


class CheckInput(StrictModel):
    geometry: dict
    declared_area_ha: Decimal | None = None
    commodity: Commodity | None = None
    exclude_plot_id: UUID | None = None


class ImportInput(StrictModel):
    supplier_id: UUID
    file_format: Literal["geojson", "kml"]
    source_text: str = Field(min_length=1, max_length=1048576)
    reference_prefix: str = Field(
        min_length=2, max_length=25, pattern=r"^[A-Za-z0-9][A-Za-z0-9._/-]+$"
    )
    country: Country
    commodity: Commodity | None = None


class ImportApply(ImportInput):
    confirmed: Literal[True]
    preview_checksum: str = Field(pattern=r"^[a-f0-9]{64}$")


class ProposalSave(StrictModel):
    payload: PlotData


class ProposalUpdate(ProposalSave, VersionInput):
    pass


class ProposalSubmit(VersionInput):
    confirmed: Literal[True]


class ProposalReview(VersionInput):
    decision: Literal["ACCEPTED", "CHANGES_REQUESTED"]
    note: str = Field(min_length=5, max_length=2000)
    adopted_reference: Ref | None = None
    confirmed: bool = False

    @model_validator(mode="after")
    def confirm_adoption(self):
        if self.decision == "ACCEPTED" and not self.confirmed:
            raise ValueError("Confirmez explicitement la revue avant adoption")
        return self


class PlotLink(StrictModel):
    plot_id: UUID
    revision: int = Field(ge=1)


class LotLinks(VersionInput):
    plots: list[PlotLink] = Field(max_length=100)

    @model_validator(mode="after")
    def unique(self):
        if len({p.plot_id for p in self.plots}) != len(self.plots):
            raise ValueError("Parcelle répétée")
        return self
