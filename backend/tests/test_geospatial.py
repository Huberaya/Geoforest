"""Offline country screening; synthetic ocean fixtures plus public outlines.

The inland test point below is invented, not a farm or a person's location.
"""

import hashlib
import json
from copy import deepcopy
from dataclasses import replace

import pytest
from app.database import transaction
from app.geospatial import references, screening
from app.geospatial.references import (
    CIV,
    ReferenceUnavailable,
    read_reference,
    reference_structure,
)
from fastapi import HTTPException
from sqlalchemy import text
from test_geometry import square


def test_pinned_public_reference_and_rejected_france():
    geom = read_reference(CIV)
    assert reference_structure(geom) == 1599
    assert references.CATALOGUE["FR"].dataset == "Natural Earth"
    assert CIV.provenance()["represented_year"] == "2018"
    assert CIV.provenance()["downloaded_on"] == "2026-09-28"
    assert CIV.provenance()["accuracy_m"] is None


def test_real_reference_indicative_only():
    original = {"type": "Point", "coordinates": [-5.5, 7.5]}
    with transaction() as conn:
        result = screening.screen_country(conn, original, "CI", review_distance_m=1000)
    assert result["status"] == "INSIDE_REFERENCE_INDICATIVE"
    assert result["regulatory_status"] == "NOT_ASSESSED"
    assert (
        result["country_verified"] is False and result["human_review_required"] is True
    )
    assert result["source"]["sha256"] == references.CATALOGUE["CI"].sha256
    assert result["distance_to_reference_boundary_m"] > 1000
    assert original == {"type": "Point", "coordinates": [-5.5, 7.5]}


@pytest.mark.parametrize("country", ["AQ", "EG", "UM"])
def test_missing_country_does_not_guess_or_match(country):
    with transaction() as conn:
        r = screening.screen_country(
            conn,
            {"type": "Point", "coordinates": [-30, 0]},
            country,
            review_distance_m=0,
        )
    assert r["status"] == "NOT_COVERED" and r["source"] is None
    assert not r["country_verified"]
    assert r["reference_relation"] is None


@pytest.mark.parametrize(
    "value", [-1, 50001, float("nan"), float("inf"), True, "1000", None]
)
def test_explicit_review_band_validation(value):
    with transaction() as conn, pytest.raises(ValueError, match="REVIEW_DISTANCE"):
        screening.screen_country(conn, square(), "CI", review_distance_m=value)


def test_bad_parcel_still_rejected_when_country_not_covered():
    with transaction() as conn, pytest.raises(HTTPException):
        screening.screen_country(
            conn, {"type": "Point", "coordinates": [999, 0]}, "FR", review_distance_m=0
        )


@pytest.mark.parametrize("country", ["ci", "CIV", "", None, "CI' OR 1=1"])
def test_country_structure_validation(country):
    with transaction() as conn, pytest.raises(ValueError, match="ALPHA2"):
        screening.screen_country(conn, square(), country, review_distance_m=0)


@pytest.fixture
def synthetic_reference(monkeypatch):
    geom = square(x=-30, y=0, side=1)
    monkeypatch.setattr(screening, "read_reference", lambda spec: deepcopy(geom))
    spec = replace(
        CIV,
        boundary_id="SYNTHETIC-OCEAN-TEST",
        primary_source="Synthetic test fixture",
        upstream_commit="0" * 40,
        sha256=hashlib.sha256(json.dumps(geom).encode()).hexdigest(),
    )
    monkeypatch.setattr(screening, "CATALOGUE", {"CI": spec})
    return geom


@pytest.mark.parametrize(
    "coords,band,status,relation",
    [
        ([-29.5, 0.5], 0, "INSIDE_REFERENCE_INDICATIVE", "COVERED"),
        ([-31, 0.5], 0, "OUTSIDE_REFERENCE_INDICATIVE", "DISJOINT"),
        ([-30, 0.5], 0, "BOUNDARY_REVIEW_REQUIRED", "COVERED"),
        ([-29.9999, 0.5], 50, "BOUNDARY_REVIEW_REQUIRED", "COVERED"),
        ([-30.0001, 0.5], 50, "BOUNDARY_REVIEW_REQUIRED", "DISJOINT"),
    ],
)
def test_synthetic_boundary_and_nearby_points(
    synthetic_reference, coords, band, status, relation
):
    with transaction() as conn:
        r = screening.screen_country(
            conn, {"type": "Point", "coordinates": coords}, "CI", review_distance_m=band
        )
    assert r["status"] == status and r["reference_relation"] == relation
    assert r["human_review_required"] and not r["country_verified"]


def test_cross_boundary_polygon(synthetic_reference):
    with transaction() as conn:
        r = screening.screen_country(
            conn, square(x=-30.001, y=0.5, side=0.002), "CI", review_distance_m=0
        )
    assert r["status"] == "BOUNDARY_REVIEW_REQUIRED"
    assert r["reference_relation"] == "PARTIAL_INTERSECTION"


def test_disjoint_multi_partial_intersection(synthetic_reference):
    geom = {
        "type": "MultiPolygon",
        "coordinates": [
            square(-29.5, 0.5)["coordinates"],
            square(-31, 0.5)["coordinates"],
        ],
    }
    with transaction() as conn:
        r = screening.screen_country(conn, geom, "CI", review_distance_m=0)
    assert r["status"] == "PARTIAL_REFERENCE_INTERSECTION"
    assert r["distance_to_reference_boundary_m"] > 0


def test_reference_hole_is_not_inside(monkeypatch, synthetic_reference):
    geom = deepcopy(synthetic_reference)
    geom["coordinates"].append(square(-29.7, 0.3, 0.2)["coordinates"][0])
    monkeypatch.setattr(screening, "read_reference", lambda spec: geom)
    with transaction() as conn:
        r = screening.screen_country(
            conn,
            {"type": "Point", "coordinates": [-29.6, 0.4]},
            "CI",
            review_distance_m=0,
        )
    assert r["status"] == "OUTSIDE_REFERENCE_INDICATIVE"


def test_invalid_reference_topology_never_repaired(monkeypatch):
    geom = {
        "type": "Polygon",
        "coordinates": [[[-30, 0], [-29, 1], [-29, 0], [-30, 1], [-30, 0]]],
    }
    monkeypatch.setattr(screening, "read_reference", lambda spec: geom)
    with transaction() as conn:
        r = screening.screen_country(conn, square(), "CI", review_distance_m=0)
        assert conn.execute(text("SELECT 1")).scalar_one() == 1
    assert (
        r["status"] == "SOURCE_UNAVAILABLE"
        and r["reason"] == "REFERENCE_TOPOLOGY_INVALID"
    )


def test_query_failure_rolls_back_savepoint(synthetic_reference):
    with transaction() as conn:

        class Fault:
            def begin_nested(self):
                return conn.begin_nested()

            def execute(self, statement, *args, **kwargs):
                if "WITH shapes" in str(statement):
                    return conn.execute(text("SELECT 1/0"))
                return conn.execute(statement, *args, **kwargs)

        r = screening.screen_country(
            Fault(), square(-29.5, 0.5), "CI", review_distance_m=0
        )
        assert conn.execute(text("SELECT 1")).scalar_one() == 1
    assert r["status"] == "SOURCE_UNAVAILABLE" and r["reference_relation"] is None


def test_tampered_or_missing_source_is_not_a_match(monkeypatch, tmp_path):
    monkeypatch.setattr(screening, "CATALOGUE", {"CI": CIV})
    monkeypatch.setattr(references, "ROOT", tmp_path)
    with pytest.raises(ReferenceUnavailable, match="FILE_UNAVAILABLE"):
        read_reference(CIV)
    (tmp_path / CIV.filename).write_bytes(b"{}")
    with pytest.raises(ReferenceUnavailable, match="CHECKSUM_MISMATCH"):
        read_reference(CIV)
    with transaction() as conn:
        r = screening.screen_country(conn, square(), "CI", review_distance_m=0)
    assert r["status"] == "SOURCE_UNAVAILABLE" and not r["country_verified"]


def test_bytes_budget_and_path_rejection(monkeypatch, tmp_path):
    monkeypatch.setattr(references, "ROOT", tmp_path)
    monkeypatch.setattr(references, "MAX_SOURCE_BYTES", 10)
    (tmp_path / CIV.filename).write_bytes(b" " * 11)
    with pytest.raises(ReferenceUnavailable, match="BYTE_BUDGET"):
        read_reference(CIV)
    with pytest.raises(ReferenceUnavailable, match="PATH_REJECTED"):
        read_reference(replace(CIV, filename="../elsewhere.geojson"))


@pytest.mark.parametrize(
    "raw,reason",
    [
        (
            b'{"type":"FeatureCollection","type":"FeatureCollection"}',
            "DUPLICATE_JSON_KEY",
        ),
        (b'{"type":"FeatureCollection","features":[]}', "COLLECTION_INVALID"),
        (b"null", "COLLECTION_INVALID"),
        (b"\xff", "JSON_INVALID"),
    ],
)
def test_bounded_unambiguous_json(monkeypatch, tmp_path, raw, reason):
    monkeypatch.setattr(references, "ROOT", tmp_path)
    (tmp_path / CIV.filename).write_bytes(raw)
    with pytest.raises(ReferenceUnavailable, match=reason):
        read_reference(replace(CIV, sha256=hashlib.sha256(raw).hexdigest()))


@pytest.mark.parametrize(
    "geometry",
    [
        None,
        {"type": "Point", "coordinates": [0, 0]},
        {"type": "Polygon", "coordinates": []},
        {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1]]]},
        {"type": "Polygon", "coordinates": [[[True, 0], [1, 0], [1, 1], [True, 0]]]},
        {"type": "Polygon", "coordinates": [[[0, 86], [1, 86], [1, 85], [0, 86]]]},
        {
            "type": "Polygon",
            "coordinates": [[[179, 0], [-179, 0], [-179, 1], [179, 0]]],
        },
        {
            "type": "Polygon",
            "coordinates": [[[0, float("nan")], [1, 0], [1, 1], [0, float("nan")]]],
        },
        {
            "type": "Polygon",
            "coordinates": [[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 0]]],
        },
    ],
)
def test_reference_structure_rejects_unsafe_or_unsupported(geometry):
    with pytest.raises(ReferenceUnavailable):
        reference_structure(geometry)


def test_reference_position_budget_and_nonmutation(monkeypatch):
    geom = square()
    before = deepcopy(geom)
    monkeypatch.setattr(references, "MAX_REFERENCE_POSITIONS", 4)
    with pytest.raises(ReferenceUnavailable, match="POSITION_BUDGET"):
        reference_structure(geom)
    assert geom == before


@pytest.mark.parametrize(
    "crs",
    [
        None,
        {"type": "name", "properties": {"name": "EPSG:3857"}},
        {"type": "name", "properties": {"name": "EPSG:4326"}},
    ],
)
def test_ambiguous_crs_is_not_silently_reprojected(monkeypatch, tmp_path, crs):
    original = json.loads((references.ROOT / CIV.filename).read_bytes())
    original["crs"] = crs
    raw = json.dumps(original).encode()
    monkeypatch.setattr(references, "ROOT", tmp_path)
    (tmp_path / CIV.filename).write_bytes(raw)
    with pytest.raises(ReferenceUnavailable, match="CRS_UNSUPPORTED"):
        read_reference(replace(CIV, sha256=hashlib.sha256(raw).hexdigest()))


def test_symlink_escape_rejected(monkeypatch, tmp_path):
    root = tmp_path / "references"
    root.mkdir()
    other = tmp_path / "outside.json"
    other.write_text("{}")
    (root / CIV.filename).symlink_to(other)
    monkeypatch.setattr(references, "ROOT", root)
    with pytest.raises(ReferenceUnavailable, match="PATH_REJECTED"):
        read_reference(CIV)


def test_unknown_country_code_rejected():
    with transaction() as conn, pytest.raises(ValueError, match="COUNTRY_UNKNOWN"):
        screening.screen_country(conn, square(), "ZZ", review_distance_m=0)
