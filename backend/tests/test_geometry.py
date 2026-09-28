"""Synthetic ocean coordinates only; real PostGIS checks, no satellite claims."""

from copy import deepcopy

import pytest
from app.database import transaction
from app.plots.geometry import structure, validate_geometry
from fastapi import HTTPException


def square(x=-30, y=0, side=0.001):
    return {
        "type": "Polygon",
        "coordinates": [
            [[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]]
        ],
    }


def warnings(result):
    return {w["code"] for w in result["warnings"]}


def test_polygon_geodesic_area_and_source_preserved():
    geometry = square()
    original = deepcopy(geometry)
    with transaction() as conn:
        r = validate_geometry(conn, geometry)
    assert 1.22 < r["calculated_area_ha"] < 1.24
    assert r["regulatory_status"] == "NOT_ASSESSED"
    assert r["official_system_status"] == "NOT_TESTED"
    assert r["geometry"] == original and geometry == original
    assert r["position_count"] == 5


def test_point_has_no_invented_area_and_untrusted_bbox_ignored():
    with transaction() as conn:
        r = validate_geometry(
            conn, {"type": "Point", "coordinates": [-30, 0], "bbox": [1, 2, 3, 4]}
        )
    assert r["calculated_area_ha"] is None and r["declared_area_ha"] is None
    assert r["bbox"] == [-30, 0, -30, 0]
    assert "AREA_UNKNOWN" in warnings(r)


@pytest.mark.parametrize(
    "area,commodity,warning",
    [
        ("4", "cocoa", False),
        ("4.000001", "cocoa", True),
        ("5", "cattle", False),
        ("5", None, False),
    ],
)
def test_conditional_four_hectare_advisory(area, commodity, warning):
    with transaction() as conn:
        r = validate_geometry(
            conn, {"type": "Point", "coordinates": [-30, 0]}, area, commodity
        )
    assert ("POLYGON_REQUIRED_IF_STANDARD_REGIME" in warnings(r)) is warning
    assert r["regulatory_status"] == "NOT_ASSESSED"


@pytest.mark.parametrize(
    "geometry",
    [
        None,
        {},
        {"type": [], "coordinates": []},
        {"type": "LineString", "coordinates": [[-30, 0], [-30, 1]]},
        {"type": "Point", "coordinates": [True, 0]},
        {"type": "Point", "coordinates": [float("nan"), 0]},
        {"type": "Point", "coordinates": [float("inf"), 0]},
        {"type": "Point", "coordinates": [181, 0]},
        {"type": "Point", "coordinates": [0, 91]},
        {"type": "Point", "coordinates": [-30, 0, 2]},
        {"type": "Point", "coordinates": [[-30, 0]]},
        {"type": "Polygon", "coordinates": []},
        {"type": "MultiPolygon", "coordinates": []},
        {"type": "Point", "coordinates": [-30, 0], "crs": {"name": "EPSG:3857"}},
        {"type": "Polygon", "coordinates": [[[-30, 0], [-29, 0], [-29, 1], [-30, 1]]]},
    ],
)
def test_structure_rejects_corrupt_data_before_sql(geometry):
    with pytest.raises(HTTPException) as err:
        structure(geometry)
    assert err.value.status_code == 422


def test_self_intersection_refused_without_repair():
    bad = {
        "type": "Polygon",
        "coordinates": [[[-30, 0], [-29.99, 0.01], [-30, 0.01], [-29.99, 0], [-30, 0]]],
    }
    with transaction() as conn, pytest.raises(HTTPException) as err:
        validate_geometry(conn, bad)
    assert err.value.detail["code"] == "INVALID_TOPOLOGY"


def test_valid_hole_preserved_but_official_compatibility_warned():
    geometry = square(side=0.01)
    geometry["coordinates"].append(square(-29.998, 0.002, 0.001)["coordinates"][0])
    with transaction() as conn:
        r = validate_geometry(conn, geometry)
    assert r["geometry"] == geometry
    assert "IS_HOLES_NOT_SUPPORTED" in warnings(r)


def test_multipolygon_and_overlapping_components():
    a = square()
    b = square(-29.998)
    with transaction() as conn:
        r = validate_geometry(
            conn,
            {
                "type": "MultiPolygon",
                "coordinates": [a["coordinates"], b["coordinates"]],
            },
        )
        assert 2.44 < r["calculated_area_ha"] < 2.48
        with pytest.raises(HTTPException):
            validate_geometry(
                conn,
                {
                    "type": "MultiPolygon",
                    "coordinates": [a["coordinates"], a["coordinates"]],
                },
            )


def test_tiny_polygon_truncation_does_not_replace_source():
    tiny = square(-30, 0, 0.0000004)
    with transaction() as conn:
        r = validate_geometry(conn, tiny)
    assert r["calculated_area_ha"] > 0
    assert "IS_TRUNCATION_INVALIDATES" in warnings(r)
    assert r["geometry"] == tiny


def test_antimeridian_and_polar_polygons_explicitly_unsupported():
    for geo in [square(179, 0, 2), square(-30, 86, 0.001)]:
        if geo["coordinates"][0][1][0] > 180:
            for p in geo["coordinates"][0]:
                if p[0] > 180:
                    p[0] -= 360
        with pytest.raises(HTTPException) as err:
            structure(geo)
        assert err.value.detail["code"] in {
            "ANTIMERIDIAN_NOT_SUPPORTED",
            "POLAR_POLYGON_NOT_SUPPORTED",
        }


def test_budget_and_oversized_polygon():
    with pytest.raises(HTTPException):
        structure({"type": "Polygon", "coordinates": [[[-30, 0]] * 10001]})
    with transaction() as conn, pytest.raises(HTTPException) as err:
        validate_geometry(conn, square(side=1))
    assert err.value.detail["code"] == "AREA_TECHNICAL_LIMIT"


@pytest.mark.parametrize("area", ["NaN", "Infinity", "0", "-1", True, "oops"])
def test_invalid_declared_area(area):
    with transaction() as conn, pytest.raises(HTTPException) as err:
        validate_geometry(conn, {"type": "Point", "coordinates": [-30, 0]}, area)
    assert err.value.detail["code"] == "DECLARED_AREA_INVALID"


def test_extreme_integer_rejected_without_float_overflow():
    with pytest.raises(HTTPException) as err:
        structure({"type": "Point", "coordinates": [10**1000, 0]})
    assert err.value.detail["code"] == "COORDINATE_OUT_OF_RANGE"
