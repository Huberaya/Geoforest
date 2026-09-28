"""Pinned reference-data tests: country benchmark and current Annex I candidates."""
from __future__ import annotations

from app.services.eudr_references import (
    COUNTRY_BENCHMARK_VERSION,
    HIGH_RISK_COUNTRY_CODES,
    LOW_RISK_COUNTRY_CODES,
    PRODUCT_SCOPE_CATALOG,
    PRODUCT_SCOPE_VERSION,
    RISK_CRITERIA,
    classify_country,
    product_scope_candidates,
)


def test_2025_1093_country_levels_are_not_supplier_risk_ratings() -> None:
    assert classify_country("BY")["level"] == "high"
    assert classify_country("RU")["level"] == "high"
    assert classify_country("GH")["level"] == "low"
    assert classify_country("CI")["level"] == "standard"
    assert classify_country("XX")["level"] == "unknown"
    assert classify_country(None)["level"] == "unknown"
    assert classify_country("GH")["benchmark_version"] == COUNTRY_BENCHMARK_VERSION
    assert classify_country("GH")["is_legal_decision"] is False
    assert len(HIGH_RISK_COUNTRY_CODES) == 4
    assert "RU" in HIGH_RISK_COUNTRY_CODES
    assert "GH" in LOW_RISK_COUNTRY_CODES


def test_annex_catalog_keeps_ex_qualifier_and_scheduled_dates() -> None:
    assert PRODUCT_SCOPE_VERSION == "EUDR-ANNEX-I-2026-09-18"
    criterion_codes = {entry["code"] for entry in RISK_CRITERIA}
    assert {"corruption", "human_rights", "armed_conflict", "sanctions", "expert_group_conclusions"} <= criterion_codes
    palm = product_scope_candidates("palm_oil", "2905170000")
    assert palm
    assert palm[0]["is_ex"] is True
    assert palm[0]["applies_from"] == "2027-12-30"
    assert palm[0]["review_required"] is True
    # An exact code match is a candidate only, never a legal scope verdict.
    cocoa = product_scope_candidates("cocoa", "1806")
    assert cocoa[0]["match_kind"] == "exact"
    assert cocoa[0]["review_required"] is True


def test_removed_or_narrowed_2026_codes_are_not_current_candidates() -> None:
    assert product_scope_candidates("cattle", "4101") == []
    assert product_scope_candidates("rubber", "4010") == []
    assert product_scope_candidates("rubber", "4016") == []
    assert product_scope_candidates("soy", "1201")[0]["match_kind"] == "prefix_candidate"
    assert product_scope_candidates("soy", "12019000")
    assert any(entry["code"] == "40129030" for entry in PRODUCT_SCOPE_CATALOG)


def test_unmatched_product_code_is_not_a_scope_exclusion() -> None:
    assert product_scope_candidates("wood", "99999999") == []
    assert product_scope_candidates("unknown", "1801") == []
