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
import requests
from fastapi.testclient import TestClient
from lxml import etree

# P0-04 : par défaut, AUCUNE source satellite n'est configurée et le mode
# démonstration est désactivé. Les tests qui veulent la simulation l'activent
# explicitement (fixture `demo_mode`) ; ceux qui veulent du probant simulé
# l'accès GFW (fixture `gfw_live`).
os.environ["GFW_LIVE_ENABLED"] = "false"
os.environ.pop("GFW_API_KEY", None)
os.environ["GFW_DEMO_MODE"] = "false"

from app.core.config import settings  # noqa: E402
from app.core.database import reset_db_for_tests  # noqa: E402
from app.main import app  # noqa: E402
from app.services.gis_validator import validate_geometry  # noqa: E402
from app.services import satellite_checker  # noqa: E402
from app.services.satellite_checker import check_deforestation_risk  # noqa: E402
from app.services.traces_exporter import NS_MODEL, NS_SUBMISSION  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_db() -> None:
    reset_db_for_tests(":memory:")


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def demo_mode():
    """Active explicitement le moteur de démonstration (jamais par défaut).

    `Settings` est une dataclass gelée : on passe par `object.__setattr__`
    et on restaure la valeur à la fin du test.
    """
    previous = settings.gfw_demo_mode
    object.__setattr__(settings, "gfw_demo_mode", True)
    yield settings
    object.__setattr__(settings, "gfw_demo_mode", previous)


@pytest.fixture()
def gfw_live(monkeypatch: pytest.MonkeyPatch):
    """Simule un accès GFW disponible, en fournissant des données d'essai."""
    saved_enabled, saved_key = settings.gfw_live_enabled, settings.gfw_api_key
    object.__setattr__(settings, "gfw_live_enabled", True)
    object.__setattr__(settings, "gfw_api_key", "cle-de-test")

    stub_rows: List[Dict[str, Any]] = []

    def fake_query(geometry: Dict[str, Any]):
        rows = list(stub_rows)
        evidence = {
            "provider": "Global Forest Watch (World Resources Institute)",
            "dataset": settings.gfw_dataset,
            "dataset_version": "v1.13",
            "endpoint": f"{settings.gfw_api_url}/dataset/{settings.gfw_dataset}/v1.13/query/json",
            "sql": satellite_checker.GFW_SQL,
            "geometry_type": geometry.get("type", "Unknown"),
            "retrieved_at": "2026-09-30T12:00:00+00:00",
        }
        return rows, evidence

    monkeypatch.setattr(satellite_checker, "_gfw_query", fake_query)
    yield stub_rows
    object.__setattr__(settings, "gfw_live_enabled", saved_enabled)
    object.__setattr__(settings, "gfw_api_key", saved_key)


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

    def test_satellite_without_source_gives_no_verdict(self) -> None:
        """P0-04 : sans source de données, aucun verdict n'est émis."""
        sat = check_deforestation_risk(COMPLIANT_POLYGON, "2024-03-15")
        assert sat["source"] == "unavailable"
        assert sat["is_probative"] is False
        assert sat["compliant"] is None
        assert sat["confidence_score"] is None
        assert sat["disclaimer"]

    def test_point_allowed_under_4ha(self) -> None:
        point = {"type": "Point", "coordinates": [38.201234, 6.161234]}
        result = validate_geometry(point, declared_area_ha=2.5)
        assert result["valid"] is True
        assert result["area_ha"] == 0.0
        assert result["eudr_geometry_rule"] == "POINT_ALLOWED"

    def test_point_at_exactly_4ha_is_allowed(self) -> None:
        """Art. 9(1)(d) : l'obligation de polygone vise les parcelles de PLUS de 4 ha."""
        point = {"type": "Point", "coordinates": [38.201234, 6.161234]}
        result = validate_geometry(point, declared_area_ha=4.0)
        assert result["valid"] is True
        assert result["eudr_geometry_rule"] == "POINT_ALLOWED"

    def test_point_above_4ha_is_rejected(self) -> None:
        point = {"type": "Point", "coordinates": [38.201234, 6.161234]}
        result = validate_geometry(point, declared_area_ha=4.1)
        assert result["valid"] is False
        assert any(e["code"] == "POLYGON_REQUIRED" for e in result["errors"])

    def test_api_audit_without_source_is_unavailable(self, client: TestClient) -> None:
        """P0-04 : l'API ne renvoie ni CONFORME ni NON CONFORME sans données réelles."""
        response = client.post("/api/v1/audit/parcel", json=_audit_payload(COMPLIANT_POLYGON))
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["status"] == "ANALYSIS_UNAVAILABLE"
        assert body["hs_code"] == "0901"
        assert body["satellite"]["compliant"] is None
        assert body["satellite"]["is_probative"] is False
        assert body["eudr_cutoff_date"] == "2020-12-31"
        assert body["validation"]["area_ha"] < 4

    def test_api_audit_probatif_avec_gfw(self, client: TestClient, gfw_live) -> None:
        """Avec un accès GFW disponible, le verdict est probant et tracé."""
        response = client.post("/api/v1/audit/parcel", json=_audit_payload(COMPLIANT_POLYGON))
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["status"] == "COMPLIANT"
        assert body["satellite"]["compliant"] is True
        assert body["satellite"]["is_probative"] is True
        assert body["satellite"]["evidence"]["dataset_version"] == "v1.13"
        assert body["satellite"]["disclaimer"] is None


# --------------------------------------------------------------------------- 2. Non conforme
class TestNonCompliantParcel:
    def test_satellite_detects_2022_loss(self, demo_mode) -> None:
        """En mode démonstration : le scénario est restitué, mais sans verdict."""
        sat = check_deforestation_risk(DEFORESTED_POLYGON, "2024-06-01")
        assert sat["source"] == "simulated"
        assert sat["is_probative"] is False
        assert sat["compliant"] is None, "un moteur simulé ne rend pas de verdict"
        assert sat["loss_year"] == 2022
        assert sat["confidence_score"] is None
        assert sat["country_code"] == "BR"
        assert "non probant" in sat["disclaimer"]

    def test_simulated_loss_year_property_is_ignored(self) -> None:
        """P0-03 : une propriété du fichier ne peut pas dicter le verdict.

        Le même polygone, avec et sans `properties.simulated_loss_year = 2022`,
        doit produire exactement le même verdict.
        """
        clean = check_deforestation_risk(COMPLIANT_POLYGON, "2024-06-01")
        poisoned = check_deforestation_risk(
            {"type": "Feature", "properties": {"simulated_loss_year": 2022}, "geometry": COMPLIANT_POLYGON},
            "2024-06-01",
        )
        assert clean["compliant"] == poisoned["compliant"]
        assert poisoned["loss_year"] == clean["loss_year"]
        assert poisoned["risk_level"] == clean["risk_level"]

    def test_no_property_can_turn_a_compliant_parcel_into_a_loss(self, demo_mode) -> None:
        """P0-03 : tentative d'inverse — fabriquer une conformité sur une zone déforestée."""
        baseline = check_deforestation_risk(DEFORESTED_POLYGON, "2024-06-01")
        tampered = check_deforestation_risk(
            {
                "type": "Feature",
                "properties": {"simulated_loss_year": 2015, "compliant": True, "loss_year": None},
                "geometry": DEFORESTED_POLYGON,
            },
            "2024-06-01",
        )
        # Comparaison sur les faits observables, pas sur un verdict qui n'existe plus.
        assert tampered["loss_year"] == baseline["loss_year"]
        assert tampered["risk_level"] == baseline["risk_level"]
        assert tampered["source"] == baseline["source"]

    def test_pre_cutoff_loss_remains_compliant(self, demo_mode) -> None:
        """Hotspot Mato Grosso pré-cutoff (2019) : perte ancienne ⇒ conforme."""
        historic = {
            "type": "Polygon",
            "coordinates": [[
                [-55.001234, -13.001234], [-54.991234, -13.001234],
                [-54.991234, -12.991234], [-55.001234, -12.991234],
                [-55.001234, -13.001234],
            ]],
        }
        sat = check_deforestation_risk(historic, "2024-06-01")
        assert sat["loss_year"] == 2019
        # Même en démonstration, une perte antérieure au 31/12/2020 ne rend pas
        # le dossier « conforme » : le moteur ne prononce aucun verdict.
        assert sat["compliant"] is None
        assert sat["source"] == "simulated"

    def test_api_audit_non_compliant(self, client: TestClient, gfw_live) -> None:
        gfw_live.append({"umd_tree_cover_loss__year": 2022, "area__ha": 0.9})
        response = client.post("/api/v1/audit/parcel", json=_audit_payload(DEFORESTED_POLYGON, commodity="cocoa"))
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["status"] == "NON_COMPLIANT"
        assert body["hs_code"] == "1801"
        assert body["satellite"]["loss_year"] == 2022
        assert body["satellite"]["is_probative"] is True
        assert body["satellite"]["evidence"]["dataset_version"] == "v1.13"
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

    def test_export_refused_when_analysis_not_probative(self, client: TestClient) -> None:
        """P0-04 : un dossier non probant ne part pas en déclaration."""
        audit_id = self._create_audit(client, COMPLIANT_POLYGON)
        response = client.post("/api/v1/export/traces", json={"audit_id": audit_id, "format": "json"})
        assert response.status_code == 409, response.text
        assert "probante" in response.json()["detail"] or "analyse" in response.json()["detail"].lower()

    def test_export_refused_in_demo_mode(self, client: TestClient, demo_mode) -> None:
        """Même en démonstration : le résultat simulé n'est pas exportable."""
        audit_id = self._create_audit(client, COMPLIANT_POLYGON)
        response = client.post("/api/v1/export/traces", json={"audit_id": audit_id, "format": "json"})
        assert response.status_code == 409, response.text

    def test_xml_export_is_well_formed_and_complete(self, client: TestClient, gfw_live) -> None:
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

    def test_json_export_non_compliant_flagged(self, client: TestClient, gfw_live) -> None:
        gfw_live.append({"umd_tree_cover_loss__year": 2022, "area__ha": 0.9})
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

    def test_audit_history_listing(self, client: TestClient, gfw_live) -> None:
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
        """9 ha déclarés répartis sur 2 points ⇒ 4,5 ha par point ⇒ polygone requis."""
        bad_points = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"name": "P0"}, "geometry": {"type": "Point", "coordinates": [38.201234, 6.161234]}},
                {"type": "Feature", "properties": {"name": "P1"}, "geometry": {"type": "Point", "coordinates": [38.202234, 6.161234]}},
            ],
        }
        res = validate_geometry(bad_points, declared_area_ha=9.0)
        assert res["valid"] is False
        assert any(e["code"] == "POLYGON_REQUIRED" for e in res["errors"])

    def test_point_area_cannot_be_inflated_by_the_file(self) -> None:
        """P0-03 : une propriété `area_ha` du fichier ne change pas la surface retenue."""
        point = {"type": "Feature", "properties": {"area_ha": 50.0, "name": "Gonflee"},
                 "geometry": {"type": "Point", "coordinates": [38.201234, 6.161234]}}
        res = validate_geometry(point, declared_area_ha=1.0)
        assert res["valid"] is True
        assert res["area_ha"] == 0.0
        assert res["eudr_geometry_rule"] == "POINT_ALLOWED"

    def test_precision_trailing_zeros_measured_on_source_text(self) -> None:
        """P0-05 : `-5.500000` écrit vaut 6 décimales, même si JSON le parse en `-5.5`."""
        # Texte réellement reçu d'un SIG : les zéros de fin sont dans le fichier,
        # json.loads les supprime — d'où la nécessité de mesurer sur le texte.
        raw = (
            '{"type": "Polygon", "coordinates": [['
            "[-5.500000, 5.300000], [-5.490000, 5.300000], "
            "[-5.490000, 5.310000], [-5.500000, 5.310000], "
            "[-5.500000, 5.300000]]]}"
        )
        geojson = json.loads(raw)
        res = validate_geometry(geojson, raw_text=raw)
        assert res["min_decimals_found"] == 6
        assert res["precision_ok"] is True
        assert res["valid"] is True

    def test_six_decimal_geojson_is_accepted(self) -> None:
        """P0-05 : un fichier GeoJSON standard à 6 décimales doit passer."""
        res = validate_geometry(COMPLIANT_POLYGON, raw_text=json.dumps(COMPLIANT_POLYGON))
        assert res["min_decimals_found"] >= 6
        assert res["precision_ok"] is True

    def test_two_decimal_geojson_is_still_rejected(self) -> None:
        """P0-05 ne doit pas ouvrir la porte à des coordonnées grossières."""
        raw = (
            '{"type": "Polygon", "coordinates": [['
            "[-5.50, 5.30], [-5.49, 5.30], [-5.49, 5.31], [-5.50, 5.31], [-5.50, 5.30]]]}"
        )
        coarse = json.loads(raw)
        res = validate_geometry(coarse, raw_text=raw)
        assert res["min_decimals_found"] == 2
        assert res["precision_ok"] is False
        assert any(e["code"] == "INSUFFICIENT_PRECISION" for e in res["errors"])

    def test_precision_is_flagged_when_source_text_is_missing(self) -> None:
        """Sans texte source, la précision est approximée : l'écart est signalé."""
        res = validate_geometry(COMPLIANT_POLYGON)
        assert any(w["code"] == "PRECISION_APPROXIMATED" for w in res["warnings"])

    def test_normalized_geometry_rounded_to_six_decimals(self) -> None:
        """Le SI EUDR tronque à 6 décimales : l'export ne doit pas en revendiquer 8."""
        res = validate_geometry(COMPLIANT_POLYGON, raw_text=json.dumps(COMPLIANT_POLYGON))
        coords = res["normalized_geometry"]["coordinates"]
        flat = coords[0][0] if isinstance(coords[0][0], list) else coords[0]
        for value in flat:
            assert len(str(value).split(".")[-1]) <= 6

# --------------------------------------------------------------------------- 6. P0-04 — Provenance de l'analyse
class TestProvenanceP004:
    """Le verdict ne peut reposer que sur des données réellement mesurées."""

    def test_aucune_source_configuree_ne_rend_aucun_verdict(self) -> None:
        sat = check_deforestation_risk(COMPLIANT_POLYGON, "2024-03-15")
        assert sat["source"] == "unavailable"
        assert sat["is_probative"] is False
        assert sat["compliant"] is None
        assert sat["confidence_score"] is None
        assert sat["evidence"] is None
        assert sat["disclaimer"]

    def test_mode_demonstration_est_simule_et_non_probant(self, demo_mode) -> None:
        sat = check_deforestation_risk(DEFORESTED_POLYGON, "2024-06-01")
        assert sat["source"] == "simulated"
        assert sat["is_probative"] is False
        assert sat["compliant"] is None, "la simulation ne rend pas de verdict"
        assert sat["confidence_score"] is None, "la simulation n'a pas de confiance mesurable"
        assert "non probant" in sat["disclaimer"]

    def test_panne_gfw_ne_replie_jamais_sur_la_simulation(self, monkeypatch) -> None:
        """P0-04 : c'est le cœur du correctif — pas de repli silencieux."""
        saved_enabled, saved_key = settings.gfw_live_enabled, settings.gfw_api_key
        object.__setattr__(settings, "gfw_live_enabled", True)
        object.__setattr__(settings, "gfw_api_key", "cle-invalide")

        def echoue(geometry):
            raise requests.RequestException("GFW HTTP 403 — clé invalide")

        monkeypatch.setattr(satellite_checker, "_gfw_query", echoue)
        try:
            sat = check_deforestation_risk(DEFORESTED_POLYGON, "2024-06-01")
        finally:
            object.__setattr__(settings, "gfw_live_enabled", saved_enabled)
            object.__setattr__(settings, "gfw_api_key", saved_key)

        assert sat["source"] == "unavailable", "la panne ne doit pas produire une simulation"
        assert sat["source"] != "simulated"
        assert sat["compliant"] is None
        assert sat["is_probative"] is False
        assert "403" in sat["details"]

    def test_analyse_probante_porte_une_trace_executable(self, gfw_live) -> None:
        gfw_live.append({"umd_tree_cover_loss__year": 2022, "area__ha": 0.9})
        sat = check_deforestation_risk(DEFORESTED_POLYGON, "2024-06-01")
        assert sat["source"] == "gfw-live"
        assert sat["is_probative"] is True
        assert sat["compliant"] is False
        assert sat["disclaimer"] is None
        assert sat["evidence"]["dataset_version"] == "v1.13"
        assert sat["evidence"]["dataset"] == settings.gfw_dataset
        assert sat["confidence_score"] is not None

    def test_la_provenance_est_conservee_avec_l_audit(self, client: TestClient, gfw_live) -> None:
        response = client.post("/api/v1/audit/parcel", json=_audit_payload(COMPLIANT_POLYGON))
        audit_id = response.json()["audit_id"]
        record = reset_db_for_tests.__globals__["_db_instance"].get_audit(audit_id)
        assert record.analysis_source == "gfw-live"
        assert record.analysis_probative is True
        assert record.analysis_evidence["dataset_version"] == "v1.13"
