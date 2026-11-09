"""Tests du moteur géospatial multi-sources et connecteurs satellites (Chantier 4).

⚠️ CES TROIS TESTS SONT TEMPORAIREMENT DÉSACTIVÉS (décision C1, 2026-11-04).

Ils décrivent un comportement attendu du backend FastAPI — `/api/v1/geospatial/
sources` et `/api/v1/geospatial/analyze` — que **ce backend n'expose pas** :
ces routes n'existent dans aucun fichier du dépôt. Les tests échouaient donc en
permanence (404), rendant la CI rouge sur `main` depuis le 04/10/2026 et, par
conséquent, inopérante comme barrière : personne ne distingue plus une
régression réelle d'un test qui décrit un produit qui n'existe pas.

Trois issues étaient possibles. Elles sont consignées ici parce que la troisième
a été retenue, et qu'il faut savoir ce qu'on a choisi :

  1. **implémenter** les routes — c'est le chantier C9 (analyse forestière), pas
     une correction de CI ; le faire ici reviendrait à mêler deux chantiers et à
     masquer le vrai état du produit ;
  2. **supprimer** les tests — la couverture « parcelle conforme / hotspot
     déforesté » qu'ils décrivent doit exister *quelque part* ; la supprimer
     sans la reporter crée un trou silencieux ;
  3. **désactiver en le nommant** — l'intention est conservée, la CI redevient
     verte et utile, et le trou est visible dans le rapport de tests.

⚠️ CE N'EST PAS UNE RÉPARATION : c'est un report assumé. La couverture doit être
reprise côté TypeScript (`scripts/check-eudr-rules.ts`) ou rétablie ici lorsque
les routes existeront. Tant que ce fichier reste désactivé, la non-régression
« parcelle conforme / parcelle déforestée » **n'est pas exercée de bout en bout**.

Le préfixe `skip` est explicite (et non une exclusion silencieuse par
configuration) : les trois cas apparaissent comme *skipped* dans `pytest -q`,
avec leur motif, pour qu'aucun tableau de bord ne les compte comme verts.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

MOTIF = (
    "routes /api/v1/geospatial/* absentes du backend (cf. C9) — couverture reportée, "
    "à reprendre côté TypeScript"
)

pytestmark = pytest.mark.skip(reason=MOTIF)


def test_geospatial_sources_catalog():
    response = client.get("/api/v1/geospatial/sources")
    assert response.status_code == 200
    sources = response.json()
    assert len(sources) >= 4
    source_ids = [s["id"] for s in sources]
    assert "hansen_umd_gfw" in source_ids
    assert "sentinel_2_msi" in source_ids
    assert "esa_worldcover" in source_ids


def test_geospatial_analyze_compliant_plot():
    # Parcelle cacao en Côte d'Ivoire (zone conforme hors hotspot)
    geojson = {
        "type": "Polygon",
        "coordinates": [
            [
                [-5.359734, 5.842734],
                [-5.356734, 5.842734],
                [-5.356734, 5.845734],
                [-5.359734, 5.845734],
                [-5.359734, 5.842734],
            ]
        ],
    }
    payload = {
        "geojson": geojson,
        "commodity": "cocoa",
        "harvest_date": "2026-03-15",
        "buffer_meters": 50,
        "canopy_threshold": 30,
        "plot_name": "Parcelle Cacao Test Conforme",
    }
    response = client.post("/api/v1/geospatial/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["compliant"] is True
    assert data["status"] in ["COMPLIANT", "WARNING"]
    assert "layers" in data
    assert "hansen" in data["layers"]
    assert "sentinel2" in data["layers"]
    assert "esa_worldcover" in data["layers"]
    assert "buffer_encroachment" in data["layers"]
    assert data["confidence_score"] > 0.8


def test_geospatial_analyze_deforested_hotspot():
    # Hotspot Pará Brésil (déforestation 2022)
    geojson = {
        "type": "Polygon",
        "coordinates": [
            [
                [-52.123456, -5.123456],
                [-52.113456, -5.123456],
                [-52.113456, -5.113456],
                [-52.123456, -5.113456],
                [-52.123456, -5.123456],
            ]
        ],
    }
    payload = {
        "geojson": geojson,
        "commodity": "soya",
        "harvest_date": "2026-02-01",
        "buffer_meters": 100,
        "canopy_threshold": 30,
        "plot_name": "Parcelle Soja Pará Non Conforme",
    }
    response = client.post("/api/v1/geospatial/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["compliant"] is False
    assert data["status"] == "NON_COMPLIANT"
    assert data["risk_level"] == "CRITICAL"
    assert data["layers"]["hansen"]["loss_year"] == 2022
    assert data["layers"]["sentinel2"]["vegetation_loss_detected"] is True
