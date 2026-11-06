"""Tests de fermeture du backend FastAPI (C5).

⚠️ Ce que ces tests éprouvent, et pourquoi négativement.

    Le défaut corrigé n'était pas « une route renvoie une erreur » mais « une
    route renvoie TOUT, à n'importe qui ». Un test qui vérifie seulement qu'un
    appel autorisé fonctionne ne prouve donc rien : il passerait aussi sur un
    backend ouvert. Chaque test ci-dessous vérifie d'abord que l'accès NON
    autorisé échoue.

⚠️ Les trois réponses ont des sens différents et ne doivent pas être
    confondues :

      503 — aucun jeton configuré. Le service est fermé, l'administrateur doit
            intervenir. Ce n'est pas un refus d'autorisation.
      401 — l'appelant n'a pas envoyé de jeton.
      403 — l'appelant a envoyé un jeton, et il est faux.

    Renvoyer 401 au lieu de 403 ferait réessayer indéfiniment un client dont la
    configuration est fausse.
"""
from __future__ import annotations

import os

os.environ.setdefault("GFW_LIVE_ENABLED", "false")
os.environ["GFW_API_KEY"] = ""
os.environ["GFW_DEMO_MODE"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import reset_db_for_tests  # noqa: E402
from app.main import app  # noqa: E402

JETON = "jeton-de-test-uniquement"


@pytest.fixture(autouse=True)
def _db_vierge():
    reset_db_for_tests(":memory:")
    yield


@pytest.fixture()
def sans_jeton():
    """Backend sans jeton configuré — l'état par défaut d'un déploiement nu."""
    precedent = settings.backend_api_token
    object.__setattr__(settings, "backend_api_token", "")
    yield TestClient(app)
    object.__setattr__(settings, "backend_api_token", precedent)


@pytest.fixture()
def avec_jeton():
    precedent = settings.backend_api_token
    object.__setattr__(settings, "backend_api_token", JETON)
    yield TestClient(app)
    object.__setattr__(settings, "backend_api_token", precedent)


PAYLOAD = {
    "commodity": "cocoa",
    "harvest_date": "2024-11-15",
    "geojson": {"type": "Point", "coordinates": [-0.19, 5.6]},
    "operator": {"name": "Coopérative Test", "eori": "FR123456789", "country": "FR"},
}


# --------------------------------------------------------------------------- 1
class TestFermeParDefaut:
    """⚠️ Le cas le plus important : un backend nu ne doit RIEN servir."""

    def test_sans_jeton_configure_le_metier_repond_503(self, sans_jeton: TestClient) -> None:
        reponse = sans_jeton.post("/api/v1/audit/parcel", json=PAYLOAD)
        assert reponse.status_code == 503
        assert "BACKEND_API_TOKEN" in reponse.json()["detail"]

    def test_sans_jeton_configure_l_export_repond_503(self, sans_jeton: TestClient) -> None:
        reponse = sans_jeton.post("/api/v1/export/traces", json={"audit_id": "x"})
        assert reponse.status_code == 503

    def test_la_sonde_health_reste_ouverte(self, sans_jeton: TestClient) -> None:
        """⚠️ Une sonde doit répondre même mal configurée : sinon un
        orchestrateur redémarre en boucle un service qui tourne."""
        reponse = sans_jeton.get("/api/v1/health")
        assert reponse.status_code == 200
        assert reponse.json()["status"] == "ok"


# --------------------------------------------------------------------------- 2
class TestJetonRequis:
    def test_sans_entete_authorization_repond_401(self, avec_jeton: TestClient) -> None:
        reponse = avec_jeton.post("/api/v1/audit/parcel", json=PAYLOAD)
        assert reponse.status_code == 401
        assert "Bearer" in reponse.json()["detail"]

    def test_mauvais_schema_repond_401(self, avec_jeton: TestClient) -> None:
        reponse = avec_jeton.post(
            "/api/v1/audit/parcel", json=PAYLOAD, headers={"Authorization": f"Basic {JETON}"}
        )
        assert reponse.status_code == 401

    def test_jeton_faux_repond_403(self, avec_jeton: TestClient) -> None:
        """⚠️ 403 et non 401 : le client a bien envoyé un jeton. Répondre 401
        le ferait réessayer indéfiniment avec le même jeton faux."""
        reponse = avec_jeton.post(
            "/api/v1/audit/parcel", json=PAYLOAD, headers={"Authorization": "Bearer faux"}
        )
        assert reponse.status_code == 403

    def test_jeton_valide_passe(self, avec_jeton: TestClient) -> None:
        reponse = avec_jeton.post(
            "/api/v1/audit/parcel", json=PAYLOAD, headers={"Authorization": f"Bearer {JETON}"}
        )
        assert reponse.status_code not in (401, 403, 503)

    def test_le_jeton_n_est_pas_comparable_par_prefixe(self, avec_jeton: TestClient) -> None:
        """⚠️ Une comparaison naïve accepterait un jeton valide suivi d'octets
        superflus, ou laisserait fuir le préfixe correct par le temps de
        réponse. On vérifie ici qu'aucune troncature ne passe."""
        for essai in (JETON[:5], JETON + "x", JETON[:-1], JETON.upper()):
            reponse = avec_jeton.post(
                "/api/v1/audit/parcel", json=PAYLOAD, headers={"Authorization": f"Bearer {essai}"}
            )
            assert reponse.status_code == 403, essai


# --------------------------------------------------------------------------- 3
class TestRoutesInterTenant:
    """⚠️ La fuite principale : `GET /audits` listait tous les dossiers."""

    def test_la_liste_des_audits_est_fermee_meme_avec_un_jeton_valide(
        self, avec_jeton: TestClient
    ) -> None:
        reponse = avec_jeton.get("/api/v1/audits", headers={"Authorization": f"Bearer {JETON}"})
        assert reponse.status_code == 410
        assert "organisation" in reponse.json()["detail"]

    def test_la_liste_des_audits_ne_fuit_aucune_donnee(self, avec_jeton: TestClient) -> None:
        """⚠️ Un 410 qui contiendrait quand même la liste serait pire que rien."""
        reponse = avec_jeton.get("/api/v1/audits", headers={"Authorization": f"Bearer {JETON}"})
        assert isinstance(reponse.json(), dict)
        assert "audit_id" not in reponse.text


# --------------------------------------------------------------------------- 4
class TestSurfaceExposee:
    def test_la_documentation_est_fermee_par_defaut(self) -> None:
        """⚠️ La documentation interactive décrivait au passant comment
        interroger un backend qui n'authentifiait personne."""
        client = TestClient(app)
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404

    def test_le_joker_cors_n_est_pas_honore(self) -> None:
        """⚠️ `allow_origins=["*"]` avec `allow_credentials=True` autorisait
        n'importe quelle origine à lire les réponses. Le joker est écarté, et
        le retirer de la configuration ne suffit pas : il doit être ignoré."""
        assert "*" not in settings.cors_valides
        precedent = settings.cors_origins
        object.__setattr__(settings, "cors_origins", ["*", "https://exemple.fr"])
        try:
            assert settings.cors_valides == ["https://exemple.fr"]
        finally:
            object.__setattr__(settings, "cors_origins", precedent)
