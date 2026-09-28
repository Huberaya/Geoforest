"""Public outlines and invented test points; never supplier/customer locations."""

import json
from copy import deepcopy

import pytest
from app.database import transaction
from app.geospatial import screening
from app.geospatial.references import (
    CATALOGUE,
    EXCLUDED,
    read_reference,
    reference_structure,
)
from sqlalchemy import text


@pytest.mark.parametrize("country", sorted(CATALOGUE))
def test_each_admitted_world_reference_hash_structure_and_topology(country):
    spec = CATALOGUE[country]
    geom = read_reference(spec)
    assert reference_structure(geom) > 0
    with transaction() as conn:
        assert conn.execute(
            text(
                "SELECT ST_IsValid(ST_GeomFromGeoJSON(:g)) AND NOT ST_IsEmpty(ST_GeomFromGeoJSON(:g))"
            ),
            {"g": json.dumps(geom)},
        ).scalar_one()
    assert spec.provenance()["accuracy_m"] is None
    assert spec.provenance()["qualification"] == "GLOBAL_INDICATIVE_ONLY"
    assert spec.provenance()["represented_year"] == "non renseignée par la source"


@pytest.mark.parametrize(
    "country,pair",
    [
        ("FR", [2, 47]),
        ("GF", [-53, 4]),
        ("BR", [-53, -10]),
        ("ID", [114, -1]),
        ("CI", [-5.5, 7.5]),
        ("RU", [90, 60]),
        ("CA", [-100, 55]),
        ("AU", [135, -25]),
    ],
)
def test_invented_global_anchors_are_indicative_only(country, pair):
    geom = {"type": "Point", "coordinates": pair}
    original = deepcopy(geom)
    with transaction() as conn:
        r = screening.screen_country(conn, geom, country, review_distance_m=0)
    assert r["status"] == "INSIDE_REFERENCE_INDICATIVE", r
    assert r["country_verified"] is False and r["human_review_required"] is True
    assert r["method_version"] == "country-screening-v2-global-indicative"
    assert geom == original


def test_france_not_conflated_with_french_guiana():
    with transaction() as conn:
        r = screening.screen_country(
            conn, {"type": "Point", "coordinates": [-53, 4]}, "FR", review_distance_m=0
        )
    assert r["status"] == "OUTSIDE_REFERENCE_INDICATIVE"
    assert "French Guiana" not in r["source"]["map_units"]
    assert "French Guiana" in CATALOGUE["GF"].map_units
    assert r["human_review_required"]


def test_explicit_global_coverage_exceptions():
    assert len(CATALOGUE) == 246
    assert set(EXCLUDED) == {"AQ", "EG", "UM"}
    assert EXCLUDED["EG"] == "UPSTREAM_TOPOLOGY_INVALID"
    assert CATALOGUE["FR"].dataset == "Natural Earth"


def test_catalogue_unavailable_never_returns_match(monkeypatch):
    monkeypatch.setattr(screening, "CATALOGUE", {})
    monkeypatch.setattr(screening, "CATALOGUE_ERROR", "WORLD_CATALOGUE_UNAVAILABLE")
    with transaction() as conn:
        r = screening.screen_country(
            conn, {"type": "Point", "coordinates": [2, 47]}, "FR", review_distance_m=0
        )
    assert r["status"] == "SOURCE_UNAVAILABLE" and r["source"] is None
    assert not r["country_verified"]
