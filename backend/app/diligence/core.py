"""Pure preparation policy, NOT an authorization layer or an official API adapter.

Inputs are server-resolved facts. An API must never accept these snapshot facts
from a browser as authoritative. Persist immutable revisions and re-authorize
inside each transaction before applying a decision or exporting private data.
"""

import hashlib
import json
import math
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, localcontext
from enum import StrEnum
from uuid import UUID

from app.schemas import StrictModel
from pydantic import AwareDatetime, Field, field_validator

POLICY_VERSION = "diligence-preparation-1"
MAX_EXPORT_BYTES = 2 * 1024 * 1024
MAX_LOTS = 20
HASH = r"^[0-9a-f]{64}$"


class PreparationError(ValueError):
    pass


class State(StrEnum):
    DRAFT = "DRAFT"
    IN_REVIEW = "IN_REVIEW"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"
    INTERNALLY_VALIDATED = "INTERNALLY_VALIDATED"
    INTERNALLY_WITHDRAWN = "INTERNALLY_WITHDRAWN"


class Regime(StrEnum):
    UNQUALIFIED = "UNQUALIFIED"
    ORDINARY_OPERATOR = "ORDINARY_OPERATOR"
    MICRO_SMALL_PRIMARY = "MICRO_SMALL_PRIMARY"
    DOWNSTREAM_OPERATOR = "DOWNSTREAM_OPERATOR"
    TRADER = "TRADER"


class TradeFlow(StrEnum):
    UNQUALIFIED = "UNQUALIFIED"
    DOMESTIC = "DOMESTIC"
    IMPORT = "IMPORT"
    EXPORT = "EXPORT"


class Preparation(StrictModel):
    operator_name: str = Field(default="", max_length=200)
    operator_address: str = Field(default="", max_length=1000)
    eori: str = Field(default="", max_length=32)
    regime: Regime = Regime.UNQUALIFIED
    regime_reference: str = Field(default="", max_length=2000)
    trade_flow: TradeFlow = TradeFlow.UNQUALIFIED
    product_scope_confirmed: bool = Field(default=False, strict=True)
    product_scope_reference: str = Field(default="", max_length=2000)
    supply_chain_complete_confirmed: bool = Field(default=False, strict=True)
    supply_chain_note: str = Field(default="", max_length=4000)


class RiskFact(StrictModel):
    id: UUID
    created_at: AwareDatetime
    input_sha256: str = Field(pattern=HASH)
    proposed_residual: str = Field(max_length=32)
    blocking_factors: int = Field(ge=0, strict=True)
    accepted_proof_count: int = Field(ge=0, strict=True)


class LotFact(StrictModel):
    """Curated summary; integration must resolve the facts under tenant RLS."""

    id: UUID
    reference: str = Field(min_length=1, max_length=200)
    supplier_name: str = Field(default="", max_length=200)
    supplier_address: str = Field(default="", max_length=1000)
    supplier_contact: str = Field(default="", max_length=320)
    supplier_archived: bool = Field(default=False, strict=True)
    product_archived: bool = Field(default=False, strict=True)
    product_name: str = Field(default="", max_length=200)
    product_description: str = Field(default="", max_length=4000)
    hs_code: str = Field(default="", max_length=8)
    commodities: list[str] = Field(default_factory=list, max_length=7)
    scientific_names: list[str] = Field(default_factory=list, max_length=30)
    scientific_names_complete_confirmed: bool = Field(default=False, strict=True)
    quantity: Decimal = Field(
        gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False
    )
    unit: str = Field(pattern=r"^(KG|T|M3|PCS)$")
    declared_net_mass_kg: Decimal | None = Field(
        default=None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False
    )
    additional_unit_reviewed: bool = Field(default=False, strict=True)
    additional_unit_note: str = Field(default="", max_length=2000)
    origin_country: str = Field(default="", max_length=2)
    production_start: date | None = None
    production_end: date | None = None
    plot_revision_count: int = Field(default=0, ge=0, le=100, strict=True)
    geolocation_complete_confirmed: bool = Field(default=False, strict=True)
    geometry_checks_passed: bool = Field(default=False, strict=True)
    current_plot_revisions: bool = Field(default=False, strict=True)
    legal_qualified: bool = Field(default=False, strict=True)
    legal_stale: bool = Field(default=True, strict=True)
    open_task_count: int = Field(default=0, ge=0, strict=True)
    evidence_available: bool = Field(default=False, strict=True)
    context_sha256: str = Field(pattern=HASH)
    risk: RiskFact | None = None

    @field_validator("scientific_names", "commodities")
    @classmethod
    def bounded_names(cls, values):
        values = [v.strip() for v in values]
        if len(set(values)) != len(values) or any(
            not v or len(v) > 200 for v in values
        ):
            raise ValueError("Empty, duplicated or excessive entries")
        return [v.strip() for v in values]


def canonical_bytes(value):
    """Versioned sorted UTF-8 JSON, not a claim of RFC 8785 conformance."""
    count = 0
    budget = 0

    def normalize(v, depth=0):
        nonlocal count, budget
        count += 1
        budget += 8
        if count > 50000 or depth > 32 or budget > MAX_EXPORT_BYTES:
            raise PreparationError("SNAPSHOT_BUDGET")
        if isinstance(v, (UUID, datetime, date, Decimal)):
            if isinstance(v, Decimal) and not v.is_finite():
                raise PreparationError("NON_FINITE_NUMBER")
            v = v.isoformat() if isinstance(v, (datetime, date)) else str(v)
        if isinstance(v, str):
            if len(v) > 256000:
                raise PreparationError("TEXT_BUDGET")
            budget += len(v.encode("utf-8"))
            return v
        if type(v) is int and v.bit_length() > 64:
            raise PreparationError("INTEGER_BUDGET")
        if v is None or type(v) in (bool, int):
            return v
        if type(v) is float:
            if not math.isfinite(v):
                raise PreparationError("NON_FINITE_NUMBER")
            return v
        if type(v) is dict:
            if any(type(k) is not str for k in v):
                raise PreparationError("STRING_KEYS_REQUIRED")
            return {
                normalize(k, depth + 1): normalize(x, depth + 1) for k, x in v.items()
            }
        if type(v) in (list, tuple):
            return [normalize(x, depth + 1) for x in v]
        raise PreparationError("UNSUPPORTED_SNAPSHOT_TYPE")

    result = json.dumps(
        normalize(value),
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(result) > MAX_EXPORT_BYTES:
        raise PreparationError("EXPORT_BUDGET")
    return result


def fingerprint(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def net_mass_kg(lot: LotFact):
    if lot.unit == "KG":
        return lot.quantity
    if lot.unit == "T":
        with localcontext() as ctx:
            ctx.prec = 32
            return lot.quantity * Decimal(1000)
    return lot.declared_net_mass_kg  # Never guess a density or weight per item.


def readiness(preparation: Preparation, lots: list[LotFact], *, now: datetime):
    if now.tzinfo is None or now.utcoffset() is None:
        raise PreparationError("AWARE_CLOCK_REQUIRED")
    if not 1 <= len(lots) <= MAX_LOTS or len({lot.id for lot in lots}) != len(lots):
        raise PreparationError("LOT_SCOPE_INVALID")
    issues = []

    def issue(code, message, lot=None):
        issues.append(
            {"code": code, "message": message, "lot_id": str(lot.id) if lot else None}
        )

    p = preparation
    if p.regime != Regime.ORDINARY_OPERATOR:
        issue(
            "REGIME_UNQUALIFIED",
            "Ce parcours ne qualifie pas ce régime ; ne pas en déduire une obligation de déclaration ordinaire.",
        )
    if len(p.regime_reference.strip()) < 20:
        issue(
            "REGIME_REFERENCE",
            "Justifier le régime et les obligations applicables à l’acteur.",
        )
    if not p.operator_name.strip() or not p.operator_address.strip():
        issue("OPERATOR_IDENTITY", "Nom et adresse de l’opérateur à compléter.")
    if p.trade_flow == TradeFlow.UNQUALIFIED:
        issue("TRADE_FLOW", "Qualifier l’opération commerciale.")
    if p.trade_flow in (TradeFlow.IMPORT, TradeFlow.EXPORT) and not re.fullmatch(
        r"[A-Z]{2}[A-Z0-9]{1,15}", p.eori
    ):
        issue(
            "EORI",
            "EORI à renseigner/vérifier pour l’import/export ; la syntaxe ne vérifie pas son attribution.",
        )
    if not p.product_scope_confirmed or len(p.product_scope_reference.strip()) < 20:
        issue(
            "PRODUCT_SCOPE",
            "Confirmer le champ produit avec une référence réglementaire actualisée.",
        )
    if not p.supply_chain_complete_confirmed or len(p.supply_chain_note.strip()) < 20:
        issue(
            "CHAIN_COMPLETENESS",
            "Confirmer le périmètre complet et documenter la chaîne d’approvisionnement.",
        )
    import pycountry

    known = {"wood", "cattle", "cocoa", "coffee", "rubber", "soya", "palm_oil"}
    for lot in lots:
        if lot.supplier_archived or lot.product_archived:
            issue("ARCHIVED_SOURCE", "Fournisseur ou produit archivé.", lot)
        if (
            not lot.supplier_name
            or not lot.supplier_address
            or not lot.supplier_contact
        ):
            issue(
                "SUPPLIER_INFORMATION",
                "Identité, adresse et contact fournisseur incomplets.",
                lot,
            )
        if (
            not lot.product_name
            or not lot.product_description
            or not re.fullmatch(r"(?:[0-9]{4}|[0-9]{6}|[0-9]{8})", lot.hs_code)
        ):
            issue(
                "PRODUCT_INFORMATION",
                "Description commerciale ou code SH incomplet.",
                lot,
            )
        if not lot.commodities or not set(lot.commodities) <= known:
            issue("COMMODITY", "Matières déclarées absentes ou non admises.", lot)
        if "wood" in lot.commodities and (
            not lot.scientific_names or not lot.scientific_names_complete_confirmed
        ):
            issue(
                "WOOD_SPECIES",
                "Renseigner et confirmer tous les noms scientifiques complets des essences.",
                lot,
            )
        if not pycountry.countries.get(alpha_2=lot.origin_country):
            issue("COUNTRY", "Pays de production ISO à vérifier.", lot)
        if (
            not lot.production_start
            or not lot.production_end
            or lot.production_end < lot.production_start
        ):
            issue(
                "PRODUCTION_PERIOD",
                "Période de production manquante ou incohérente.",
                lot,
            )
        if lot.unit == "PCS" and lot.quantity != lot.quantity.to_integral_value():
            issue("ITEM_COUNT", "Le nombre de pièces doit être entier.", lot)
        if (
            lot.declared_net_mass_kg is not None
            and lot.unit in {"KG", "T"}
            and lot.declared_net_mass_kg != net_mass_kg(lot)
        ):
            issue(
                "MASS_CONFLICT",
                "Masse déclarée incohérente avec la quantité du lot.",
                lot,
            )
        if (
            not lot.additional_unit_reviewed
            or len(lot.additional_unit_note.strip()) < 10
        ):
            issue(
                "QUANTITY_REVIEW",
                "Justifier les unités, estimations/écarts et unités supplémentaires applicables.",
                lot,
            )
        if (
            p.trade_flow in (TradeFlow.IMPORT, TradeFlow.EXPORT)
            and net_mass_kg(lot) is None
        ):
            issue(
                "NET_MASS",
                "Masse nette réelle en kg nécessaire ; aucune conversion implicite de volume ou de pièces.",
                lot,
            )
        if not (
            lot.plot_revision_count
            and lot.geometry_checks_passed
            and lot.geolocation_complete_confirmed
        ):
            issue(
                "GEOLOCATION",
                "Vérifier toutes les parcelles/établissements et leurs géolocalisations.",
                lot,
            )
        if not lot.current_plot_revisions:
            issue(
                "PLOT_REVISION",
                "Revoir les révisions parcellaires liées au dossier.",
                lot,
            )
        if not lot.legal_qualified or lot.legal_stale:
            issue(
                "LEGALITY", "Revue de légalité absente, non qualifiée ou périmée.", lot
            )
        if not lot.evidence_available:
            issue("EVIDENCE", "Preuves acceptées indisponibles ou non vérifiées.", lot)
        if lot.open_task_count:
            issue("OPEN_TASKS", "Actions correctives encore ouvertes.", lot)
        r = lot.risk
        if not r:
            issue("RISK_MISSING", "Évaluation de risque absente.", lot)
        else:
            if (
                r.input_sha256 != lot.context_sha256
                or r.created_at > now
                or now - r.created_at >= timedelta(days=365)
            ):
                issue(
                    "RISK_STALE",
                    "Évaluation de risque périmée, future ou ne correspondant plus au contexte.",
                    lot,
                )
            if (
                r.proposed_residual != "NEGLIGIBLE"
                or r.blocking_factors
                or not r.accepted_proof_count
            ):
                issue(
                    "RISK_UNRESOLVED",
                    "Risque non négligeable/indéterminé, blocages ou preuve absente.",
                    lot,
                )
    return {
        "policy_version": POLICY_VERSION,
        "checked_at": now.isoformat(),
        "status": "BLOCKED" if issues else "READY_FOR_INTERNAL_REVIEW",
        "issues": issues,
        "official_submission_status": "NOT_SUBMITTED_BY_GEOFOREST",
        "limitations": [
            "Contrôles internes, pas certification EUDR.",
            "Les confirmations humaines et les sources saisies ne sont pas authentifiées automatiquement.",
            "Aucun statut de risque des autorités TRACES n’est inféré.",
        ],
    }


def transition(
    state: State,
    action: str,
    *,
    role: str,
    note: str,
    checks: dict,
    snapshot_matches: bool,
    acknowledged: bool = False,
):
    """Policy only: callers MUST lock/check revision, session and role in DB."""
    if type(snapshot_matches) is not bool or type(acknowledged) is not bool:
        raise PreparationError("BOOLEAN_REQUIRED")
    if len(note.strip()) < 10 or len(note) > 4000:
        raise PreparationError("DECISION_NOTE_REQUIRED")
    if action == "SUBMIT_FOR_REVIEW":
        if role not in {"Admin", "Compliance Manager", "Procurement"}:
            raise PreparationError("FORBIDDEN")
        if state != State.DRAFT:
            raise PreparationError("INVALID_TRANSITION")
        if not snapshot_matches:
            raise PreparationError("STALE_SNAPSHOT")
        return State.IN_REVIEW
    if role not in {"Admin", "Compliance Manager"}:
        raise PreparationError("FORBIDDEN")
    if action == "REQUEST_CHANGES" and state == State.IN_REVIEW:
        return State.CHANGES_REQUESTED
    if action == "WITHDRAW_INTERNALLY" and state in {
        State.IN_REVIEW,
        State.INTERNALLY_VALIDATED,
    }:
        return State.INTERNALLY_WITHDRAWN
    if action == "VALIDATE_INTERNALLY" and state == State.IN_REVIEW:
        if not snapshot_matches:
            raise PreparationError("STALE_SNAPSHOT")
        if (
            checks.get("policy_version") != POLICY_VERSION
            or checks.get("status") != "READY_FOR_INTERNAL_REVIEW"
            or checks.get("issues") != []
            or not acknowledged
        ):
            raise PreparationError("VALIDATION_BLOCKED")
        return State.INTERNALLY_VALIDATED
    raise PreparationError("INVALID_TRANSITION")
