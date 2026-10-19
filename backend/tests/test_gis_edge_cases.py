"""Cas limites géospatiaux du validateur backend.

Ces tests portent sur des **règles vérifiables hors ligne** : topologie,
surfaces, couverture, unités. Ils ne constituent ni une validation terrain, ni
une validation du système d'information EUDR.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict

import pytest

from app.services.gis_validator import geodesic_area_ha, validate_geometry
from app.services.satellite_checker import (
    COUNTRY_BENCHMARK,
    resolve_country_detail,
    risque_retenu,
)

# Polygone ~1,48 ha à 6 décimales (Yirgacheffe, Éthiopie).
POLY: Dict[str, Any] = {
    "type": "Polygon",
    "coordinates": [
        [
            [38.201234, 6.161234],
            [38.202334, 6.161234],
            [38.202334, 6.162334],
            [38.201234, 6.162334],
            [38.201234, 6.161234],
        ]
    ],
}


def _codes(result: Dict[str, Any]) -> list[str]:
    return [e["code"] for e in result["errors"]]


def _warn_codes(result: Dict[str, Any]) -> list[str]:
    return [w["code"] for w in result["warnings"]]


# --------------------------------------------------------------------------- Topologie
class TestTopologie:
    def test_polygone_a_trou_refuse_comme_dans_le_validateur_frontend(self) -> None:
        """Le SI EUDR refuse les anneaux intérieurs : les deux validateurs doivent être d'accord.

        Avant correctif, le backend acceptait le trou (surface calculée en
        excluant l'enclave) alors que le frontend refusait le même fichier.
        """
        troue = {
            "type": "Polygon",
            "coordinates": [
                [[0.001234, 0.001234], [0.011234, 0.001234], [0.011234, 0.011234],
                 [0.001234, 0.011234], [0.001234, 0.001234]],
                [[0.003234, 0.003234], [0.005234, 0.003234], [0.005234, 0.005234],
                 [0.003234, 0.005234], [0.003234, 0.003234]],
            ],
        }
        result = validate_geometry(troue, raw_text=json.dumps(troue))
        assert result["valid"] is False
        assert "POLYGON_WITH_HOLES" in _codes(result)
        assert result["area_ha"] == 0.0

    def test_plafond_de_sommets_applique(self) -> None:
        """10 001 sommets : refus explicite, avec le décompte réel.

        Avant correctif, le backend acceptait un fichier de 12 000 sommets que
        le frontend refusait — et le parcourait entièrement.
        """
        ring = [[38.0 + i * 1e-5, 6.0] for i in range(10_000)] + [[38.0, 6.0]]
        geo = {"type": "Polygon", "coordinates": [ring]}
        result = validate_geometry(geo)
        assert result["valid"] is False
        assert "TOO_MANY_VERTICES" in _codes(result)
        assert result["vertex_count"] > 10_000

    def test_antimeridien_refuse(self) -> None:
        """Une parcelle qui franchit 180° ne doit pas produire 42,8 M ha."""
        anti = {
            "type": "Polygon",
            "coordinates": [[
                [179.900001, -16.100001], [-179.900001, -16.100001],
                [-179.900001, -16.000001], [179.900001, -16.000001],
                [179.900001, -16.100001],
            ]],
        }
        result = validate_geometry(anti, raw_text=json.dumps(anti))
        assert result["valid"] is False
        assert "ANTIMERIDIAN_UNSUPPORTED" in _codes(result)
        assert result["area_ha"] == 0.0

    def test_geometrie_absente_dans_un_lot_refusee(self) -> None:
        """Un lot partiellement géolocalisé ne doit pas être validé sur ses seules parcelles valides."""
        lot = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"name": "A"}, "geometry": POLY},
                {"type": "Feature", "properties": {"name": "B"}, "geometry": None},
            ],
        }
        result = validate_geometry(lot, raw_text=json.dumps(lot))
        assert result["valid"] is False
        assert "MISSING_GEOMETRY" in _codes(result)
        assert "Parcelle #2" in result["errors"][0]["message"]

    def test_feature_non_objet_refusee(self) -> None:
        lot = {"type": "FeatureCollection", "features": ["pas une feature", POLY]}
        result = validate_geometry(lot)
        assert result["valid"] is False
        assert "INVALID_FEATURE" in _codes(result)


# --------------------------------------------------------------------------- Formes malformées
FORMES_MALFORMEES = [
    ("polygon_sans_coordinates", {"type": "Polygon"}),
    ("polygon_coordinates_vides", {"type": "Polygon", "coordinates": []}),
    ("multipolygon_membre_null", {"type": "MultiPolygon", "coordinates": [None]}),
    ("multipolygon_anneau_null", {"type": "MultiPolygon", "coordinates": [[[[0.0, 0.0], [0.01, 0.0], [0.01, 0.01], [0.0, 0.0]]], None]}),
    ("geometrycollection_membre_null", {"type": "GeometryCollection", "geometries": [None]}),
    ("polygon_anneau_null", {"type": "Polygon", "coordinates": [None]}),
]


class TestFormesMalformees:
    @pytest.mark.parametrize("label,geometry", FORMES_MALFORMEES, ids=[c[0] for c in FORMES_MALFORMEES])
    def test_aucun_plantage_sur_une_forme_malformee(self, label: str, geometry: Dict[str, Any]) -> None:
        """Une entrée hostile est refusée avec un code, jamais par une exception non gérée."""
        result = validate_geometry(geometry)
        assert result["valid"] is False, label
        assert result["errors"], label
        assert all(isinstance(e["code"], str) and e["code"] for e in result["errors"])

    @pytest.mark.parametrize("label,geometry", FORMES_MALFORMEES, ids=[c[0] for c in FORMES_MALFORMEES])
    def test_moteur_satellite_ne_plante_pas_et_n_analyse_pas(self, label: str, geometry: Dict[str, Any]) -> None:
        from app.services.satellite_checker import check_deforestation_risk

        result = check_deforestation_risk(geometry, "2024-06-01")
        assert result["source"] == "unavailable", label
        assert result["compliant"] is None, label
        assert result["risk_level"] != "LOW", label


# --------------------------------------------------------------------------- Surfaces
class TestSurfaces:
    def test_surface_geodesique_de_reference(self) -> None:
        """0,01° × 0,01° à l'équateur = 123,0907 ha (référence pyproj, tolérance 0,1 %).

        Le validateur TypeScript doit rendre la même valeur : une sphère de
        rayon équatorial donnait 123,9203 ha (+0,67 %).
        """
        from shapely.geometry import Polygon

        carre = Polygon([(0.0, 0.0), (0.01, 0.0), (0.01, 0.01), (0.0, 0.01)])
        surface = geodesic_area_ha(carre)
        assert surface == pytest.approx(123.0907, rel=0.001), f"surface calculée : {surface} ha"

    def test_ecart_surface_declaree_signale(self) -> None:
        result = validate_geometry(POLY, declared_area_ha=8.0, raw_text=json.dumps(POLY))
        assert result["valid"] is True  # avertissement, pas refus
        assert "DECLARED_AREA_MISMATCH" in _warn_codes(result)

    def test_ecart_tolere_non_signale(self) -> None:
        result = validate_geometry(POLY, declared_area_ha=1.5, raw_text=json.dumps(POLY))
        assert "DECLARED_AREA_MISMATCH" not in _warn_codes(result)

    def test_seuil_quatre_hectares_strictement_superieur(self) -> None:
        point = {"type": "Point", "coordinates": [38.201234, 6.161234]}
        assert validate_geometry(point, declared_area_ha=4.0)["valid"] is True
        au_dela = validate_geometry(point, declared_area_ha=4.000001)
        assert au_dela["valid"] is False
        message = next(e["message"] for e in au_dela["errors"] if e["code"] == "POLYGON_REQUIRED")
        assert "> 4" in message and "≥ 4" not in message

    def test_geometrie_normalisee_a_six_decimales(self) -> None:
        result = validate_geometry(POLY, raw_text=json.dumps(POLY))
        texte = json.dumps(result["normalized_geometry"])
        décimales = max((len(m) - 1 for m in re.findall(r"\.\d+", texte)), default=0)
        assert décimales <= 6


# --------------------------------------------------------------------------- Pays
class TestPays:
    """P2-16 — attribution par frontières réelles, et non par boîtes englobantes.

    ⚠️ Deux tests de cette classe ont été **remplacés** par les cas ci-dessous.
    Ils vérifiaient que Hokkaido et El Salvador étaient *ambigus* : c'était vrai
    de la méthode par rectangles (les boîtes du Japon/de la Russie, du Salvador
    et du Honduras se recouvraient), pas des pays. Avec les frontières réelles,
    ces deux points sont sans ambiguïté (JP, SV). L'attente enregistrait donc un
    symptôme de la méthode défectueuse ; elle est remplacée, non assouplie.
    """

    def test_referentiel_declare_non_verifie(self) -> None:
        """Aucune source officielle, version ou date d'application ne doit être inventée."""
        assert COUNTRY_BENCHMARK["verified"] is False
        assert COUNTRY_BENCHMARK["applied_from"] is None
        assert COUNTRY_BENCHMARK["version"]
        # La provenance du jeu de frontières, elle, doit être explicite.
        assert COUNTRY_BENCHMARK["borders"]["dataset"].startswith("Natural Earth")
        assert COUNTRY_BENCHMARK["borders"]["version"]

    @pytest.mark.parametrize(
        "label,lon,lat,attendu",
        [
            # Cas exigés par la mission : les quatre capitales qui tombaient dans
            # la boîte « Union européenne », et les deux qui tombaient en Russie.
            ("Tunis", 10.1815, 36.8065, "TN"),
            ("Alger", 3.0588, 36.7538, "DZ"),
            ("Tanger", -5.7998, 35.7595, "MA"),
            ("Belgrade", 20.4573, 44.7872, "RS"),
            ("Kiev", 30.5234, 50.4501, "UA"),
            ("Hokkaido", 142.0, 43.0, "JP"),
            ("Oulan-Bator", 106.9057, 47.8864, "MN"),
            ("Nassau", -77.3396, 25.0443, "BS"),
            ("San Salvador", -89.2182, 13.6929, "SV"),
            ("Paris", 2.3522, 48.8566, "FR"),
            ("Abidjan", -4.0083, 5.3599, "CI"),
        ],
    )
    def test_attribution_par_frontieres(self, label: str, lon: float, lat: float, attendu: str) -> None:
        detail = resolve_country_detail(lon, lat)
        assert detail["iso2"] == attendu, f"{label} → {detail['iso2']} ({detail['name']})"
        assert detail["method"] == "natural-earth-50m"

    @pytest.mark.parametrize(
        "label,lon,lat,interdit",
        [
            # Attributions fautives mesurées avant P2-16. Ce test est la garde
            # qui empêche leur réapparition.
            ("Tunis n'est pas l'Union européenne", 10.1815, 36.8065, "EU"),
            ("Alger n'est pas l'Union européenne", 3.0588, 36.7538, "EU"),
            ("Tanger n'est pas l'Union européenne", -5.7998, 35.7595, "EU"),
            ("Belgrade n'est pas l'Union européenne", 20.4573, 44.7872, "EU"),
            ("Kiev n'est pas la Russie", 30.5234, 50.4501, "RU"),
            ("Hokkaido n'est pas la Russie", 142.0, 43.0, "RU"),
            ("Oulan-Bator n'est pas la Russie", 106.9057, 47.8864, "RU"),
        ],
    )
    def test_attribution_fautive_ne_reapparait_pas(
        self, label: str, lon: float, lat: float, interdit: str
    ) -> None:
        detail = resolve_country_detail(lon, lat)
        assert detail["iso2"] != interdit, f"{label} : {detail['iso2']}"
        assert interdit not in detail["candidates"], f"{label} : candidats {detail['candidates']}"

    def test_pays_non_determinable_reste_non_determine(self) -> None:
        """Un point hors couverture ne reçoit pas le pays voisin le plus proche."""
        # Kosovo : entité sans code ISO 3166-1 dans le jeu Natural Earth.
        kosovo = resolve_country_detail(21.1655, 42.6629)
        assert kosovo["iso2"] == "XX"
        assert kosovo["candidates"] == []
        assert kosovo["risk"] == "STANDARD"

        # Plein océan Atlantique.
        ocean = resolve_country_detail(-30.0, 20.0)
        assert ocean["iso2"] == "XX"
        assert ocean["risk"] == "STANDARD"

    def test_none_nationalite_par_defaut_sur_un_point_hors_couverture(self) -> None:
        """La limite de non-détermination accompagne le résultat, elle ne le remplace pas."""
        from app.services.satellite_checker import LIMITE_PAYS_NON_DETERMINE

        assert "non déterminé" in LIMITE_PAYS_NON_DETERMINE.lower()
        assert "Aucun pays voisin" in LIMITE_PAYS_NON_DETERMINE

    def test_frontieres_disponibles(self) -> None:
        from app.services.frontieres import frontieres_disponibles

        assert frontieres_disponibles() is True

    def test_aucun_risque_faible_retenu_pour_un_audit(self) -> None:
        assert risque_retenu("LOW") == "STANDARD"
        assert risque_retenu("HIGH") == "HIGH"
        assert risque_retenu("CRITICAL") == "CRITICAL"
