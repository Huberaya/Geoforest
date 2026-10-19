"""Tests de l'authentification du backend FastAPI.

⚠️ Ce que ces tests couvrent : le service ne répond plus aux données sans
jeton, et échoue **fermé** si le jeton n'est pas configuré. Ce qu'ils ne
couvrent pas : le cloisonnement inter-organisations, que ce backend
mono-tenant ne sait pas assurer (cf. rapport d'audit).
"""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, settings
from app.main import app

JETON = os.environ["GF_BACKEND_TOKEN"]


def test_health_reste_public() -> None:
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200


def test_donnees_refusees_sans_jeton() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/audits")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert "detail" in response.json()


def test_donnees_refusees_avec_un_mauvais_jeton() -> None:
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/audits", headers={"Authorization": "Bearer mauvais-jeton"}
        )
    assert response.status_code == 401


def test_donnees_acceptees_avec_le_jeton() -> None:
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/audits", headers={"Authorization": f"Bearer {JETON}"}
        )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_service_ferme_si_jeton_non_configure() -> None:
    object.__setattr__(settings, "backend_token", "")
    try:
        with TestClient(app) as client:
            response = client.get("/api/v1/audits")
        assert response.status_code == 503
        assert "GF_BACKEND_TOKEN" in response.json()["detail"]
    finally:
        object.__setattr__(settings, "backend_token", JETON)


def test_origine_wildcard_refusee(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "*")
    with pytest.raises(ValueError):
        Settings()


# ---------------------------------------------------------------------------
# Tests négatifs complémentaires (phase B2)
# ---------------------------------------------------------------------------


def test_documentation_fermee_par_defaut() -> None:
    """`/docs`, `/redoc` et le schéma OpenAPI ne sont pas exposés sans demande."""
    assert settings.docs_publiques is False
    with TestClient(app) as client:
        for chemin in ("/docs", "/redoc", "/openapi.json"):
            assert client.get(chemin).status_code == 404, chemin


def test_documentation_ouvrable_par_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GF_BACKEND_DOCS", "on")
    assert Settings().docs_publiques is True


def test_methode_interdite_sur_une_route_de_donnees() -> None:
    """`PUT` et `DELETE` n'existent pas : 405, jamais 200 ni 401 trompeur."""
    with TestClient(app) as client:
        for methode in ("put", "delete", "patch"):
            response = getattr(client, methode)(
                "/api/v1/audits", headers={"Authorization": f"Bearer {JETON}"}
            )
            assert response.status_code == 405, methode
            # `Allow` indique ce qui est réellement permis, sans dévoiler d'interne.
            assert "GET" in response.headers.get("allow", "")


def test_route_inconnue_ne_divulgue_rien() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/inconnue")
    assert response.status_code == 404
    corps = response.text
    assert "Traceback" not in corps
    assert "sqlite" not in corps.lower()
    assert str(settings.database_path) not in corps


def test_erreur_de_jeton_sans_detail_interne() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/audits", headers={"Authorization": "Bearer faux"})
    corps = response.text
    assert response.status_code == 401
    assert "Traceback" not in corps
    assert "hmac" not in corps
    assert JETON not in corps


def test_preflight_refuse_pour_une_origine_non_declaree() -> None:
    with TestClient(app) as client:
        response = client.options(
            "/api/v1/audits",
            headers={
                "Origin": "https://attaquant.exemple",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
    assert "access-control-allow-origin" not in {k.lower() for k in response.headers}


def test_preflight_accepte_pour_l_origine_declaree() -> None:
    origine = settings.cors_origins[0]
    with TestClient(app) as client:
        response = client.options(
            "/api/v1/audits",
            headers={
                "Origin": origine,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
    assert response.status_code in (200, 204)
    assert response.headers.get("access-control-allow-origin") == origine
    autorisees = response.headers.get("access-control-allow-methods", "")
    assert "DELETE" not in autorisees
    assert "PUT" not in autorisees


def test_health_ne_donne_acces_a_aucune_donnee() -> None:
    with TestClient(app) as client:
        réponse = client.get("/health")
    assert réponse.status_code == 200
    corps = réponse.json()
    assert set(corps) == {"status", "service", "version"}
