import copy
import csv
import io
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal, localcontext
from uuid import UUID, uuid4

import pytest
from app.diligence.core import (
    LotFact,
    Preparation,
    PreparationError,
    Regime,
    State,
    TradeFlow,
    canonical_bytes,
    fingerprint,
    net_mass_kg,
    readiness,
    transition,
)
from app.diligence.exports import (
    RevisionPreview,
    csv_text,
    preview_export,
    revision_hash,
)
from pydantic import ValidationError

NOW = datetime(2026, 9, 29, 12, tzinfo=timezone.utc)
HASH = "a" * 64


def prep(**updates):
    return Preparation(
        **(
            {
                "operator_name": "Opérateur entièrement fictif",
                "operator_address": "Adresse fictive, Nantes, France",
                "eori": "FRFICTIF123",
                "regime": "ORDINARY_OPERATOR",
                "regime_reference": "Qualification humaine fictive — référence de recette uniquement",
                "trade_flow": "IMPORT",
                "product_scope_confirmed": True,
                "product_scope_reference": "Revue annexe I fictive, aucune vraie qualification",
                "supply_chain_complete_confirmed": True,
                "supply_chain_note": "Périmètre synthétique complet uniquement pour tester les contrôles",
            }
            | updates
        )
    )


def lot(**updates):
    return LotFact(
        **(
            {
                "id": UUID("11111111-1111-4111-8111-111111111111"),
                "reference": "LOT-FICTIF",
                "supplier_name": "Fournisseur fictif",
                "supplier_address": "Adresse de test",
                "supplier_contact": "fiction@example.invalid",
                "product_name": "Cacao fictif",
                "product_description": "Fèves fictives pour recette",
                "hs_code": "1801",
                "commodities": ["cocoa"],
                "quantity": "12.345678",
                "unit": "T",
                "additional_unit_reviewed": True,
                "additional_unit_note": "Unités supplémentaires examinées fictivement",
                "origin_country": "CI",
                "production_start": "2025-01-01",
                "production_end": "2025-12-31",
                "plot_revision_count": 1,
                "geolocation_complete_confirmed": True,
                "geometry_checks_passed": True,
                "current_plot_revisions": True,
                "legal_qualified": True,
                "legal_stale": False,
                "evidence_available": True,
                "context_sha256": HASH,
                "risk": {
                    "id": UUID("22222222-2222-4222-8222-222222222222"),
                    "created_at": NOW - timedelta(days=1),
                    "input_sha256": HASH,
                    "proposed_residual": "NEGLIGIBLE",
                    "blocking_factors": 0,
                    "accepted_proof_count": 1,
                },
            }
            | updates
        )
    )


def codes(p=None, lot_data=None):
    return {
        x["code"]
        for x in readiness(p or prep(), [lot_data or lot()], now=NOW)["issues"]
    }


def revision():
    return RevisionPreview(
        organization_id=uuid4(),
        dossier_id=uuid4(),
        revision=1,
        prepared_at=NOW,
        preparation=prep(),
        lots=[lot()],
    )


def test_complete_means_review_only_not_declared():
    result = readiness(prep(), [lot()], now=NOW)
    assert result["status"] == "READY_FOR_INTERNAL_REVIEW"
    assert result["issues"] == []
    assert result["official_submission_status"] == "NOT_SUBMITTED_BY_GEOFOREST"


@pytest.mark.parametrize("regime", [r for r in Regime if r != Regime.ORDINARY_OPERATOR])
def test_no_invented_ordinary_dds_for_other_actors(regime):
    assert "REGIME_UNQUALIFIED" in codes(prep(regime=regime))


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("regime_reference", "", "REGIME_REFERENCE"),
        ("operator_name", "", "OPERATOR_IDENTITY"),
        ("operator_address", "", "OPERATOR_IDENTITY"),
        ("trade_flow", "UNQUALIFIED", "TRADE_FLOW"),
        ("eori", "", "EORI"),
        ("eori", "not_an_eori", "EORI"),
        ("product_scope_confirmed", False, "PRODUCT_SCOPE"),
        ("product_scope_reference", "x", "PRODUCT_SCOPE"),
        ("supply_chain_complete_confirmed", False, "CHAIN_COMPLETENESS"),
        ("supply_chain_note", "", "CHAIN_COMPLETENESS"),
    ],
)
def test_preparation_gaps(field, value, code):
    assert code in codes(prep(**{field: value}))


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("supplier_archived", True, "ARCHIVED_SOURCE"),
        ("product_archived", True, "ARCHIVED_SOURCE"),
        ("supplier_address", "", "SUPPLIER_INFORMATION"),
        ("supplier_contact", "", "SUPPLIER_INFORMATION"),
        ("product_description", "", "PRODUCT_INFORMATION"),
        ("hs_code", "abcd", "PRODUCT_INFORMATION"),
        ("commodities", [], "COMMODITY"),
        ("commodities", ["invented"], "COMMODITY"),
        ("origin_country", "ZZ", "COUNTRY"),
        ("production_start", None, "PRODUCTION_PERIOD"),
        ("production_end", "2024-01-01", "PRODUCTION_PERIOD"),
        ("additional_unit_reviewed", False, "QUANTITY_REVIEW"),
        ("additional_unit_note", "", "QUANTITY_REVIEW"),
        ("plot_revision_count", 0, "GEOLOCATION"),
        ("geometry_checks_passed", False, "GEOLOCATION"),
        ("geolocation_complete_confirmed", False, "GEOLOCATION"),
        ("current_plot_revisions", False, "PLOT_REVISION"),
        ("legal_qualified", False, "LEGALITY"),
        ("legal_stale", True, "LEGALITY"),
        ("evidence_available", False, "EVIDENCE"),
        ("open_task_count", 1, "OPEN_TASKS"),
        ("risk", None, "RISK_MISSING"),
    ],
)
def test_lot_gaps(field, value, code):
    assert code in codes(lot_data=lot(**{field: value}))


@pytest.mark.parametrize(
    "change,code",
    [
        ({"input_sha256": "b" * 64}, "RISK_STALE"),
        ({"created_at": NOW - timedelta(days=365)}, "RISK_STALE"),
        ({"created_at": NOW + timedelta(seconds=1)}, "RISK_STALE"),
        ({"proposed_residual": "UNDETERMINED"}, "RISK_UNRESOLVED"),
        ({"proposed_residual": "NON_NEGLIGIBLE"}, "RISK_UNRESOLVED"),
        ({"blocking_factors": 1}, "RISK_UNRESOLVED"),
        ({"accepted_proof_count": 0}, "RISK_UNRESOLVED"),
    ],
)
def test_risk_changes(change, code):
    data = lot().risk.model_dump() | change
    assert code in codes(lot_data=lot(risk=data))


def test_wood_requires_all_scientific_names_confirmation():
    assert "WOOD_SPECIES" in codes(lot_data=lot(commodities=["wood"]))
    assert "WOOD_SPECIES" in codes(
        lot_data=lot(commodities=["wood"], scientific_names=["Quercus robur"])
    )
    assert "WOOD_SPECIES" not in codes(
        lot_data=lot(
            commodities=["wood"],
            scientific_names=["Quercus robur"],
            scientific_names_complete_confirmed=True,
        )
    )


def test_exact_mass_and_no_density_guess():
    assert net_mass_kg(lot()) == Decimal("12345.678000")
    assert net_mass_kg(lot(unit="M3")) is None
    assert "NET_MASS" in codes(lot_data=lot(unit="M3"))
    assert "NET_MASS" not in codes(lot_data=lot(unit="M3", declared_net_mass_kg="30"))
    assert "MASS_CONFLICT" in codes(lot_data=lot(declared_net_mass_kg="30"))
    assert "ITEM_COUNT" in codes(lot_data=lot(unit="PCS"))


def test_domestic_does_not_invent_import_mass_or_eori_obligation():
    c = codes(prep(trade_flow=TradeFlow.DOMESTIC, eori=""), lot(unit="M3"))
    assert "NET_MASS" not in c and "EORI" not in c


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-1", "0", "1.1234567"])
def test_invalid_quantities_rejected(value):
    with pytest.raises(ValidationError):
        lot(quantity=value)


def test_duplicates_trimmed_and_unknown_fields_rejected():
    with pytest.raises(ValidationError):
        lot(scientific_names=["Oak", " Oak "])
    with pytest.raises(ValidationError):
        prep(verification_number="SECRET-NOT-ALLOWED")
    with pytest.raises(ValidationError):
        lot(geolocation_complete_confirmed="true")


def test_scope_and_clock_bounds():
    for records in [[], [lot(), lot()], [lot(id=uuid4()) for _ in range(21)]]:
        with pytest.raises(PreparationError):
            readiness(prep(), records, now=NOW)
    with pytest.raises(PreparationError):
        readiness(prep(), [lot()], now=NOW.replace(tzinfo=None))
    with pytest.raises(ValidationError):
        RevisionPreview(
            organization_id=uuid4(),
            dossier_id=uuid4(),
            revision=1,
            prepared_at=NOW,
            preparation=prep(),
            lots=[lot(), lot()],
        )


@pytest.mark.parametrize("role", ["Viewer", "Analyst", "Supplier", "unknown"])
def test_readers_cannot_submit(role):
    with pytest.raises(PreparationError, match="FORBIDDEN"):
        transition(
            State.DRAFT,
            "SUBMIT_FOR_REVIEW",
            role=role,
            note="Dossier fictif soumis",
            checks={},
            snapshot_matches=True,
        )


@pytest.mark.parametrize("role", ["Procurement", "Viewer", "Analyst", "Supplier"])
def test_only_reviewers_validate(role):
    with pytest.raises(PreparationError, match="FORBIDDEN"):
        transition(
            State.IN_REVIEW,
            "VALIDATE_INTERNALLY",
            role=role,
            note="Recette seulement",
            checks=readiness(prep(), [lot()], now=NOW),
            snapshot_matches=True,
            acknowledged=True,
        )


def test_transitions_and_terminal_revisions():
    params = dict(
        role="Compliance Manager",
        note="Décision fictive de recette",
        checks=readiness(prep(), [lot()], now=NOW),
        snapshot_matches=True,
        acknowledged=True,
    )
    state = transition(State.DRAFT, "SUBMIT_FOR_REVIEW", **params)
    assert state == State.IN_REVIEW
    valid = transition(state, "VALIDATE_INTERNALLY", **params)
    assert valid == State.INTERNALLY_VALIDATED
    assert (
        transition(valid, "WITHDRAW_INTERNALLY", **params) == State.INTERNALLY_WITHDRAWN
    )
    assert transition(state, "REQUEST_CHANGES", **params) == State.CHANGES_REQUESTED
    for terminal in [valid, State.CHANGES_REQUESTED, State.INTERNALLY_WITHDRAWN]:
        with pytest.raises(PreparationError):
            transition(terminal, "SUBMIT_FOR_REVIEW", **params)
    with pytest.raises(PreparationError):
        transition(state, "DECLARE_IN_TRACES", **params)


@pytest.mark.parametrize(
    "change",
    [
        {"snapshot_matches": False},
        {"acknowledged": False},
        {"checks": {}},
        {"note": "x"},
        {
            "checks": {
                "policy_version": "old",
                "status": "READY_FOR_INTERNAL_REVIEW",
                "issues": [],
            }
        },
        {"snapshot_matches": "true"},
        {"acknowledged": "true"},
    ],
)
def test_fail_closed_validation(change):
    params = (
        dict(
            role="Admin",
            note="Validation fictive de recette",
            checks=readiness(prep(), [lot()], now=NOW),
            snapshot_matches=True,
            acknowledged=True,
        )
        | change
    )
    with pytest.raises(PreparationError):
        transition(State.IN_REVIEW, "VALIDATE_INTERNALLY", **params)


def test_blocked_dossier_can_be_reviewed_but_not_validated():
    params = dict(
        role="Admin",
        note="Revue pour demander les compléments",
        checks=readiness(prep(), [lot(risk=None)], now=NOW),
        snapshot_matches=True,
        acknowledged=True,
    )
    assert transition(State.DRAFT, "SUBMIT_FOR_REVIEW", **params) == State.IN_REVIEW
    with pytest.raises(PreparationError):
        transition(State.IN_REVIEW, "VALIDATE_INTERNALLY", **params)


def test_canonical_hash_and_no_input_mutation():
    value = {"z": [Decimal("1.000001"), uuid4(), NOW], "a": "Éléments 中文"}
    original = copy.deepcopy(value)
    assert fingerprint(value) == fingerprint(dict(reversed(list(value.items()))))
    assert value == original
    assert b"1.000001" in canonical_bytes(value)
    assert fingerprint(value) != fingerprint(value | {"a": "Autre"})


@pytest.mark.parametrize(
    "value",
    [
        float("nan"),
        float("inf"),
        Decimal("NaN"),
        {1: "bad"},
        set(),
        object(),
        "x" * 256001,
        ["x" * 256000] * 9,
    ],
)
def test_unsupported_and_oversized_snapshots(value):
    with pytest.raises(PreparationError):
        canonical_bytes(value)


def test_depth_bound():
    value = []
    for _ in range(40):
        value = [value]
    with pytest.raises(PreparationError):
        canonical_bytes(value)


@pytest.mark.parametrize(
    "cell",
    ["=SUM(1,2)", "+cmd", "-2+3", "@SUM(A1)", "\t=1", " \r=1", "\ufeff=1", "\x00=1"],
)
def test_csv_formula_neutralized(cell):
    assert csv_text(cell).startswith("'")


def test_preview_exports_exact_json_safe_csv_and_explicit_limitations():
    r = revision()
    r.lots[0].reference = '=FORMULA("danger")'
    sha = revision_hash(r)
    args = dict(expected_sha256=sha, state=State.DRAFT, now=NOW)
    result = preview_export(r, format="json", **args)
    payload = json.loads(result["content"])
    assert payload["revision"]["lots"][0]["reference"] == r.lots[0].reference
    assert payload["revision"]["lots"][0]["quantity"] == "12.345678"
    assert payload["official_submission_status"] == "NOT_SUBMITTED_BY_GEOFOREST"
    assert payload["scope"] == "CURATED_SUMMARY_NOT_COMPLETE_EVIDENCE_PACK"
    result = preview_export(r, format="csv", **args)
    rows = list(csv.DictReader(io.StringIO(result["content"].decode("utf-8-sig"))))
    assert rows[0]["lot_reference"].startswith("'")
    assert rows[0]["net_mass_kg"] == "12345.678000"
    assert rows[0]["revision_sha256"] == sha
    assert "\n" not in result["filename"]
    assert revision_hash(r) == sha


def test_tampered_and_unimplemented_exports_refused():
    r = revision()
    sha = revision_hash(r)
    r.lots[0].product_name = "changed"
    with pytest.raises(PreparationError, match="INTEGRITY"):
        preview_export(
            r, expected_sha256=sha, state=State.DRAFT, now=NOW, format="json"
        )
    with pytest.raises(PreparationError, match="NOT_IMPLEMENTED"):
        preview_export(
            r,
            expected_sha256=revision_hash(r),
            state=State.DRAFT,
            now=NOW,
            format="pdf",
        )


def test_validated_export_does_not_hide_expired_review():
    r = revision()
    result = preview_export(
        r,
        expected_sha256=revision_hash(r),
        state=State.INTERNALLY_VALIDATED,
        now=NOW + timedelta(days=366),
        format="json",
    )
    doc = json.loads(result["content"])
    assert doc["internal_state"] == "INTERNALLY_VALIDATED"
    assert doc["checks_at_export"]["status"] == "BLOCKED"
    assert doc["official_submission_status"] == "NOT_SUBMITTED_BY_GEOFOREST"


def test_exact_conversion_independent_of_decimal_context():
    sample = lot()
    with localcontext() as ctx:
        ctx.prec = 6
        assert net_mass_kg(sample) == Decimal("12345.678000")


def test_oversized_integer_refused_before_serialization():
    with pytest.raises(PreparationError, match="INTEGER_BUDGET"):
        canonical_bytes(10**10000)


@pytest.mark.parametrize("cell", ["\u00a0=1", " \ufeff \ufeff=1", "\u2000+cmd"])
def test_csv_unicode_prefixes_neutralized(cell):
    assert csv_text(cell).startswith("'")
