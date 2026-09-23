"""Tests bout-en-bout du pipeline EUDR de GeoForest Trace.

Scénarios :
  1. Parcelle conforme (< 4 ha, aucune déforestation post-2020).
  2. Parcelle non conforme (déforestation détectée en 2022).
  3. Erreurs de format (polygone auto-intersectant, coordonnées invalides, précision, anneau ouvert).
  4. Export TRACES-NT (XML bien formé + JSON).
"""
from __future__ import annotations

import base64
import json
import os
from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient
from lxml import etree

os.environ["GFW_LIVE_ENABLED"] = "false"  # moteur déterministe uniquement pendant les tests

from app.core.database import reset_db_for_tests  # noqa: E402
from app.main import app  # noqa: E402
from app.services.gis_validator import validate_geometry  # noqa: E402
from app.services.satellite_checker import check_deforestation_risk  # noqa: E402
from app.services.traces_exporter import NS_MODEL, NS_SUBMISSION  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_db() -> None:
    reset_db_for_tests(":memory:")


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


# --------------------------------------------------------------------------- Jeux de données
# Parcelle de café ~1,3 ha dans la zone de Yirgacheffe (Éthiopie), hors hotspot => conforme.
COMPLIANT_POLYGON: Dict[str, Any] = {
    "type": "Polygon",
    "coordinates": [
        [
            [38.201234, 6.161234],
            [38.202334, 6.161234],
            [38.202334, 6.162334],
            [38.201234, 6.162334],
            [38.201234, 6.161234],
        ]
    ],
}

# Parcelle de cacao ~1,3 ha dans l'arc de déforestation du Pará (BR) => perte 2022 (hotspot).
DEFORESTED_POLYGON: Dict[str, Any] = {
    "type": "Polygon",
    "coordinates": [
        [
            [-52.501234, -5.501234],
            [-52.500134, -5.501234],
            [-52.500134, -5.500134],
            [-52.501234, -5.500134],
            [-52.501234, -5.501234],
        ]
    ],
}

# Polygone en « nœud papillon » : auto-intersection.
SELF_INTERSECTING_POLYGON: Dict[str, Any] = {
    "type": "Polygon",
    "coordinates": [
        [
            [38.201234, 6.161234],
            [38.202334, 6.162334],
            [38.202334, 6.161234],
            [38.201234, 6.162334],
            [38.201234, 6.161234],
        ]
    ],
}

OPERATOR = {"name": "Café Import SAS", "eori": "FR12345678901234", "country": "FR", "address": "1 rue du Port, 76600 Le Havre"}


def _audit_payload(geojson: Dict[str, Any], commodity: str = "coffee", harvest_date: str = "2024-03-15", **extra: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"geojson": geojson, "commodity": commodity, "harvest_date": harvest_date, "operator": OPERATOR}
    payload.update(extra)
    return payload


# --------------------------------------------------------------------------- 1. Conforme
class TestCompliantParcel:
    def test_gis_validation_small_polygon(self) -> None:
        result = validate_geometry(COMPLIANT_POLYGON)
        assert result["valid"] is True, result["errors"]
        assert result["geometry_type"] == "Polygon"
        assert 1.0 < result["area_ha"] < 2.0  # ~1,48 ha géodésique
        assert result["eudr_geometry_rule"] == "POINT_ALLOWED"
        assert result["precision_ok"] is True
        assert result["min_decimals_found"] >= 6

    def test_satellite_no_loss(self) -> None:
        sat = check_deforestation_risk(COMPLIANT_POLYGON, "2024-03-15")
        assert sat["compliant"] is True
        assert sat["loss_year"] is None
        assert sat["risk_level"] in {"LOW", "STANDARD"}
        assert 0.0 <= sat["confidence_score"] <= 1.0
        assert sat["country_code"] == "ET"

    def test_point_allowed_under_4ha(self) -> None:
        point = {"type": "Point", "coordinates": [38.201234, 6.161234]}
        result = validate_geometry(point, declared_area_ha=2.5)
        assert result["valid"] is True
        assert result["area_ha"] == 0.0
        assert result["eudr_geometry_rule"] == "POINT_ALLOWED"

    def test_point_rejected_at_or_above_4ha(self) -> None:
        point = {"type": "Point", "coordinates": [38.201234, 6.161234]}
        result = validate_geometry(point, declared_area_ha=4.0)
        assert result["valid"] is False
        assert any(e["code"] == "POLYGON_REQUIRED" for e in result["errors"])

    def test_api_audit_compliant(self, client: TestClient) -> None:
        response = client.post("/api/v1/audit/parcel", json=_audit_payload(COMPLIANT_POLYGON))
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["status"] == "COMPLIANT"
        assert body["hs_code"] == "0901"
        assert body["satellite"]["compliant"] is True
        assert body["eudr_cutoff_date"] == "2020-12-31"
        assert body["validation"]["area_ha"] < 4


# --------------------------------------------------------------------------- 2. Non conforme
class TestNonCompliantParcel:
    def test_satellite_detects_2022_loss(self) -> None:
        sat = check_deforestation_risk(DEFORESTED_POLYGON, "2024-06-01")
        assert sat["compliant"] is False
        assert sat["loss_year"] == 2022
        assert sat["risk_level"] == "HIGH"
        assert sat["confidence_score"] >= 0.85
        assert sat["country_code"] == "BR"

    def test_simulated_loss_year_feature_property(self) -> None:
        feature = {"type": "Feature", "properties": {"simulated_loss_year": 2022}, "geometry": COMPLIANT_POLYGON}
        sat = check_deforestation_risk(feature, "2024-06-01")
        assert sat["compliant"] is False
        assert sat["loss_year"] == 2022

    def test_pre_cutoff_loss_remains_compliant(self) -> None:
        feature = {"type": "Feature", "properties": {"simulated_loss_year": 2019}, "geometry": COMPLIANT_POLYGON}
        sat = check_deforestation_risk(feature, "2024-06-01")
        assert sat["compliant"] is True
        assert sat["loss_year"] == 2019

    def test_api_audit_non_compliant(self, client: TestClient) -> None:
        response = client.post("/api/v1/audit/parcel", json=_audit_payload(DEFORESTED_POLYGON, commodity="cocoa"))
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["status"] == "NON_COMPLIANT"
        assert body["hs_code"] == "1801"
        assert body["satellite"]["loss_year"] == 2022
        assert "2022" in body["summary"]


# --------------------------------------------------------------------------- 3. Erreurs de format
class TestInvalidGeometry:
    def test_self_intersecting_polygon(self) -> None:
        result = validate_geometry(SELF_INTERSECTING_POLYGON)
        assert result["valid"] is False
        assert any(e["code"] == "SELF_INTERSECTION" for e in result["errors"]), result["errors"]

    def test_out_of_range_coordinates(self) -> None:
        bad = {"type": "Point", "coordinates": [6.161234, 138.201234]}  # lat > 90 (ordre inversé)
        result = validate_geometry(bad)
        assert result["valid"] is False
        assert result["errors"][0]["code"] == "COORDINATES_OUT_OF_RANGE"

    def test_insufficient_precision(self) -> None:
        bad = {"type": "Point", "coordinates": [38.2, 6.16]}
        result = validate_geometry(bad)
        assert result["valid"] is False
        assert result["precision_ok"] is False
        assert any(e["code"] == "INSUFFICIENT_PRECISION" for e in result["errors"])

    def test_unclosed_ring(self) -> None:
        ring = COMPLIANT_POLYGON["coordinates"][0][:-1]
        result = validate_geometry({"type": "Polygon", "coordinates": [ring]})
        assert result["valid"] is False
        assert any(e["code"] == "RING_NOT_CLOSED" for e in result["errors"])

    def test_unsupported_type(self) -> None:
        result = validate_geometry({"type": "LineString", "coordinates": [[38.201234, 6.161234], [38.202334, 6.162334]]})
        assert result["valid"] is False
        assert result["errors"][0]["code"] == "UNSUPPORTED_GEOMETRY_TYPE"

    def test_api_returns_invalid_geometry_status(self, client: TestClient) -> None:
        response = client.post("/api/v1/audit/parcel", json=_audit_payload(SELF_INTERSECTING_POLYGON))
        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "INVALID_GEOMETRY"
        assert body["satellite"] is None
        assert body["validation"]["errors"][0]["code"] == "SELF_INTERSECTION"

    def test_api_rejects_bad_eori(self, client: TestClient) -> None:
        payload = _audit_payload(COMPLIANT_POLYGON)
        payload["operator"] = {"name": "X Corp", "eori": "123"}
        response = client.post("/api/v1/audit/parcel", json=payload)
        assert response.status_code == 422

    def test_api_rejects_future_harvest_date(self, client: TestClient) -> None:
        response = client.post("/api/v1/audit/parcel", json=_audit_payload(COMPLIANT_POLYGON, harvest_date="2999-01-01"))
        assert response.status_code == 422


# --------------------------------------------------------------------------- 4. Export TRACES-NT
class TestTracesExport:
    def _create_audit(self, client: TestClient, geojson: Dict[str, Any], commodity: str = "coffee") -> str:
        response = client.post("/api/v1/audit/parcel", json=_audit_payload(geojson, commodity=commodity))
        assert response.status_code == 201
        return response.json()["audit_id"]

    def test_xml_export_is_well_formed_and_complete(self, client: TestClient) -> None:
        audit_id = self._create_audit(client, COMPLIANT_POLYGON)
        response = client.post(
            "/api/v1/export/traces",
            json={"audit_id": audit_id, "format": "xml", "operator": OPERATOR, "net_weight_kg": 1250.5},
        )
        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith("application/xml")
        assert "attachment" in response.headers["content-disposition"]

        root = etree.fromstring(response.content)
        assert root.tag == f"{{{NS_SUBMISSION}}}SubmitStatementRequest"
        ns = {"m": NS_MODEL}
        assert root.findtext(".//m:identifierValue", namespaces=ns) == "FR12345678901234"
        assert root.findtext(".//m:hsHeading", namespaces=ns) == "0901"
        assert root.findtext(".//m:netWeight", namespaces=ns) == "1250.500"

        geojson_b64 = root.findtext(".//m:geometryGeojson", namespaces=ns)
        assert geojson_b64
        decoded = json.loads(base64.b64decode(geojson_b64))
        assert decoded["type"] == "FeatureCollection"
        assert decoded["features"][0]["geometry"]["type"] == "Polygon"

        status_el = root.find(".//{https://geoforest-trace.eu/schema/verification/v1}status")
        assert status_el is not None and status_el.text == "VERIFIED_COMPLIANT"

    def test_json_export_non_compliant_flagged(self, client: TestClient) -> None:
        audit_id = self._create_audit(client, DEFORESTED_POLYGON, commodity="cocoa")
        response = client.post("/api/v1/export/traces", json={"audit_id": audit_id, "format": "json"})
        assert response.status_code == 200
        body = response.json()
        assert body["statement"]["commodities"][0]["hs_heading"] == "1801"
        assert body["verification"]["status"] == "VERIFIED_NON_COMPLIANT"
        assert body["verification"]["loss_year"] == 2022

    def test_export_refused_for_invalid_geometry(self, client: TestClient) -> None:
        audit_id = self._create_audit(client, SELF_INTERSECTING_POLYGON)
        response = client.post("/api/v1/export/traces", json={"audit_id": audit_id})
        assert response.status_code == 409

    def test_export_unknown_audit(self, client: TestClient) -> None:
        response = client.post("/api/v1/export/traces", json={"audit_id": "does-not-exist"})
        assert response.status_code == 404

    def test_audit_history_listing(self, client: TestClient) -> None:
        self._create_audit(client, COMPLIANT_POLYGON)
        self._create_audit(client, DEFORESTED_POLYGON, commodity="cocoa")
        response = client.get("/api/v1/audits")
        assert response.status_code == 200
        assert len(response.json()) == 2


# --------------------------------------------------------------------------- 5. Multi-parcelles & Précision
class TestMultiParcelAndPrecision:
    def test_mixed_point_and_polygon_composite_batch(self) -> None:
        mixed = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"name": "Smallholder 1", "area_ha": 1.5},
                    "geometry": {"type": "Point", "coordinates": [38.201234, 6.161234]},
                },
                {
                    "type": "Feature",
                    "properties": {"name": "Estate 2", "area_ha": 6.0},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[
                            [38.201234, 6.161234],
                            [38.205234, 6.161234],
                            [38.205234, 6.165234],
                            [38.201234, 6.165234],
                            [38.201234, 6.161234],
                        ]],
                    },
                },
            ],
        }
        res = validate_geometry(mixed)
        assert res["valid"] is True
        assert res["geometry_type"] == "FeatureCollection"
        assert any(w["code"] == "COMPOSITE_BATCH" for w in res["warnings"])

    def test_multi_points_per_plot_4ha_rule(self) -> None:
        # 5 parcelles de 1 ha (total 5 ha) -> points autorisés car chaque parcelle < 4 ha
        points = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"name": f"P{i}", "area_ha": 1.0},
                    "geometry": {"type": "Point", "coordinates": [38.201234 + i * 0.001, 6.161234]},
                }
                for i in range(5)
            ],
        }
        res = validate_geometry(points, declared_area_ha=5.0)
        assert res["valid"] is True
        assert res["eudr_geometry_rule"] == "POINT_ALLOWED"

    def test_multi_points_one_point_above_4ha_rejected(self) -> None:
        bad_points = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"name": "Small", "area_ha": 1.0}, "geometry": {"type": "Point", "coordinates": [38.201234, 6.161234]}},
                {"type": "Feature", "properties": {"name": "TooBig", "area_ha": 4.5}, "geometry": {"type": "Point", "coordinates": [38.202234, 6.161234]}},
            ],
        }
        res = validate_geometry(bad_points)
        assert res["valid"] is False
        assert any(e["code"] == "POLYGON_REQUIRED" and "TooBig" in e["message"] for e in res["errors"])

    def test_precision_with_trailing_zeros_in_property(self) -> None:
        zero_coord = {
            "type": "Feature",
            "properties": {"name": "ZeroCoord", "min_decimals": 6},
            "geometry": {"type": "Point", "coordinates": [38.2012, 6.1612]},
        }
        res = validate_geometry(zero_coord)
        assert res["valid"] is True
        assert res["precision_ok"] is True

