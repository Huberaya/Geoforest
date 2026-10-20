"""Authentification du service FastAPI (P0 — recette du 2026-10-08).

Règle verrouillée : les routes d'analyse, de consultation et d'export ne
répondent jamais sans jeton valide ; sans jeton configuré, elles sont fermées.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
PROTEGEES = [
    ("get", "/api/v1/audits", None),
    ("get", "/api/v1/audits/00000000-0000-0000-0000-000000000000", None),
    ("post", "/api/v1/export/traces", {"audit_id": "00000000-0000-0000-0000-000000000000"}),
]
JETON = "jeton-de-test-" + "x" * 24


def _appel(methode, chemin, corps, headers=None):
    if methode == "get":
        return client.get(chemin, headers=headers or {})
    return client.post(chemin, json=corps, headers=headers or {})


@pytest.mark.parametrize("methode,chemin,corps", PROTEGEES)
def test_sans_jeton_configure_le_service_est_ferme(monkeypatch, methode, chemin, corps):
    monkeypatch.delenv("GF_BACKEND_API_TOKEN", raising=False)
    r = _appel(methode, chemin, corps, {"Authorization": "Bearer nimporte-quoi"})
    assert r.status_code == 503


@pytest.mark.parametrize("methode,chemin,corps", PROTEGEES)
def test_sans_en_tete_refus(monkeypatch, methode, chemin, corps):
    monkeypatch.setenv("GF_BACKEND_API_TOKEN", JETON)
    assert _appel(methode, chemin, corps).status_code == 401


@pytest.mark.parametrize("methode,chemin,corps", PROTEGEES)
def test_mauvais_jeton_refus(monkeypatch, methode, chemin, corps):
    monkeypatch.setenv("GF_BACKEND_API_TOKEN", JETON)
    assert _appel(methode, chemin, corps, {"Authorization": "Bearer autre-jeton"}).status_code == 401


@pytest.mark.parametrize("methode,chemin,corps", PROTEGEES)
def test_schema_Basic_refuse(monkeypatch, methode, chemin, corps):
    monkeypatch.setenv("GF_BACKEND_API_TOKEN", JETON)
    assert _appel(methode, chemin, corps, {"Authorization": f"Basic {JETON}"}).status_code == 401


def test_jeton_correct_franchit_la_garde(monkeypatch):
    monkeypatch.setenv("GF_BACKEND_API_TOKEN", JETON)
    r = client.get("/api/v1/audits", headers={"Authorization": f"Bearer {JETON}"})
    # Le jeton est accepté : la réponse ne peut plus être 401 ni 503.
    assert r.status_code not in (401, 503)


def test_sante_reste_publique():
    assert client.get("/health").status_code == 200
