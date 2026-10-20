"""Cloisonnement inter-organisations du service FastAPI (B-8, chantier 2).

Constat, mesuré le 14/10/2026 : ce service n'a **aucune notion d'organisation**.
Sa base (SQLite) n'a pas de colonne d'organisation, et un seul jeton partagé
(`GF_BACKEND_API_TOKEN`) ouvre toutes les routes. Le produit Next.js ne l'appelle
pas (le navigateur ne l'atteint pas ; cf. next.config.ts), mais docker-compose
publie son port 8000 : tant que ce n'est pas tranché, il n'est pas cloisonné.

Les tests décrivent la propriété attendue. Ils sont marqués `xfail(strict=True)` :
la lacune reste visible dans la suite, et un test qui passerait (XPASS) fait
échouer la suite — ce qui obligera à retirer le marqueur au moment de livrer
l'isolation.

Garde-fou contre le vacuum : les analyses sont **créées** dans le test, et chaque
assertion exige la présence de données. Une liste vide ne prouve rien.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
JETON = "jeton-de-test-" + "x" * 24

CLOISONNEMENT_NON_LIVRE = pytest.mark.xfail(
    strict=True,
    reason=(
        "Service FastAPI sans notion d'organisation : base partagée, jeton unique. "
        "Aucune isolation entre tenants. Hors chemin produit, mais port 8000 publié "
        "par docker-compose. Décision à prendre : retirer du déploiement ou cloisonner."
    ),
)

ENTETES = {"Authorization": f"Bearer {JETON}"}


def _polygone(lon: float, lat: float) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [lon, lat],
                [round(lon + 0.01, 6), lat],
                [round(lon + 0.01, 6), round(lat + 0.01, 6)],
                [lon, round(lat + 0.01, 6)],
                [lon, lat],
            ]
        ],
    }


def _creer_analyse(monkeypatch, lon: float, lat: float, reference: str) -> str:
    monkeypatch.setenv("GF_BACKEND_API_TOKEN", JETON)
    corps = {
        "geojson": _polygone(lon, lat),
        "commodity": "cocoa",
        "harvest_date": "2025-03-01",
        "plot_name": reference,
        "buffer_meters": 100,
        "canopy_threshold": 30,
    }
    reponse = client.post("/api/v1/audit/parcel", json=corps, headers=ENTETES)
    assert reponse.status_code == 201, reponse.text
    return reponse.json()["audit_id"]


@pytest.fixture
def deux_analyses(monkeypatch):
    """Deux analyses distinctes, créées par l'API : sans elles, les tests seraient vacueux."""
    a = _creer_analyse(monkeypatch, -4.123457, 6.123457, "XT-PARCELLE-A")
    b = _creer_analyse(monkeypatch, -3.523457, 5.523457, "XT-PARCELLE-B")
    assert a != b
    return a, b


@CLOISONNEMENT_NON_LIVRE
def test_audits_portent_leur_organisation(monkeypatch, deux_analyses):
    monkeypatch.setenv("GF_BACKEND_API_TOKEN", JETON)
    reponse = client.get("/api/v1/audits", headers=ENTETES)
    assert reponse.status_code == 200
    audits = reponse.json()
    # Données présentes (non vacueux) et chaque analyse porte son organisation.
    assert len(audits) >= 2
    assert all("organization_id" in a for a in audits)


@CLOISONNEMENT_NON_LIVRE
def test_organisation_non_identifiee_ne_recoit_pas_les_analyses(monkeypatch, deux_analyses):
    monkeypatch.setenv("GF_BACKEND_API_TOKEN", JETON)
    # Une organisation qui n'a rien créé ne doit voir aucune analyse.
    entetes = {**ENTETES, "X-Organization-Id": "00000000-0000-4000-8000-00000000abcd"}
    reponse = client.get("/api/v1/audits", headers=entetes)
    assert reponse.status_code == 200
    # Précondition vérifiée : les analyses existent bien (sinon le test ne prouve rien).
    assert len(client.get("/api/v1/audits", headers=ENTETES).json()) >= 2
    assert reponse.json() == []
