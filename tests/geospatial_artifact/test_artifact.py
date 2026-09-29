"""Offline reference integrity; no database fixtures or customer data."""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "gis_audit", ROOT / "scripts/audit-geospatial-artifact.py"
)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def test_all_admitted_references():
    result = AUDIT.audit()
    assert result["status"] == "PASS" and result["verified_country_count"] == 246
    assert result["excluded"] == ["AQ", "EG", "UM"]
    assert result["postgis_topology_retested"] is False
    assert result["vercel_bundle_verified"] is False
    assert result["production_qualified"] is False


@pytest.mark.parametrize("broken", ["missing", "altered"])
def test_manifest_refused(tmp_path, monkeypatch, broken):
    monkeypatch.setattr(AUDIT.references, "WORLD_ROOT", tmp_path)
    if broken == "altered":
        (tmp_path / "manifest.json").write_text("SECRET_DETAILS")
    result = AUDIT.audit()
    assert result["status"] == "FAIL" and result["verified_country_count"] == 0
    assert result["failures"] == ["CATALOGUE_UNAVAILABLE_OR_CHANGED"]


def test_source_errors_do_not_leak(monkeypatch):
    original = AUDIT.references.read_reference

    def read(spec):
        if spec.country == "FR":
            raise ValueError("SECRET_DETAILS")
        return original(spec)

    monkeypatch.setattr(AUDIT.references, "read_reference", read)
    result = AUDIT.audit()
    assert result["status"] == "FAIL" and result["verified_country_count"] == 245
    assert result["failures"] == [
        {"country": "FR", "code": "REFERENCE_UNAVAILABLE_OR_INVALID"}
    ]


def test_partial_catalogue_is_not_global(monkeypatch):
    monkeypatch.setattr(
        AUDIT.references, "CATALOGUE", {"CI": AUDIT.references.CATALOGUE["CI"]}
    )
    assert AUDIT.audit()["status"] == "FAIL"


def test_hidden_exceptions_rejected(monkeypatch):
    monkeypatch.setattr(AUDIT.references, "EXCLUDED", {})
    assert AUDIT.audit()["status"] == "FAIL"
