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
