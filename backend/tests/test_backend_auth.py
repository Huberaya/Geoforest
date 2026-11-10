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
def test_sans_jeton_configure_le_service_est_ferme(fixer_jeton_backend, methode, chemin, corps):
    fixer_jeton_backend("")
    r = _appel(methode, chemin, corps, {"Authorization": "Bearer nimporte-quoi"})
    assert r.status_code == 503


@pytest.mark.parametrize("methode,chemin,corps", PROTEGEES)
def test_sans_en_tete_refus(fixer_jeton_backend, methode, chemin, corps):
    fixer_jeton_backend(JETON)
    assert _appel(methode, chemin, corps).status_code == 401


@pytest.mark.parametrize("methode,chemin,corps", PROTEGEES)
def test_mauvais_jeton_refus(fixer_jeton_backend, methode, chemin, corps):
    fixer_jeton_backend(JETON)
    # 403 et non 401 (convention C5 de `main`) : un jeton a bien été envoyé, il est faux.
    assert _appel(methode, chemin, corps, {"Authorization": "Bearer autre-jeton"}).status_code == 403


@pytest.mark.parametrize("methode,chemin,corps", PROTEGEES)
def test_schema_Basic_refuse(fixer_jeton_backend, methode, chemin, corps):
    fixer_jeton_backend(JETON)
    assert _appel(methode, chemin, corps, {"Authorization": f"Basic {JETON}"}).status_code == 401


def test_jeton_correct_franchit_la_garde(fixer_jeton_backend):
    fixer_jeton_backend(JETON)
    r = client.get("/api/v1/audits/00000000-0000-0000-0000-000000000000", headers={"Authorization": f"Bearer {JETON}"})
    # Le jeton est accepté : la réponse ne peut plus être 401, 403 ni 503
    # (404 : le dossier n'existe pas, la garde est franchie).
    assert r.status_code not in (401, 403, 503)
    # La liste reste fermée même avec un jeton valide (C5 : route inter-tenant → 410).
    assert client.get("/api/v1/audits", headers={"Authorization": f"Bearer {JETON}"}).status_code == 410


def test_sante_reste_publique():
    assert client.get("/health").status_code == 200
