"""Internal preparation-preview exports. Not TRACES import formats.

This first increment exports curated summaries, not the complete evidence pack.
HTTP authorization, DB snapshot resolution, audit and PDF follow in integration.
"""

import csv
import hashlib
import io
from uuid import UUID

from app.diligence.core import (
    MAX_LOTS,
    LotFact,
    Preparation,
    PreparationError,
    State,
    canonical_bytes,
    fingerprint,
    net_mass_kg,
    readiness,
)
from app.schemas import StrictModel
from pydantic import AwareDatetime, Field, model_validator


class RevisionPreview(StrictModel):
    organization_id: UUID
    dossier_id: UUID
    revision: int = Field(ge=1, strict=True)
    prepared_at: AwareDatetime
    preparation: Preparation
    lots: list[LotFact] = Field(min_length=1, max_length=MAX_LOTS)

    @model_validator(mode="after")
    def unique_lots(self):
        if len({lot.id for lot in self.lots}) != len(self.lots):
            raise ValueError("Duplicated lot")
        return self


def revision_hash(revision: RevisionPreview):
    return fingerprint(revision.model_dump(mode="json"))


def csv_text(value):
    """Neutralize spreadsheet formulas, including whitespace/control prefixes.

    CSV is an index. JSON preserves exact source strings; this output deliberately
    changes potentially active cells and strips control characters for safety.
    """
    raw = str(value) if value is not None else ""
    raw = "".join(c for c in raw if ord(c) >= 32 and ord(c) != 127)
    probe = raw.lstrip()
    while probe.startswith("\ufeff"):
        probe = probe[1:].lstrip()
    if probe.startswith(("=", "+", "-", "@")):
        raw = "'" + raw
    return raw


def preview_export(
    revision: RevisionPreview, *, expected_sha256: str, state: State, now, format: str
):
    if revision_hash(revision) != expected_sha256:
        raise PreparationError("REVISION_INTEGRITY_FAILED")
    if not isinstance(state, State):
        raise PreparationError("INVALID_INTERNAL_STATE")
    checks = readiness(revision.preparation, revision.lots, now=now)
    label = (
        "PRÉPARATION INTERNE — NON SOUMIS PAR GEOFOREST — PAS UN FORMAT D’IMPORT TRACES"
    )
    payload = {
        "format": "geoforest-preparation-preview-1",
        "scope": "CURATED_SUMMARY_NOT_COMPLETE_EVIDENCE_PACK",
        "label": label,
        "official_submission_status": "NOT_SUBMITTED_BY_GEOFOREST",
        "internal_state": state.value,
        "revision_sha256": expected_sha256,
        "exported_at": now.isoformat(),
        "checks_at_export": checks,
        "revision": revision.model_dump(mode="json"),
        "limitations": [
            "Résumé préparatoire seulement : géométries complètes et pièces non incluses dans ce premier format.",
            "Validation interne ≠ signature qualifiée ni déclaration aux autorités.",
            "Un export CSV est un index dont les cellules actives sont neutralisées ; JSON conserve les chaînes originales.",
        ],
    }
    # Apply the same budget before either format; never silently truncate fields.
    raw = canonical_bytes(payload)
    if format == "json":
        content, mime = raw, "application/json"
    elif format == "csv":
        output = io.StringIO(newline="")
        writer = csv.writer(output, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
        writer.writerow(
            [
                "notice",
                "scope",
                "dossier_id",
                "revision",
                "revision_sha256",
                "internal_state",
                "readiness",
                "lot_id",
                "lot_reference",
                "supplier",
                "product",
                "hs_code",
                "quantity",
                "unit",
                "net_mass_kg",
                "country",
                "production_start",
                "production_end",
            ]
        )
        for lot in revision.lots:
            writer.writerow(
                [
                    csv_text(x)
                    for x in [
                        label,
                        "SUMMARY_INDEX_ONLY",
                        revision.dossier_id,
                        revision.revision,
                        expected_sha256,
                        state.value,
                        checks["status"],
                        lot.id,
                        lot.reference,
                        lot.supplier_name,
                        lot.product_name,
                        lot.hs_code,
                        lot.quantity,
                        lot.unit,
                        net_mass_kg(lot),
                        lot.origin_country,
                        lot.production_start,
                        lot.production_end,
                    ]
                ]
            )
        content, mime = output.getvalue().encode("utf-8-sig"), "text/csv; charset=utf-8"
    else:
        raise PreparationError("EXPORT_FORMAT_NOT_IMPLEMENTED")
    from app.diligence.core import MAX_EXPORT_BYTES

    if len(content) > MAX_EXPORT_BYTES:
        raise PreparationError("EXPORT_BUDGET")
    return {
        "content": content,
        "media_type": mime,
        "filename": f"preparation-{revision.dossier_id}-r{revision.revision}.{format}",
        "content_sha256": hashlib.sha256(content).hexdigest(),
    }
