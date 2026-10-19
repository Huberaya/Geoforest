"""Tests du moteur géospatial multi-sources et connecteurs satellites (Chantier 4).

⚠️ Ces tests décrivent un moteur **absent de ce commit** : les routes
`/api/v1/geospatial/sources` et `/api/v1/geospatial/analyze` ne sont pas
implémentées (404). Ils sont marqués `xfail(strict=True)` plutôt que supprimés,
afin que l'écart reste visible et qu'une implémentation future les fasse
échouer explicitement (XPASS strict) au lieu de passer inaperçue.

    Ne pas implémenter ces routes pour faire passer ces tests : leurs attentes
    supposent en outre qu'une analyse **simulée** rende un verdict
    `compliant: true`, ce qui contredit la règle P0-04 (aucun verdict sans
    donnée réellement mesurée). La spécification du moteur multi-sources et les
    identifiants d'accès aux fournisseurs doivent être fournis avant toute
    implémentation.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

pytestmark = pytest.mark.xfail(
    strict=True,
    reason=(
        "Endpoints /api/v1/geospatial/* absents de ce commit ; les attentes "
        "supposent en outre un verdict de conformité simulé, contraire à P0-04."
    ),
)

client = TestClient(app)


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
