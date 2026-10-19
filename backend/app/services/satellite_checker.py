"""Détection de déforestation post-2020 (Hansen / UMD Tree Cover Loss via Global Forest Watch).

Deux moteurs :
  1. **live**  : GFW Data API (`/dataset/umd_tree_cover_loss/latest/query`) si `GFW_API_KEY` est configurée.
  2. **mock déterministe** : règles de scoring reproductibles (hotspots documentés + benchmark pays UE)
     utilisées hors-ligne, en tests et en repli automatique si l'API est indisponible.

Règle EUDR (art. 2(13) & art. 3) : toute perte de couvert forestier datée APRÈS le 31/12/2020
sur l'emprise de la parcelle => `compliant = False`.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests
from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from app.core.config import settings
from app.services.frontieres import FrontieresIndisponibles, resoudre_pays

logger = logging.getLogger(__name__)

RiskLevel = str  # "LOW" | "STANDARD" | "HIGH"


# --------------------------------------------------------------------------- Benchmark pays
# P2-16 — table de risque **par pays**, et résolution par frontières réelles.
#
# ⚠️ Ce qui a changé, et pourquoi.
#   La résolution testait l'appartenance à des rectangles. Or un rectangle n'est
#   pas un pays : la boîte « Union européenne » couvrait la Tunisie, l'Algérie,
#   le Maroc, la Serbie et l'Ukraine. Tunis, Alger, Tanger et Belgrade étaient
#   donc attribués à l'Union européenne, Kiev et Oulan-Bator à la Russie, et
#   Hokkaido à la Russie. Ces attributions étaient fausses, et présentées comme
#   des pays.
#
#   Le pays est désormais résolu par les frontières Natural Earth 1:50m
#   versionnées dans `data/frontieres/` (cf. `frontieres.py` et le
#   `PROVENANCE.md` du dossier). Un point qui n'appartient à aucun pays est
#   rendu `XX` — « non déterminé » — et non attribué au voisin le plus proche.
#
# ⚠️ Ce qui n'a pas changé, et ne doit pas être confondu.
#   Le niveau de risque reste une **table interne non vérifiée**. Résoudre
#   correctement le pays ne rend pas la classification réglementaire exacte :
#   ce sont deux contrôles distincts. Un risque « faible » n'est toujours pas
#   retenu au niveau de l'audit (cf. `risque_retenu`).

#: États membres de l'Union européenne. La boîte « EU » ne peut pas être
#: conservée comme entrée : un pays résolu est désormais un vrai pays.
PAYS_UE = frozenset(
    "AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK".split()
)

#: Pays à risque « élevé » selon la table interne (inchangé).
RISQUE_ELEVE = frozenset({"BY", "MM", "KP", "RU"})

#: Pays à risque « faible » selon la table interne (inchangé : UE + ce qui
#: l'était déjà). Les autres pays valent STANDARD.
RISQUE_FAIBLE = PAYS_UE | frozenset({"US", "CA", "AU", "NZ", "JP", "CN"})


def risque_pays(iso2: str) -> RiskLevel:
    """Risque associé à un code ISO 3166-1 alpha-2."""
    if iso2 in RISQUE_ELEVE:
        return "HIGH"
    if iso2 in RISQUE_FAIBLE:
        return "LOW"
    return "STANDARD"


# ⚠️ P2-01 — ce référentiel est une **table interne**, pas la classification de
# la Commission. Aucune source vérifiable, version officielle ni date
# d'application ne sont présentes dans le dépôt : l'affirmer serait une preuve
# inventée. Les champs ci-dessous rendent cette absence visible dans chaque
# résultat au lieu de la laisser découvrir trois ans plus tard.
COUNTRY_BENCHMARK: Dict[str, Any] = {
    "source": "Table interne GeoForest — non confrontée à une publication de la Commission",
    "source_url": None,
    "version": "2026-10-19",
    "applied_from": None,
    "verified": False,
    "resolution_method": "natural-earth-50m",
    "borders": {
        "dataset": "Natural Earth 1:50m (via world-atlas 2.0.2)",
        "version": "2.0.2",
        "path": "data/frontieres/countries-50m.json",
    },
}

LIMITE_BENCHMARK_PAYS = (
    "Risque pays : table interne non vérifiée (aucune source, version ou date d'application "
    "officielle disponible). Le pays est déduit des frontières Natural Earth 1:50m — un point "
    "situé à moins de quelques centaines de mètres d'une frontière peut être mal attribué, et "
    "un point hors couverture est rendu « non déterminé ». La résolution du pays ne vaut pas "
    "classification réglementaire : un risque « faible » n'est jamais retenu au niveau de "
    "l'audit (plancher STANDARD)."
)

LIMITE_REPONSE_VIDE = (
    "Réponse du fournisseur sans aucune ligne : elle établit l'absence de perte déclarée pour "
    "l'emprise interrogée, mais ne distingue pas « aucune perte » d'une « absence de couverture "
    "du jeu de données » (océan, zone non couverte, géométrie non intersectée)."
)

LIMITE_VERSION_NON_EPINGLEE = (
    "Version du jeu de données non épinglée (« latest ») : le résultat n'est pas reproductible "
    "dans le temps et ne doit pas être présenté comme une mesure figée."
)

LIMITES_METHODE_COUVERT = [
    "Résolution native du capteur : 30 m — une parcelle ou une coupe de moins de 0,09 ha n'est pas détectable.",
    "Le jeu de données mesure la perte de couvert arboré, pas la cause de cette perte : une coupe "
    "légale et une déforestation illégale y sont indiscernables.",
    "La perte est datée de l'année, pas du jour : la chronologie fine d'une récolte n'est pas "
    "établie par cette analyse.",
]

LIMITE_PAYS_NON_DETERMINE = (
    "Pays non déterminé : le point n'appartient à aucun polygone du jeu de frontières "
    "(haute mer, zone non couverte, entité sans code ISO, ou effet de généralisation). "
    "Aucun pays voisin n'a été substitué."
)


def resolve_country_detail(lon: float, lat: float) -> Dict[str, Any]:
    """Résout le pays d'un point par ses frontières réelles (P2-16).

    Le résultat porte sa méthode et son ambiguïté. Une résolution qui ne peut
    pas conclure renvoie `XX`, jamais un pays « probable ».

    :raises FrontieresIndisponibles: si le jeu de frontières est absent. Le
        moteur doit alors refuser d'attribuer, pas retomber sur une méthode
        approximative : une attribution fausse se présente comme un fait.
    """
    resolution = resoudre_pays(lon, lat)
    iso2 = resolution["iso2"]
    return {
        "iso2": iso2,
        "name": resolution["name"],
        "risk": "STANDARD" if iso2 == "XX" else risque_pays(iso2),
        "ambiguous": resolution["ambiguous"],
        "candidates": resolution["candidates"],
        "method": resolution["method"],
    }


def resolve_country(lon: float, lat: float) -> Tuple[str, str, RiskLevel]:
    """Retourne (iso2, nom, niveau de risque benchmark) pour un centroïde."""
    detail = resolve_country_detail(lon, lat)
    return detail["iso2"], detail["name"], detail["risk"]


def risque_retenu(benchmark: RiskLevel) -> RiskLevel:
    """Niveau de risque utilisable dans un audit.

    ⚠️ Un risque « faible » ne peut pas être établi par une table de risque non
    vérifiée : STANDARD est la valeur par défaut du règlement (art. 29) lorsque
    le pays n'est pas classé — ce n'est pas une conclusion favorable.
    """
    return "STANDARD" if benchmark == "LOW" else benchmark


def _provenance(method: str, version: Optional[str], params: Dict[str, Any], limits: List[str]) -> Dict[str, Any]:
    return {"method": method, "version": version, "params": params, "limits": limits}


# --------------------------------------------------------------------------- Hotspots déterministes
@dataclass(frozen=True)
class LossHotspot:
    label: str
    lon_min: float
    lat_min: float
    lon_max: float
    lat_max: float
    loss_year: int
    loss_fraction: float  # fraction de la parcelle touchée
    tree_cover_2000_pct: float


# Zones de pression documentées (arc de déforestation, Riau, Kalimantan, sud-ouest ivoirien...).
# Utilisées UNIQUEMENT par le moteur déterministe (hors-ligne / tests).
LOSS_HOTSPOTS: List[LossHotspot] = [
    LossHotspot("Arc de déforestation — Pará (BR)", -56.0, -10.0, -48.0, -2.0, 2022, 0.42, 88.0),
    LossHotspot("Riau — Sumatra (ID)", 100.0, -1.0, 104.0, 2.0, 2021, 0.35, 81.0),
    LossHotspot("Kalimantan central (ID)", 110.0, -3.0, 117.0, 2.0, 2024, 0.27, 84.0),
    LossHotspot("Sud-ouest ivoirien — Taï (CI)", -8.0, 5.0, -6.0, 7.0, 2023, 0.18, 76.0),
    LossHotspot("Mato Grosso (BR) — perte pré-cutoff", -60.0, -16.0, -52.0, -10.01, 2019, 0.30, 79.0),
    LossHotspot("Bassin du Congo — Tshopo (CD)", 24.0, -1.0, 27.0, 2.0, 2019, 0.12, 90.0),
]


def _stable_fraction(seed: str) -> float:
    """Pseudo-aléa déterministe dans [0, 1) dérivé d'un hash SHA-256."""
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def _to_shapely(geometry: Dict[str, Any]) -> BaseGeometry:
    gtype = geometry.get("type")
    if gtype == "Feature":
        sh = shape(geometry["geometry"])
        return sh.buffer(0.0005) if sh.geom_type in {"Point", "MultiPoint"} else sh
    if gtype == "FeatureCollection":
        geoms = []
        for index, f in enumerate(geometry.get("features", [])):
            # ⚠️ P2-03 — une feature sans géométrie était ignorée : l'analyse
            # portait alors sur un autre lot que celui déposé.
            if not isinstance(f, dict) or not isinstance(f.get("geometry"), dict):
                raise ValueError(
                    f"FeatureCollection : géométrie absente ou invalide à l'indice {index + 1}"
                )
            sh = shape(f["geometry"])
            if sh.geom_type in {"Point", "MultiPoint"}:
                sh = sh.buffer(0.0005)
            geoms.append(sh)
        # ⚠️ P2-07 — avant : `unary_union([])` était remplacé par un disque
        # autour de (0, 0) — Null Island. Une collection vide était donc
        # analysée comme une parcelle au large de l'Afrique, puis rendue
        # « conforme » si le fournisseur ne renvoyait aucune ligne.
        if not geoms:
            raise ValueError("FeatureCollection sans géométrie exploitable : aucune analyse possible")
        return unary_union(geoms)
    sh = shape(geometry)
    return sh.buffer(0.0005) if sh.geom_type in {"Point", "MultiPoint"} else sh


def _analysis_polygon(geom: BaseGeometry) -> Dict[str, Any]:
    """Pour un point, on analyse un disque ~55 m (0.0005°) ; sinon la géométrie elle-même."""
    if geom.geom_type in {"Point", "MultiPoint"}:
        geom = geom.buffer(0.0005)
    elif geom.geom_type == "GeometryCollection":
        # Convertit tout élément en polygone
        polys = [g.buffer(0.0005) if g.geom_type in {"Point", "MultiPoint"} else g for g in geom.geoms]
        geom = unary_union(polys)

    return mapping(geom)


# --------------------------------------------------------------------------- Moteur déterministe
def deterministic_check(geom: BaseGeometry, harvest_date: date) -> Dict[str, Any]:
    centroid = geom.centroid
    lon, lat = centroid.x, centroid.y
    country_detail = resolve_country_detail(lon, lat)
    iso2 = country_detail["iso2"]
    country_name = country_detail["name"]
    country_risk = country_detail["risk"]
    country_candidates = country_detail["candidates"]
    country_ambiguous = country_detail["ambiguous"]
    seed = f"{round(lon, 4)}:{round(lat, 4)}"
    jitter = _stable_fraction(seed)

    loss_year: Optional[int] = None
    loss_fraction = 0.0
    tree_cover = round(35.0 + jitter * 40.0, 1)
    hotspot_label: Optional[str] = None

    # ⚠️ L'ancien `else` ne pouvait jamais s'exécuter (`loss_year` est None à
    # cet instant) : il est retiré plutôt que laissé comme fausse piste.
    for spot in LOSS_HOTSPOTS:
        if spot.lon_min <= lon <= spot.lon_max and spot.lat_min <= lat <= spot.lat_max:
            loss_year = spot.loss_year
            loss_fraction = spot.loss_fraction
            tree_cover = spot.tree_cover_2000_pct
            hotspot_label = spot.label
            break

    from app.services.gis_validator import geodesic_area_ha

    area_ha = geodesic_area_ha(geom)
    loss_area = round(area_ha * loss_fraction, 4) if area_ha > 0 else (0.05 if loss_year else 0.0)

    post_cutoff = loss_year is not None and loss_year > settings.eudr_cutoff_date.year
    compliant = not post_cutoff

    if post_cutoff:
        confidence = round(0.86 + jitter * 0.12, 3)
        risk_level: RiskLevel = "HIGH"
        details = (
            f"Perte de couvert forestier détectée en {loss_year} ({loss_area} ha, {loss_fraction:.0%} de la parcelle)"
            f" — postérieure au 31/12/2020. Zone : {hotspot_label}."
        )
    elif loss_year is not None:
        confidence = round(0.88 + jitter * 0.10, 3)
        risk_level = country_risk if country_risk != "LOW" else "STANDARD"
        details = (
            f"Perte historique en {loss_year} (antérieure à la date butoir) : conforme, mais vigilance renforcée. "
            f"Zone : {hotspot_label}."
        )
    else:
        confidence = round(0.90 + jitter * 0.09, 3)
        risk_level = country_risk
        details = (
            f"Aucune alerte Hansen Tree Cover Loss post-2020 sur l'emprise. Pays : {country_name} ({iso2}), "
            f"benchmark UE : {country_risk}."
        )

    if harvest_date <= settings.eudr_cutoff_date:
        details += " Récolte antérieure à la date butoir : hors champ temporel EUDR."

    # P0-04 : un moteur de démonstration ne rend PAS de verdict. Les valeurs
    # renvoyées sont présentées pour ce qu'elles sont : un jeu d'essai.
    return {
        "compliant": None,
        "loss_year": loss_year,
        "confidence_score": None,
        "risk_level": risque_retenu(risk_level),
        "country_code": iso2,
        "country_name": country_name,
        "country_risk": country_risk,
        "source": "simulated",
        "is_probative": False,
        "evidence": None,
        "provenance": _provenance(
            "deterministic-demo",
            None,
            {
                "date_butoir": settings.eudr_cutoff_date.isoformat(),
                "scenarios_disponibles": len(LOSS_HOTSPOTS),
                "scenario_retenu": hotspot_label,
                "resolution_pays": COUNTRY_BENCHMARK["resolution_method"],
                "pays_candidats": country_candidates,
                "pays_ambigu": country_ambiguous,
                "benchmark_pays": dict(COUNTRY_BENCHMARK),
            },
            [
                "Aucune donnée satellite n'a été consultée : les chiffres sont inventés pour la démonstration.",
                "Le pays est déterminé par les frontières Natural Earth 1:50m, non par géocodage inverse.",
                LIMITE_BENCHMARK_PAYS,
                *LIMITES_METHODE_COUVERT,
            ],
        ),
        "disclaimer": (
            "Analyse simulée — résultat non probant. Aucune donnée satellite n'a été "
            "consultée : ce résultat ne peut pas servir de preuve de conformité au "
            "règlement (UE) 2023/1115."
        ),
        "loss_area_ha": loss_area,
        "tree_cover_2000_pct": tree_cover,
        "details": details,
    }


# --------------------------------------------------------------------------- Moteur live GFW
GFW_SQL = (
    "SELECT umd_tree_cover_loss__year, SUM(area__ha) AS area__ha "
    "FROM results WHERE umd_tree_cover_density_2000__threshold = 30 "
    "GROUP BY umd_tree_cover_loss__year ORDER BY umd_tree_cover_loss__year"
)

GFW_HOTE_OFFICIEL = "data-api.globalforestwatch.org"


class GfwResponseError(ValueError):
    """Réponse du fournisseur inexploitable.

    ⚠️ P2-02 — une réponse illisible **n'est pas** une absence de perte. Avant
    ce correctif, ``payload.get("data") or []`` transformait un champ manquant,
    une ligne sans année, une surface nulle ou négative en « 0 ha de perte »,
    donc en verdict CONFORME et probant. C'est la faute la plus grave que
    puisse commettre ce moteur : elle fabrique une preuve.
    """


def _nombre_strict(value: Any) -> Optional[float]:
    """Nombre fini, éventuellement sérialisé en chaîne. Sinon ``None``."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, str) and re.fullmatch(r"-?\d+(?:\.\d+)?", value.strip()):
        return float(value.strip())
    return None


def _parse_observations(rows: Any) -> List[Dict[str, float]]:
    """Valide chaque ligne du fournisseur ; une ligne douteuse invalide la réponse.

    Un tableau vide est accepté : c'est une observation négative, assortie
    d'une limite de couverture explicite. Une ligne sans année ou une surface
    négative lève : la perte ne doit jamais disparaître par omission.
    """
    if not isinstance(rows, list):
        raise GfwResponseError("liste de lignes attendue")
    observations: List[Dict[str, float]] = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise GfwResponseError(f"ligne #{index + 1} illisible (objet attendu)")
        year = _nombre_strict(row.get("umd_tree_cover_loss__year"))
        area = _nombre_strict(row.get("area__ha"))
        if year is None or not float(year).is_integer() or not (1900 <= year <= 2100):
            raise GfwResponseError(f"ligne #{index + 1} : année de perte absente ou illisible")
        if area is None or area < 0:
            raise GfwResponseError(f"ligne #{index + 1} : surface de perte absente, illisible ou négative")
        observations.append({"year": float(year), "area": area})
    return observations


def _nommer_fournisseur(base_url: str) -> Tuple[str, bool]:
    """Nomme le fournisseur d'après l'hôte réellement appelé.

    ⚠️ P2-08 — le nom « Global Forest Watch » était inscrit en dur dans la
    trace, quel que soit l'hôte configuré. Une instance pointée vers un cache
    interne ou un banc d'essai produisait une trace affirmant une provenance
    fausse — exactement ce que la traçabilité EUDR doit empêcher.
    """
    host = base_url.lower()
    try:
        host = (urlparse(base_url).hostname or base_url).lower()
    except ValueError:
        host = base_url.lower()
    if host == GFW_HOTE_OFFICIEL:
        return "Global Forest Watch (World Resources Institute)", True
    return f"Service configuré ({host}) — distinct de Global Forest Watch", False


def _gfw_query(analysis_geometry: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Interroge GFW Data API : pertes annuelles (ha) sur l'emprise, densité 2000 >= 30 %.

    Retourne les lignes **et** la trace d'exécution, consignée avec l'audit pour
    qu'un résultat ancien reste reproductible.
    """
    version = settings.gfw_dataset_version
    # L'API expose la ressource sous /query/json. L'ancien chemin /query
    # renvoyait une redirection 307 : on appelle directement la bonne URL.
    url = f"{settings.gfw_api_url.rstrip('/')}/dataset/{settings.gfw_dataset}/{version}/query/json"
    response = requests.post(
        url,
        headers={"x-api-key": settings.gfw_api_key, "Content-Type": "application/json"},
        data=json.dumps({"sql": GFW_SQL, "geometry": analysis_geometry}),
        timeout=settings.gfw_timeout_seconds,
    )
    if not response.ok:
        raise requests.HTTPError(
            f"GFW HTTP {response.status_code} — {response.text[:200]}", response=response
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise GfwResponseError("corps de réponse non JSON — réponse du fournisseur illisible") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise GfwResponseError(
            "champ 'data' absent ou non tableau — réponse du fournisseur illisible"
        )
    # Version réellement servie, déduite de l'URL finale après redirection.
    served = version
    match = re.search(r"/dataset/[^/]+/([^/]+)/", response.url or "")
    if match:
        served = match.group(1)
    provider, officiel = _nommer_fournisseur(settings.gfw_api_url)
    evidence = {
        "provider": provider,
        "is_official_source": officiel,
        "dataset": settings.gfw_dataset,
        "dataset_version": served,
        "endpoint": url,
        "sql": GFW_SQL,
        "geometry_type": analysis_geometry.get("type", "Unknown"),
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    return list(payload["data"]), evidence


def live_check(geom: BaseGeometry, harvest_date: date) -> Dict[str, Any]:
    analysis_geometry = _analysis_polygon(geom)
    from app.services.gis_validator import geodesic_area_ha

    area_ha = geodesic_area_ha(shape(analysis_geometry))
    if not area_ha > 0:
        raise ValueError("emprise d'analyse de surface nulle : aucune requête satellite fiable n'est possible")

    rows, evidence = _gfw_query(analysis_geometry)
    observations = _parse_observations(rows)
    centroid = geom.centroid
    country = resolve_country_detail(centroid.x, centroid.y)

    post_cutoff = [r for r in observations if r["year"] > settings.eudr_cutoff_date.year]
    loss_area = round(sum(r["area"] for r in post_cutoff), 4)
    # Seuil de bruit : 0,5 % de la parcelle ou 0,01 ha (~1 pixel Landsat = 0,09 ha, on reste strict)
    seuil = round(max(0.01, area_ha * 0.005), 4)
    significant = loss_area >= seuil
    reponse_vide = not observations
    version_epinglee = evidence["dataset_version"] not in {"latest", ""}

    limites: List[str] = [
        *LIMITES_METHODE_COUVERT,
        LIMITE_BENCHMARK_PAYS,
        *([LIMITE_REPONSE_VIDE] if reponse_vide else []),
        *([] if version_epinglee else [LIMITE_VERSION_NON_EPINGLEE]),
        "Le score de confiance est une convention d'affichage du produit, "
        "non une mesure de qualité fournie par le fournisseur.",
    ]
    params: Dict[str, Any] = {
        "jeu_de_donnees": evidence["dataset"],
        "version_jeu_de_donnees": evidence["dataset_version"],
        "fournisseur": evidence["provider"],
        "fournisseur_officiel": evidence["is_official_source"],
        "seuil_significativite_ha": seuil,
        "surface_analysee_ha": round(area_ha, 4),
        "date_butoir": settings.eudr_cutoff_date.isoformat(),
        "date_recolte": harvest_date.isoformat(),
        "resolution_pays": COUNTRY_BENCHMARK["resolution_method"],
        "pays_candidats": country["candidates"],
        "pays_ambigu": country["ambiguous"],
        "benchmark_pays": dict(COUNTRY_BENCHMARK),
    }

    if significant:
        loss_year = int(min(r["year"] for r in post_cutoff))
        fraction = min(loss_area / area_ha, 1.0)
        confidence = round(min(0.99, 0.80 + fraction * 0.5), 3)
        return {
            "compliant": False,
            "loss_year": loss_year,
            "confidence_score": confidence,
            "risk_level": "HIGH",
            "country_code": country["iso2"],
            "country_name": country["name"],
            "country_risk": country["risk"],
            "source": "gfw-live",
            "is_probative": True,
            "evidence": evidence,
            "provenance": _provenance("gfw-live", evidence["dataset_version"], params, limites),
            "disclaimer": None,
            "loss_area_ha": loss_area,
            "tree_cover_2000_pct": None,
            "details": (
                f"GFW {evidence['dataset_version']} : {loss_area} ha de perte de couvert détectés à partir de "
                f"{loss_year} (post-2020) sur {area_ha:.2f} ha. Données Hansen/UMD, seuil de densité 30 %."
            ),
        }

    historic_year = max((int(r["year"]) for r in observations), default=None)
    return {
        "compliant": True,
        "loss_year": historic_year,
        "confidence_score": 0.95,
        # P2-01 — plancher STANDARD : un géocodage approximatif ne peut pas
        # établir un risque « faible ».
        "risk_level": risque_retenu(country["risk"]),
        "country_code": country["iso2"],
        "country_name": country["name"],
        "country_risk": country["risk"],
        "source": "gfw-live",
        "is_probative": True,
        "evidence": evidence,
        "provenance": _provenance("gfw-live", evidence["dataset_version"], params, limites),
        "disclaimer": None,
        "loss_area_ha": loss_area,
        "tree_cover_2000_pct": None,
        "details": (
            f"GFW {evidence['dataset_version']} : "
            + (
                "aucune ligne de perte retournée par le fournisseur (0 ha). "
                if reponse_vide
                else f"aucune perte significative post-2020 ({loss_area} ha). "
            )
            + f"Pays : {country['name']}, benchmark UE : {country['risk']}."
        ),
    }


# --------------------------------------------------------------------------- API publique
def _unavailable_result(geom: BaseGeometry, reason: str) -> Dict[str, Any]:
    """Résultat d'une analyse qui n'a pas pu être menée.

    Il n'y a **pas de repli silencieux** vers le moteur déterministe (P0-04) :
    une indisponibilité est un fait que l'on déclare, pas un verdict que l'on
    remplace par une estimation.
    """
    centroid = geom.centroid
    country = resolve_country_detail(centroid.x, centroid.y)
    iso2, country_name, country_risk = country["iso2"], country["name"], country["risk"]
    return {
        "compliant": None,
        "loss_year": None,
        "confidence_score": None,
        # P2-01 — une analyse indisponible ne peut pas produire un risque faible.
        "risk_level": risque_retenu(country_risk),
        "country_code": iso2,
        "country_name": country_name,
        "country_risk": country_risk,
        "source": "unavailable",
        "is_probative": False,
        "evidence": None,
        "provenance": _provenance(
            "aucune",
            None,
            {
                "resolution_pays": COUNTRY_BENCHMARK["resolution_method"],
                "pays_candidats": country["candidates"],
                "pays_ambigu": country["ambiguous"],
                "benchmark_pays": dict(COUNTRY_BENCHMARK),
            },
            [
                reason,
                "Aucun verdict de conformité n'a été établi.",
                LIMITE_BENCHMARK_PAYS,
                *LIMITES_METHODE_COUVERT,
            ],
        ),
        "disclaimer": (
            "Analyse non disponible — aucun verdict de conformité n'a été établi. "
            "Aucune conclusion ne doit en être tirée pour un dossier EUDR."
        ),
        "loss_area_ha": 0.0,
        "tree_cover_2000_pct": None,
        "details": (
            f"Analyse satellite impossible : {reason}. "
            f"Pays déduit des coordonnées : {country_name} ({iso2})."
        ),
    }


def _unavailable_sans_geometrie(reason: str) -> Dict[str, Any]:
    """Résultat d'une analyse impossible faute de géométrie exploitable.

    Aucun pays ne peut être déduit : le résultat ne porte donc ni coordonnées
    ni benchmark, seulement la raison de l'indisponibilité.
    """
    return {
        "compliant": None,
        "loss_year": None,
        "confidence_score": None,
        "risk_level": "STANDARD",
        "country_code": "XX",
        "country_name": "Non déterminé",
        "country_risk": "STANDARD",
        "source": "unavailable",
        "is_probative": False,
        "evidence": None,
        "provenance": _provenance(
            "aucune",
            None,
            {"resolution_pays": "impossible — géométrie inexploitable"},
            [
                reason,
                "Aucun verdict de conformité n'a été établi.",
                *LIMITES_METHODE_COUVERT,
            ],
        ),
        "disclaimer": (
            "Analyse non disponible — aucun verdict de conformité n'a été établi. "
            "Aucune conclusion ne doit en être tirée pour un dossier EUDR."
        ),
        "loss_area_ha": 0.0,
        "tree_cover_2000_pct": None,
        "details": f"Analyse satellite impossible : {reason}.",
    }


def check_deforestation_risk(geometry: Dict[str, Any], harvest_date: str) -> Dict[str, Any]:
    """Évalue le risque de déforestation post-2020 sur une géométrie GeoJSON.

    Trois issues, et une seule étant probante :
      1. accès GFW configuré et disponible   → verdict fondé sur des données réelles ;
      2. accès GFW configuré mais défaillant → **aucun verdict** (jamais de repli
         silencieux vers une simulation : c'est l'objet même de P0-04) ;
      3. non configuré                        → simulation seulement si le mode
         démonstration est explicitement activé, sinon aucun verdict.

    :param geometry: Geometry / Feature / FeatureCollection GeoJSON (WGS84).
    :param harvest_date: date de récolte ISO 8601 (YYYY-MM-DD).
    :return: dict conforme à `SatelliteCheckResult`.
    """
    parsed_date = date.fromisoformat(harvest_date)

    # ⚠️ P2-16 — sans référentiel de frontières, aucun pays n'est attribuable.
    #   On refuse alors l'analyse au lieu de retomber sur une méthode
    #   approximative : une attribution fausse se présente comme un fait, alors
    #   qu'une analyse indisponible se voit. C'est le même principe que pour une
    #   panne GFW (P0-04).
    try:
        frontieres = resoudre_pays(0.0, 0.0)
        del frontieres
    except FrontieresIndisponibles as exc:
        logger.error("Référentiel de frontières indisponible — aucun verdict émis : %s", exc)
        return _unavailable_sans_geometrie(
            f"référentiel de frontières indisponible ({exc}) : aucune attribution de pays fiable"
        )

    try:
        geom = _to_shapely(geometry)
        if geom.is_empty:
            raise ValueError("géométrie vide — aucune analyse possible")
    except Exception as exc:  # noqa: BLE001 — entrée non fiable : tout échec de lecture vaut refus
        # ⚠️ P2-07 — une géométrie inexploitable (vide, membre `null`, anneau
        # absent) ne doit pas remonter en erreur 500 : elle produit une analyse
        # indisponible, sans pays ni verdict. Le périmètre du `except` est
        # volontairement limité à la lecture de la géométrie : les erreurs de
        # programmation du reste du moteur ne sont pas masquées.
        return _unavailable_sans_geometrie(str(exc))

    if settings.gfw_live_available:
        try:
            return live_check(geom, parsed_date)
        # ⚠️ P2-02 — une charge utile malformée pouvait lever AttributeError ou
        # TypeError (par exemple un tableau à la place de l'objet attendu) et
        # remonter en erreur 500 au lieu d'un « analyse indisponible ». Le
        # fournisseur ne doit jamais pouvoir produire autre chose qu'un refus
        # de verdict.
        except (requests.RequestException, ValueError, KeyError, TypeError, AttributeError) as exc:
            logger.error("GFW direct impossible — aucun verdict émis : %s", exc)
            return _unavailable_result(geom, str(exc))

    if settings.gfw_demo_mode:
        logger.warning("Mode démonstration activé : résultat simulé, non probant.")
        return deterministic_check(geom, parsed_date)

    return _unavailable_result(
        geom,
        "aucune source de données satellite configurée (GFW_API_KEY absente) "
        "et mode démonstration désactivé",
    )
