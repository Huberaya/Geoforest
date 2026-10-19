"""Tests du moteur géospatial multi-sources et connecteurs satellites (Chantier 4)."""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# P0 (recette 2026-10-08) — FONCTIONNALITÉ NON LIVRÉE, PAS UNE RÉGRESSION.
# Ces tests visent un moteur géospatial multi-sources (catalogue /api/v1/geospatial/*)
# qui n'existe pas dans ce dépôt : les routes renvoient 404. Ils sont marqués
# `xfail(strict=True)` pour que l'absence soit visible dans la suite sans être
# masquée. Quand la fonctionnalité sera livrée, ces tests passeront en XPASS et
# le marqueur devra être retiré (strict=True fait alors échouer la suite).
GEO_NON_LIVRE = pytest.mark.xfail(
    strict=True,
    reason="Moteur géospatial multi-sources non livré : /api/v1/geospatial/* absent (404).",
)


@GEO_NON_LIVRE
def test_geospatial_sources_catalog():
    response = client.get("/api/v1/geospatial/sources")
    assert response.status_code == 200
    sources = response.json()
    assert len(sources) >= 4
    source_ids = [s["id"] for s in sources]
    assert "hansen_umd_gfw" in source_ids
    assert "sentinel_2_msi" in source_ids
    assert "esa_worldcover" in source_ids


@GEO_NON_LIVRE
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


@GEO_NON_LIVRE
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
