"""Réponses Global Forest Watch dégradées, vides ou hors couverture.

⚠️ Aucun appel réseau n'est effectué : `requests.post` est remplacé par une
réponse locale. Ces tests prouvent le **comportement du logiciel** face à une
charge utile donnée. Ils ne prouvent ni la disponibilité, ni la qualité, ni la
couverture réelle du service Global Forest Watch.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import reset_db_for_tests
from app.main import app
from app.services import satellite_checker
from app.services.satellite_checker import (
    LIMITE_BENCHMARK_PAYS,
    LIMITE_REPONSE_VIDE,
    LIMITE_VERSION_NON_EPINGLEE,
    check_deforestation_risk,
)

POLY: Dict[str, Any] = {
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

OPERATOR = {"name": "Café Import SAS", "eori": "FR12345678901234", "country": "FR"}


class FakeResponse:
    """Réponse HTTP minimale, sans réseau."""

    def __init__(self, payload: Any = None, *, status: int = 200, body: Optional[str] = None) -> None:
        self._payload = payload
        self.status_code = status
        self.ok = 200 <= status < 300
        self.text = body if body is not None else json.dumps(payload)
        self.url = "https://data-api.globalforestwatch.org/dataset/umd_tree_cover_loss/latest/query/json"

    def json(self) -> Any:
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


@pytest.fixture(autouse=True)
def _fresh_db() -> None:
    reset_db_for_tests(":memory:")


@pytest.fixture()
def gfw_actif(monkeypatch: pytest.MonkeyPatch):
    """Active un accès GFW simulé ; aucune clé réelle, aucun appel sortant."""
    saved = (
        settings.gfw_live_enabled,
        settings.gfw_api_key,
        settings.gfw_api_url,
        settings.gfw_dataset_version,
        settings.gfw_demo_mode,
    )
    object.__setattr__(settings, "gfw_live_enabled", True)
    object.__setattr__(settings, "gfw_api_key", "cle-de-test-locale-jamais-reelle")
    object.__setattr__(settings, "gfw_demo_mode", False)
    yield
    for name, value in zip(
        ("gfw_live_enabled", "gfw_api_key", "gfw_api_url", "gfw_dataset_version", "gfw_demo_mode"),
        saved,
    ):
        object.__setattr__(settings, name, value)


def _repond(monkeypatch: pytest.MonkeyPatch, response: FakeResponse) -> None:
    monkeypatch.setattr(satellite_checker.requests, "post", lambda *a, **k: response)


# --------------------------------------------------------------------------- Charges utiles
CAS_MALFORMES: List[tuple[str, Any]] = [
    ("data = null", {"data": None}),
    ("data absent", {"statut": "ok"}),
    ("payload = liste", [1, 2]),
    ("data = objet", {"data": {"rows": []}}),
    ("ligne sans année", {"data": [{"area__ha": 2}]}),
    ("année 2022 sans surface", {"data": [{"umd_tree_cover_loss__year": 2022, "area__ha": None}]}),
    ("surface négative", {"data": [{"umd_tree_cover_loss__year": 2022, "area__ha": -3}]}),
    ("année non numérique", {"data": [{"umd_tree_cover_loss__year": "vingt-deux", "area__ha": 2}]}),
]


class TestChargesUtilesMalformees:
    @pytest.mark.parametrize("label,payload", CAS_MALFORMES, ids=[c[0] for c in CAS_MALFORMES])
    def test_aucun_verdict_sur_une_reponse_malformee(
        self, gfw_actif, monkeypatch: pytest.MonkeyPatch, label: str, payload: Any
    ) -> None:
        _repond(monkeypatch, FakeResponse(payload))
        result = check_deforestation_risk(POLY, "2024-06-01")

        assert result["source"] == "unavailable", label
        assert result["compliant"] is None, f"{label} : un verdict a été fabriqué"
        assert result["is_probative"] is False
        assert result["evidence"] is None
        assert result["loss_area_ha"] == 0.0

    def test_corps_non_json(self, gfw_actif, monkeypatch: pytest.MonkeyPatch) -> None:
        _repond(monkeypatch, FakeResponse(body="<html>maintenance</html>"))
        result = check_deforestation_risk(POLY, "2024-06-01")
        assert result["source"] == "unavailable"
        assert result["compliant"] is None

    def test_erreur_http(self, gfw_actif, monkeypatch: pytest.MonkeyPatch) -> None:
        _repond(monkeypatch, FakeResponse({"detail": "quota"}, status=429))
        result = check_deforestation_risk(POLY, "2024-06-01")
        assert result["source"] == "unavailable"
        assert result["compliant"] is None
        assert "429" in result["details"]


class TestReponseVide:
    def test_reponse_vide_est_une_observation_negative_documentee(
        self, gfw_actif, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Un tableau vide est un fait du fournisseur, pas une preuve de couverture.

        Le verdict négatif est conservé (c'est la réponse normale d'un jeu de
        données sans perte), mais la limite de couverture est consignée avec le
        résultat, et la version non épinglée est signalée.
        """
        _repond(monkeypatch, FakeResponse({"data": []}))
        result = check_deforestation_risk(POLY, "2024-06-01")

        assert result["compliant"] is True
        assert result["loss_area_ha"] == 0.0
        assert result["is_probative"] is True
        assert LIMITE_REPONSE_VIDE in result["provenance"]["limits"]
        assert LIMITE_VERSION_NON_EPINGLEE in result["provenance"]["limits"]
        assert "aucune ligne de perte retournée" in result["details"]

    def test_perte_valide_reste_non_conforme(self, gfw_actif, monkeypatch: pytest.MonkeyPatch) -> None:
        _repond(
            monkeypatch,
            FakeResponse({"data": [{"umd_tree_cover_loss__year": 2022, "area__ha": 0.9}]}),
        )
        result = check_deforestation_risk(POLY, "2024-06-01")
        assert result["compliant"] is False
        assert result["loss_year"] == 2022
        assert result["loss_area_ha"] == 0.9
        assert result["risk_level"] == "HIGH"
        # Trace : les paramètres qui ont produit le verdict sont consignés.
        assert result["provenance"]["params"]["date_recolte"] == "2024-06-01"
        assert result["provenance"]["params"]["date_butoir"] == "2020-12-31"
        assert result["provenance"]["params"]["surface_analysee_ha"] > 0

    def test_version_epinglee_pas_de_limite_de_version(
        self, gfw_actif, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        object.__setattr__(settings, "gfw_dataset_version", "v1.13")
        response = FakeResponse({"data": []})
        # L'URL finale porte la version réellement servie.
        response.url = "https://data-api.globalforestwatch.org/dataset/umd_tree_cover_loss/v1.13/query/json"
        _repond(monkeypatch, response)
        result = check_deforestation_risk(POLY, "2024-06-01")
        assert result["evidence"]["dataset_version"] == "v1.13"
        assert LIMITE_VERSION_NON_EPINGLEE not in result["provenance"]["limits"]


class TestProvenanceFournisseur:
    def test_hote_non_officiel_nomme_pour_ce_qu_il_est(
        self, gfw_actif, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        object.__setattr__(settings, "gfw_api_url", "https://cache-interne.exemple.invalid")
        _repond(monkeypatch, FakeResponse({"data": []}))
        result = check_deforestation_risk(POLY, "2024-06-01")

        assert result["evidence"]["is_official_source"] is False
        assert result["evidence"]["provider"].startswith("Service configuré")
        assert "Global Forest Watch" not in result["evidence"]["provider"].split("—")[0]

    def test_hote_officiel_reconnu(self, gfw_actif, monkeypatch: pytest.MonkeyPatch) -> None:
        _repond(monkeypatch, FakeResponse({"data": []}))
        result = check_deforestation_risk(POLY, "2024-06-01")
        assert result["evidence"]["is_official_source"] is True
        assert result["evidence"]["provider"].startswith("Global Forest Watch")


class TestAbsenceDeSource:
    def test_collection_vide_n_est_pas_analysee_au_large_du_golfe_guineen(self) -> None:
        """Avant correctif : `unary_union([])` → disque autour de (0, 0)."""
        result = check_deforestation_risk({"type": "FeatureCollection", "features": []}, "2024-06-01")
        assert result["source"] == "unavailable"
        assert result["compliant"] is None
        assert "sans géométrie exploitable" in result["details"]

    def test_aucun_risque_faible_sans_preuve(self) -> None:
        """Un dossier parisien sans source ne doit pas afficher « risque faible ».

        Le benchmark de la boîte « Union européenne » vaut LOW ; le niveau
        retenu pour l'audit ne peut pas l'être sans analyse probante.
        """
        object.__setattr__(settings, "gfw_live_enabled", False)
        object.__setattr__(settings, "gfw_demo_mode", False)
        paris = {
            "type": "Polygon",
            "coordinates": [[
                [2.301234, 48.851234], [2.302234, 48.851234],
                [2.302234, 48.852234], [2.301234, 48.852234], [2.301234, 48.851234],
            ]],
        }
        result = check_deforestation_risk(paris, "2024-06-01")
        assert result["compliant"] is None
        assert result["country_risk"] == "LOW"  # benchmark brut, informatif
        assert result["risk_level"] == "STANDARD"  # plancher, jamais LOW
        assert LIMITE_BENCHMARK_PAYS in result["provenance"]["limits"]
        assert result["provenance"]["params"]["benchmark_pays"]["verified"] is False


class TestApiAuditsNonProbants:
    def test_un_dossier_indisponible_reste_listable(self) -> None:
        """Régression : `compliant: bool` requis faisait échouer GET /audits (500)."""
        client = TestClient(app)
        creation = client.post(
            "/api/v1/audit/parcel",
            json={
                "geojson": POLY,
                "commodity": "coffee",
                "harvest_date": "2024-03-15",
                "operator": OPERATOR,
            },
        )
        assert creation.status_code == 201, creation.text
        assert creation.json()["status"] == "ANALYSIS_UNAVAILABLE"

        listing = client.get("/api/v1/audits")
        assert listing.status_code == 200, listing.text
        assert listing.json()[0]["compliant"] is None


class TestGeometrieEnvoyee:
    def test_analyse_porte_sur_la_geometrie_normalisee(
        self, gfw_actif, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """La géométrie analysée est celle qui a été validée, arrondie à 6 décimales.

        Avant correctif, l'endpoint transmettait le fichier brut au moteur : la
        géométrie auditée pouvait différer de la géométrie enregistrée, et
        dépasser la précision que le SI EUDR sait lire.
        """
        capture: Dict[str, Any] = {}

        def faux_post(url, headers=None, data=None, timeout=None):
            capture["payload"] = json.loads(data)
            return FakeResponse({"data": []})

        monkeypatch.setattr(satellite_checker.requests, "post", faux_post)
        client = TestClient(app)
        geo = {
            "type": "Polygon",
            "coordinates": [[
                [38.20123456, 6.16123456],
                [38.20233456, 6.16123456],
                [38.20233456, 6.16233456],
                [38.20123456, 6.16233456],
                [38.20123456, 6.16123456],
            ]],
        }
        response = client.post(
            "/api/v1/audit/parcel",
            json={
                "geojson": geo,
                "commodity": "coffee",
                "harvest_date": "2024-03-15",
                "operator": OPERATOR,
            },
        )
        assert response.status_code == 201, response.text

        import re

        envoye = json.dumps(capture["payload"]["geometry"])
        decimales = max((len(m) - 1 for m in re.findall(r"\.\d+", envoye)), default=0)
        assert decimales <= 6, envoye


class TestExportTrace:
    def test_verdict_absent_exporte_comme_non_verifie(self) -> None:
        """`compliant = None` ne doit jamais devenir « non conforme » dans la trace."""
        from app.models.sql_models import ParcelAuditRecord
        from app.services.traces_exporter import export_traces_json

        record = ParcelAuditRecord(
            id="11111111-1111-1111-1111-111111111111",
            created_at="2026-10-19T12:00:00+00:00",
            operator_name="Opérateur test",
            operator_eori="FR12345678901234",
            commodity="coffee",
            hs_code="0901",
            harvest_date="2024-03-15",
            geometry=POLY,
            geometry_type="Polygon",
            area_ha=6.0,
            vertex_count=5,
            centroid_lon=38.2018,
            centroid_lat=6.1618,
            country_code="CI",
            country_risk="STANDARD",
            compliant=None,
            loss_year=None,
            confidence_score=None,
            risk_level="STANDARD",
            status="ANALYSIS_UNAVAILABLE",
            validation={"eudr_geometry_rule": "POINT_ALLOWED"},
        )
        payload = export_traces_json(
            record,
            {"name": "Opérateur test", "eori": "FR12345678901234", "country": "FR"},
            {},
        )
        verification = payload["verification"]
        assert verification["status"] == "NOT_VERIFIED"
        assert verification["deforestation_detected_post_cutoff"] is None
        # Règle des 4 ha : reprise de la validation, pas recalculée sur 6 ha.
        assert verification["geometry_rule"] == "POINT_ALLOWED"
