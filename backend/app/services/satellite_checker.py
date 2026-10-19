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

import requests
from shapely.geometry import Point, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from urllib.parse import urlparse

from app.core.config import settings

logger = logging.getLogger(__name__)

RiskLevel = str  # "LOW" | "STANDARD" | "HIGH" | "CRITICAL" | "UNKNOWN"


# --------------------------------------------------------------------------- Risque pays
# Aucune classification administrative ou benchmark EUDR officiel n'est intégré.
# Une boîte englobante ne permet pas d'identifier le pays d'une parcelle fiable :
# chevauchement de frontières et territoires voisins créeraient une fausse précision.
def resolve_country(lon: float, lat: float) -> Tuple[str, str, RiskLevel]:
    """Ne déduit jamais un pays à partir d'un rectangle géographique approximatif."""
    return "XX", "Non déterminé", "UNKNOWN"


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
        for f in geometry.get("features", []):
            if isinstance(f, dict) and f.get("geometry"):
                sh = shape(f["geometry"])
                if sh.geom_type in {"Point", "MultiPoint"}:
                    sh = sh.buffer(0.0005)
                geoms.append(sh)
        return unary_union(geoms) if geoms else Point(0, 0).buffer(0.0005)
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
    iso2, country_name, country_risk = resolve_country(lon, lat)
    seed = f"{round(lon, 4)}:{round(lat, 4)}"
    jitter = _stable_fraction(seed)

    loss_year: Optional[int] = None
    loss_fraction = 0.0
    tree_cover = round(35.0 + jitter * 40.0, 1)
    hotspot_label: Optional[str] = None

    if loss_year is None:
        for spot in LOSS_HOTSPOTS:
            if spot.lon_min <= lon <= spot.lon_max and spot.lat_min <= lat <= spot.lat_max:
                loss_year = spot.loss_year
                loss_fraction = spot.loss_fraction
                tree_cover = spot.tree_cover_2000_pct
                hotspot_label = spot.label
                break
    else:
        loss_fraction = 0.25
        hotspot_label = "Année de perte simulée (mode démonstration)"

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
            "Aucune alerte Hansen Tree Cover Loss post-2020 sur l'emprise. Le risque pays et le benchmark officiel ne sont pas évalués."
        )

    if harvest_date <= settings.eudr_cutoff_date:
        details += " Récolte antérieure à la date butoir : hors champ temporel EUDR."

    # P0-04 : un moteur de démonstration ne rend PAS de verdict. Les valeurs
    # renvoyées sont présentées pour ce qu'elles sont : un jeu d'essai.
    return {
        "compliant": None,
        "loss_year": loss_year,
        "confidence_score": None,
        "risk_level": risk_level,
        "country_code": iso2,
        "country_name": country_name,
        "country_risk": country_risk,
        "source": "simulated",
        "is_probative": False,
        "evidence": None,
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
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Réponse GFW invalide : le corps JSON doit être un objet")
    data = payload.get("data")
    if not isinstance(data, list):
        raise ValueError("Réponse GFW invalide : le champ data doit être un tableau")
    # Version réellement servie, déduite de l'URL finale après redirection.
    served = version
    match = re.search(r"/dataset/[^/]+/([^/]+)/", response.url or "")
    if match:
        served = match.group(1)
    evidence = {
        "provider": "Global Forest Watch (World Resources Institute)",
        "dataset": settings.gfw_dataset,
        "dataset_version": served,
        "endpoint": url,
        "sql": GFW_SQL,
        "geometry_type": analysis_geometry.get("type", "Unknown"),
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    return data, evidence


def _normalize_gfw_rows(rows: List[Any]) -> List[Dict[str, Any]]:
    """Valide le contrat GFW avec les mêmes règles que le moteur TypeScript."""
    current_year = datetime.now(timezone.utc).year
    normalized: List[Dict[str, Any]] = []
    for index, raw in enumerate(rows):
        if not isinstance(raw, dict):
            raise ValueError(f"Réponse GFW invalide : ligne {index + 1} non objet")
        raw_year = raw.get("umd_tree_cover_loss__year")
        raw_area = raw.get("area__ha")

        # Les booléens sont des entiers en Python, mais ne sont pas des années.
        if isinstance(raw_year, bool) or raw_year is None:
            year = 0
        else:
            try:
                year_number = float(raw_year.strip() if isinstance(raw_year, str) else raw_year)
                year = int(year_number) if math.isfinite(year_number) and year_number.is_integer() else 0
            except (TypeError, ValueError, OverflowError):
                year = 0

        # Ne pas convertir True/False en 1.0/0.0, contrairement à float(bool).
        if isinstance(raw_area, bool) or raw_area is None:
            area = float("nan")
        else:
            try:
                area = float(raw_area.strip() if isinstance(raw_area, str) else raw_area)
            except (TypeError, ValueError, OverflowError):
                area = float("nan")

        if year < 2001 or year > current_year:
            raise ValueError(f"Réponse GFW invalide : année de perte absente ou hors plage à la ligne {index + 1}")
        if not math.isfinite(area) or area < 0:
            raise ValueError(f"Réponse GFW invalide : surface absente, non finie ou négative à la ligne {index + 1}")
        normalized.append({"umd_tree_cover_loss__year": year, "area__ha": area})
    return normalized

def live_check(geom: BaseGeometry, harvest_date: date) -> Dict[str, Any]:
    rows, evidence = _gfw_query(_analysis_polygon(geom))
    rows = _normalize_gfw_rows(rows)
    # Réponse vide : absence de perte et absence de donnée ne sont pas distinguables.
    # Aucun verdict de conformité (miroir de la version TypeScript).
    if not rows:
        return _unavailable_result(
            geom,
            "réponse GFW vide : absence de perte et absence de donnée ne sont pas distinguables ; aucun verdict de conformité",
        )
    centroid = geom.centroid
    iso2, country_name, country_risk = resolve_country(centroid.x, centroid.y)

    from app.services.gis_validator import geodesic_area_ha

    area_ha = geodesic_area_ha(geom) or 1.0
    post_cutoff_rows = [
        r for r in rows if int(r.get("umd_tree_cover_loss__year") or 0) > settings.eudr_cutoff_date.year
    ]
    all_rows = [r for r in rows if r.get("umd_tree_cover_loss__year")]

    loss_area = round(sum(float(r.get("area__ha") or 0.0) for r in post_cutoff_rows), 4)
    # P0 (recette 2026-10-08) : aucune tolérance. Un seuil de bruit (0,5 % de la
    # parcelle) rendait « conforme » une perte réelle mais faible. Toute perte
    # post-2020 détectée est non conforme ; l'erreur se corrige en revue humaine.
    significant = loss_area > 0

    if significant:
        loss_year = min(int(r["umd_tree_cover_loss__year"]) for r in post_cutoff_rows)
        fraction = min(loss_area / area_ha, 1.0)
        confidence = round(min(0.99, 0.80 + fraction * 0.5), 3)
        return {
            "compliant": False,
            "loss_year": loss_year,
            "confidence_score": None,
            "risk_level": "HIGH",
            "country_code": iso2,
            "country_name": country_name,
            "country_risk": country_risk,
            "source": "gfw-live",
            "is_probative": True,
            "evidence": evidence,
            "disclaimer": None,
            "loss_area_ha": loss_area,
            "tree_cover_2000_pct": None,
            "details": (
                f"GFW {evidence['dataset_version']} : {loss_area} ha de perte de couvert détectés à partir de "
                f"{loss_year} (post-2020) sur {area_ha:.2f} ha. Données Hansen/UMD, seuil de densité 30 %."
            ),
        }

    historic_year = max((int(r["umd_tree_cover_loss__year"]) for r in all_rows), default=None)
    return {
        "compliant": True,
        "loss_year": historic_year,
        "confidence_score": None,
        "risk_level": "UNKNOWN",
        "country_code": iso2,
        "country_name": country_name,
        "country_risk": country_risk,
        "source": "gfw-live",
        "is_probative": True,
        "evidence": evidence,
        "disclaimer": None,
        "loss_area_ha": loss_area,
        "tree_cover_2000_pct": None,
        "details": (
            f"GFW {evidence['dataset_version']} : aucune perte significative post-2020 ({loss_area} ha). "
            "Ce signal ne constitue pas une classification de risque pays."
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
    iso2, country_name, country_risk = resolve_country(centroid.x, centroid.y)
    return {
        "compliant": None,
        "loss_year": None,
        "confidence_score": None,
        "risk_level": country_risk,
        "country_code": iso2,
        "country_name": country_name,
        "country_risk": country_risk,
        "source": "unavailable",
        "is_probative": False,
        "evidence": None,
        "disclaimer": (
            "Analyse non disponible — aucun verdict de conformité n'a été établi. "
            "Aucune conclusion ne doit en être tirée pour un dossier EUDR."
        ),
        "loss_area_ha": 0.0,
        "tree_cover_2000_pct": None,
        "details": (
            f"Analyse satellite impossible : {reason}. "
            "Classification du pays et benchmark officiel indisponibles."
        ),
    }


GFW_HOTE_OFFICIEL = "data-api.globalforestwatch.org"


def _hote_officiel(url: str) -> bool:
    """Vrai seulement si l'adresse désigne le service officiel Global Forest Watch."""
    return urlparse(url).hostname == GFW_HOTE_OFFICIEL


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
    geom = _to_shapely(geometry)

    if settings.gfw_live_available:
        # P0 (recette 2026-10-08) : seul le service officiel produit une preuve.
        # Un point d'accès configuré ailleurs ne produit aucun verdict.
        if not _hote_officiel(settings.gfw_api_url):
            return _unavailable_result(
                geom,
                f"source satellite non officielle ({urlparse(settings.gfw_api_url).netloc}) : "
                "aucune preuve ne peut en être tirée",
            )
        try:
            return live_check(geom, parsed_date)
        except (requests.RequestException, ValueError, KeyError) as exc:
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
