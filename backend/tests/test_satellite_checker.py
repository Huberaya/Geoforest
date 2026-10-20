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


def test_reponse_vide_ne_donne_aucun_verdict(monkeypatch):
    # Une réponse vide n'est pas une preuve de conformité : absence de perte et
    # absence de donnée sont indiscernables. Aucun verdict n'est émis.
    monkeypatch.setattr(sc, "_gfw_query", lambda _poly: ([], EVIDENCE))
    result = sc.live_check(_geom(), date(2025, 1, 1))
    assert result["compliant"] is None
    assert result["is_probative"] is False


def test_perte_observee_avant_cutoff_reste_conforme_probant(monkeypatch):
    # Une perte réellement observée, mais antérieure au cutoff, est un résultat
    # exploitable : le polygone a bien été interrogé et renvoie des données.
    rows = [{"umd_tree_cover_loss__year": 2015, "area__ha": 1.0}]
    monkeypatch.setattr(sc, "_gfw_query", lambda _poly: (rows, EVIDENCE))
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


def test_country_risk_not_inferred_from_bounding_boxes():
    # A coordinate must not be assigned a country/official benchmark by rectangle approximation.
    assert sc.resolve_country(-5.5, 6.2) == ("XX", "Non déterminé", "UNKNOWN")


def test_live_clean_signal_does_not_invent_country_risk_or_confidence(monkeypatch):
    rows = [{"umd_tree_cover_loss__year": 2015, "area__ha": 1.0}]
    monkeypatch.setattr(sc, "_gfw_query", lambda _poly: (rows, EVIDENCE))
    result = sc.live_check(_geom(), date(2025, 1, 1))
    assert result["country_code"] == "XX"
    assert result["country_risk"] == "UNKNOWN"
    assert result["risk_level"] == "UNKNOWN"
    assert result["confidence_score"] is None


# Exact PR1 matrix, exercised through the Python public decision boundary too.
@pytest.mark.parametrize("row", [
    {"area__ha": 0.4},
    {"umd_tree_cover_loss__year": None, "area__ha": 0.4},
    {"umd_tree_cover_loss__year": "", "area__ha": 0.4},
    {"umd_tree_cover_loss__year": "inconnue", "area__ha": 0.4},
    {"umd_tree_cover_loss__year": date.today().year + 1, "area__ha": 0.4},
    {"umd_tree_cover_loss__year": 2023},
    {"umd_tree_cover_loss__year": 2023, "area__ha": None},
    {"umd_tree_cover_loss__year": 2023, "area__ha": ""},
    {"umd_tree_cover_loss__year": 2023, "area__ha": -0.4},
    {"umd_tree_cover_loss__year": 2023, "area__ha": "Infinity"},
], ids=["missing-year", "null-year", "blank-year", "invalid-year", "future-year",
        "missing-area", "null-area", "blank-area", "negative-area", "infinite-area"])
@pytest.mark.parametrize("mixed", [False, True], ids=["alone", "mixed"])
def test_pr1_matrix_fail_closed_at_public_boundary(monkeypatch, row, mixed):
    from types import SimpleNamespace

    monkeypatch.setattr(sc, "settings", SimpleNamespace(
        gfw_live_available=True,
        gfw_api_url="https://data-api.globalforestwatch.org",
        gfw_demo_mode=False,
        eudr_cutoff_date=date(2020, 12, 31),
    ))
    rows = ([{"umd_tree_cover_loss__year": 2015, "area__ha": 0.5}] if mixed else []) + [row]
    monkeypatch.setattr(sc, "_gfw_query", lambda _poly: (rows, EVIDENCE))
    result = sc.check_deforestation_risk(GEOM, "2025-01-01")
    assert result["source"] == "unavailable"
    assert result["compliant"] is None
    assert result["is_probative"] is False
