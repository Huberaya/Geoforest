import json

import pytest
from app.plots.imports import parse_import
from fastapi import HTTPException

POINT = {"type": "Point", "coordinates": [-30, 0]}


def test_geojson_forms_and_untrusted_properties():
    for data in [
        POINT,
        {
            "type": "Feature",
            "geometry": POINT,
            "properties": {
                "name": "Fictif",
                "organization_id": "untrusted",
                "compliance": "yes",
            },
        },
        {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "geometry": POINT, "properties": None}],
        },
    ]:
        r = parse_import(json.dumps(data), "geojson")
        assert len(r["features"]) == 1 and r["position_count"] == 1
        assert r["features"][0]["geometry"] == POINT
        assert r["status"] == "STRUCTURE_PARSED_NOT_PERSISTED"
    r = parse_import(
        json.dumps(
            {
                "type": "Feature",
                "geometry": POINT,
                "properties": {"organization_id": "untrusted"},
            }
        ),
        "geojson",
    )
    assert r["features"][0]["source_properties"] == {}
    assert r["features"][0]["ignored_properties"] == ["organization_id"]


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "[]",
        '{"type":"Point","type":"Polygon"}',
        '{"type":"Point","coordinates":[NaN,0]}',
        '{"type":"FeatureCollection","features":[]}',
        '{"type":"Feature","geometry":null}',
        "[" * 10000,
        '{"type":"FeatureCollection","crs":{},"features":[]}',
    ],
)
def test_bad_json_rejected(raw):
    with pytest.raises(HTTPException) as e:
        parse_import(raw, "geojson")
    assert e.value.status_code == 422


def test_limits_and_checksum():
    raw = json.dumps(POINT)
    assert (
        parse_import(raw, "geojson")["source_sha256"]
        == parse_import(raw, "geojson")["source_sha256"]
    )
    with pytest.raises(HTTPException):
        parse_import("x" * (1024 * 1024 + 1), "geojson")
    with pytest.raises(HTTPException):
        parse_import(raw, "kmz")
    with pytest.raises(HTTPException):
        parse_import(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [{"type": "Feature", "geometry": POINT}] * 101,
                }
            ),
            "geojson",
        )


def test_kml_point_altitude_is_explicit_not_silent():
    r = parse_import(
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Fictif</name><Point><coordinates>-30,0,10</coordinates></Point></Placemark></Document></kml>',
        "kml",
    )
    f = r["features"][0]
    assert f["geometry"] == POINT
    assert f["warnings"] == ["KML_ALTITUDE_NOT_USED_IN_2D"]
    assert f["source_properties"]["name"] == "Fictif"


def test_kml_polygon_and_multipolygon():
    poly = "<Polygon><outerBoundaryIs><LinearRing><coordinates>-30,0 -29.999,0 -29.999,0.001 -30,0.001 -30,0</coordinates></LinearRing></outerBoundaryIs></Polygon>"
    for geometry, kind in [
        (poly, "Polygon"),
        ("<MultiGeometry>" + poly + poly + "</MultiGeometry>", "MultiPolygon"),
    ]:
        r = parse_import("<kml><Placemark>" + geometry + "</Placemark></kml>", "kml")
        assert r["features"][0]["geometry"]["type"] == kind
        # Overlapping components are left for PostGIS validity checking, not repaired here.


@pytest.mark.parametrize(
    "raw",
    [
        '<!DOCTYPE kml [<!ENTITY x SYSTEM "file:///etc/passwd">]><kml><Placemark><name>&x;</name></Placemark></kml>',
        "<kml><NetworkLink><Link><href>https://example.invalid/private</href></Link></NetworkLink></kml>",
        "<kml><Placemark><LineString><coordinates>-30,0 -29,1</coordinates></LineString></Placemark></kml>",
        "<kml><Placemark><Point><coordinates>NaN,0</coordinates></Point></Placemark></kml>",
        "<kml><Placemark><Point><coordinates>-30,0 -29,0</coordinates></Point></Placemark></kml>",
        "<kml><Placemark><MultiGeometry><Point><coordinates>-30,0</coordinates></Point></MultiGeometry></Placemark></kml>",
        "<kml><Placemark>",
        "<other/>",
        "<kml/>",
    ],
)
def test_hostile_or_unsupported_kml_rejected(raw):
    with pytest.raises(HTTPException) as err:
        parse_import(raw, "kml")
    assert err.value.status_code == 422


@pytest.mark.parametrize("properties", [False, 0, [], "untrusted"])
def test_non_object_properties_are_not_silently_accepted(properties):
    with pytest.raises(HTTPException) as err:
        parse_import(
            json.dumps(
                {"type": "Feature", "geometry": POINT, "properties": properties}
            ),
            "geojson",
        )
    assert err.value.detail["code"] == "PROPERTIES_INVALID"
