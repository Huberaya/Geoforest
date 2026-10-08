"""Garde-fous du vérificateur satellite (P0 — recette du 2026-10-08).

Ces tests ne touchent aucun réseau : la requête GFW est remplacée.
Ils verrouillent trois règles :
  - toute perte post-2020 détectée est non conforme (aucun seuil de tolérance) ;
  - une source configurée mais non officielle ne produit AUCUN verdict ;
  - l'absence de données réelles se déclare, jamais « conforme ».
"""
from datetime import date

import pytest
from shapely.geometry import shape

from app.services import satellite_checker as sc

# Polygone d'environ 100 ha (0,01° × 0,01° à 6° N ≈ 1,11 km × 1,11 km).
GEOM = {
    "type": "Polygon",
    "coordinates": [[[-5.5, 6.0], [-5.49, 6.0], [-5.49, 6.01], [-5.5, 6.01], [-5.5, 6.0]]],
}
EVIDENCE = {"dataset_version": "test", "source": "test"}


def _geom():
    return shape(GEOM)


def test_perte_faible_post_2020_reste_non_conforme(monkeypatch):
    # 0,4 ha perdus sur ~123 ha : l'ancien seuil de 0,5 % classait cela « conforme ».
    monkeypatch.setattr(sc, "_gfw_query", lambda _poly: ([{"umd_tree_cover_loss__year": 2023, "area__ha": 0.4}], EVIDENCE))
    result = sc.live_check(_geom(), date(2025, 1, 1))
    assert result["compliant"] is False
    assert result["loss_year"] == 2023
    assert result["is_probative"] is True


def test_perte_avant_la_date_butoir_est_ignoree(monkeypatch):
    monkeypatch.setattr(sc, "_gfw_query", lambda _poly: ([{"umd_tree_cover_loss__year": 2019, "area__ha": 5.0}], EVIDENCE))
    result = sc.live_check(_geom(), date(2025, 1, 1))
    assert result["compliant"] is True


def test_aucune_perte_donne_un_verdict_conforme_probant(monkeypatch):
    monkeypatch.setattr(sc, "_gfw_query", lambda _poly: ([], EVIDENCE))
    result = sc.live_check(_geom(), date(2025, 1, 1))
    assert result["compliant"] is True
    assert result["is_probative"] is True


def test_source_non_officielle_ne_produit_aucun_verdict(monkeypatch):
    # Settings est un dataclass gelé : on substitue un objet de test au module.
    from types import SimpleNamespace

    monkeypatch.setattr(
        sc,
        "settings",
        SimpleNamespace(
            gfw_live_available=True,
            gfw_api_url="https://miroir.example.org/api",
            gfw_demo_mode=False,
            eudr_cutoff_date=sc.settings.eudr_cutoff_date,
        ),
    )
    result = sc.check_deforestation_risk(GEOM, "2025-01-01")
    assert result["compliant"] is None
    assert result["source"] == "unavailable"
    assert result["is_probative"] is False


@pytest.mark.parametrize(
    "url,attendu",
    [
        ("https://data-api.globalforestwatch.org/dataset", True),
        ("https://data-api.globalforestwatch.org.evil.example/x", False),
        ("https://evil.example/data-api.globalforestwatch.org", False),
        ("http://127.0.0.1:9999/", False),
    ],
)
def test_hote_officiel(url, attendu):
    assert sc._hote_officiel(url) is attendu
