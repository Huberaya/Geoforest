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
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

import requests
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry

from app.core.config import settings

logger = logging.getLogger(__name__)

RiskLevel = str  # "LOW" | "STANDARD" | "HIGH"


# --------------------------------------------------------------------------- Benchmark pays
@dataclass(frozen=True)
class CountryBox:
    iso2: str
    name: str
    lon_min: float
    lat_min: float
    lon_max: float
    lat_max: float
    risk: RiskLevel


# Emprises approximatives (ordre = priorité). Benchmark conforme à la classification
# publiée par la Commission (règlement d'exécution 2025, art. 29 EUDR) :
#   HIGH : Biélorussie, Myanmar, Corée du Nord, Russie — LOW : UE et la plupart des pays
#   à faible risque — STANDARD : le reste (grands pays producteurs tropicaux).
COUNTRY_BOXES: List[CountryBox] = [
    CountryBox("BY", "Biélorussie", 23.1, 51.2, 32.8, 56.2, "HIGH"),
    CountryBox("MM", "Myanmar", 92.1, 9.5, 101.2, 28.6, "HIGH"),
    CountryBox("KP", "Corée du Nord", 124.1, 37.6, 130.7, 43.0, "HIGH"),
    CountryBox("RU", "Russie", 27.3, 41.1, 180.0, 81.9, "HIGH"),
    CountryBox("CI", "Côte d'Ivoire", -8.6, 4.3, -2.5, 10.8, "STANDARD"),
    CountryBox("GH", "Ghana", -3.3, 4.7, 1.2, 11.2, "STANDARD"),
    CountryBox("NG", "Nigeria", 2.6, 4.2, 14.7, 13.9, "STANDARD"),
    CountryBox("CM", "Cameroun", 8.4, 1.6, 16.2, 13.1, "STANDARD"),
    CountryBox("CD", "RD Congo", 12.2, -13.5, 31.3, 5.4, "STANDARD"),
    CountryBox("UG", "Ouganda", 29.5, -1.5, 35.0, 4.2, "STANDARD"),
    CountryBox("ET", "Éthiopie", 32.9, 3.4, 48.0, 14.9, "STANDARD"),
    CountryBox("KE", "Kenya", 33.9, -4.7, 41.9, 5.5, "STANDARD"),
    CountryBox("TZ", "Tanzanie", 29.3, -11.8, 40.5, -0.9, "STANDARD"),
    CountryBox("LR", "Liberia", -11.5, 4.3, -7.4, 8.6, "STANDARD"),
    CountryBox("ID", "Indonésie", 95.0, -11.0, 141.0, 6.1, "STANDARD"),
    CountryBox("MY", "Malaisie", 99.6, 0.8, 119.3, 7.4, "STANDARD"),
    CountryBox("VN", "Vietnam", 102.1, 8.4, 109.5, 23.4, "STANDARD"),
    CountryBox("TH", "Thaïlande", 97.3, 5.6, 105.7, 20.5, "STANDARD"),
    CountryBox("PG", "Papouasie-Nouvelle-Guinée", 140.8, -11.7, 156.0, -1.3, "STANDARD"),
    CountryBox("IN", "Inde", 68.1, 6.7, 97.4, 35.5, "STANDARD"),
    CountryBox("BR", "Brésil", -74.0, -33.8, -34.8, 5.3, "STANDARD"),
    CountryBox("CO", "Colombie", -79.0, -4.2, -66.9, 12.5, "STANDARD"),
    CountryBox("PE", "Pérou", -81.4, -18.4, -68.7, -0.03, "STANDARD"),
    CountryBox("EC", "Équateur", -81.1, -5.0, -75.2, 1.7, "STANDARD"),
    CountryBox("BO", "Bolivie", -69.6, -22.9, -57.5, -9.7, "STANDARD"),
    CountryBox("PY", "Paraguay", -62.7, -27.6, -54.3, -19.3, "STANDARD"),
    CountryBox("AR", "Argentine", -73.6, -55.1, -53.6, -21.8, "STANDARD"),
    CountryBox("HN", "Honduras", -89.4, 12.9, -83.1, 16.5, "STANDARD"),
    CountryBox("GT", "Guatemala", -92.3, 13.7, -88.2, 17.8, "STANDARD"),
    CountryBox("NI", "Nicaragua", -87.7, 10.7, -83.1, 15.0, "STANDARD"),
    CountryBox("CR", "Costa Rica", -85.9, 8.0, -82.6, 11.2, "STANDARD"),
    CountryBox("MX", "Mexique", -118.4, 14.5, -86.7, 32.7, "STANDARD"),
    CountryBox("US", "États-Unis", -125.0, 24.5, -66.9, 49.4, "LOW"),
    CountryBox("CA", "Canada", -141.0, 41.7, -52.6, 83.1, "LOW"),
    CountryBox("AU", "Australie", 113.3, -43.6, 153.6, -10.7, "LOW"),
    CountryBox("NZ", "Nouvelle-Zélande", 166.5, -47.3, 178.6, -34.4, "LOW"),
    CountryBox("JP", "Japon", 129.4, 31.0, 145.8, 45.5, "LOW"),
    CountryBox("CN", "Chine", 73.5, 18.2, 134.8, 53.6, "LOW"),
    CountryBox("EU", "Union européenne", -10.5, 35.0, 31.6, 71.2, "LOW"),
]


def resolve_country(lon: float, lat: float) -> Tuple[str, str, RiskLevel]:
    """Retourne (iso2, nom, niveau de risque benchmark) pour un centroïde."""
    for box in COUNTRY_BOXES:
        if box.lon_min <= lon <= box.lon_max and box.lat_min <= lat <= box.lat_max:
            return box.iso2, box.name, box.risk
    return "XX", "Non déterminé", "STANDARD"


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


def _extract_simulated_loss_year(geometry: Dict[str, Any]) -> Optional[int]:
    """Permet aux jeux de démonstration d'imposer une année de perte via `properties.simulated_loss_year`."""
    props = geometry.get("properties") if isinstance(geometry, dict) else None
    if isinstance(props, dict) and props.get("simulated_loss_year") is not None:
        try:
            return int(props["simulated_loss_year"])
        except (TypeError, ValueError):
            return None
    if geometry.get("type") == "FeatureCollection":
        for feature in geometry.get("features") or []:
            year = _extract_simulated_loss_year(feature)
            if year is not None:
                return year
    return None


def _to_shapely(geometry: Dict[str, Any]) -> BaseGeometry:
    gtype = geometry.get("type")
    if gtype == "Feature":
        return shape(geometry["geometry"])
    if gtype == "FeatureCollection":
        from shapely.ops import unary_union

        return unary_union([shape(f["geometry"]) for f in geometry["features"] if f.get("geometry")])
    return shape(geometry)


def _analysis_polygon(geom: BaseGeometry) -> Dict[str, Any]:
    """Pour un point, on analyse un disque ~55 m (0.0005°) ; sinon la géométrie elle-même."""
    if geom.geom_type in {"Point", "MultiPoint"}:
        geom = geom.buffer(0.0005)
    from shapely.geometry import mapping

    return mapping(geom)


# --------------------------------------------------------------------------- Moteur déterministe
def deterministic_check(geom: BaseGeometry, harvest_date: date, forced_loss_year: Optional[int] = None) -> Dict[str, Any]:
    centroid = geom.centroid
    lon, lat = centroid.x, centroid.y
    iso2, country_name, country_risk = resolve_country(lon, lat)
    seed = f"{round(lon, 4)}:{round(lat, 4)}"
    jitter = _stable_fraction(seed)

    loss_year: Optional[int] = forced_loss_year
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
    elif forced_loss_year is not None:
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
            f"Aucune alerte Hansen Tree Cover Loss post-2020 sur l'emprise. Pays : {country_name} ({iso2}), "
            f"benchmark UE : {country_risk}."
        )

    if harvest_date <= settings.eudr_cutoff_date:
        details += " Récolte antérieure à la date butoir : hors champ temporel EUDR."

    return {
        "compliant": compliant,
        "loss_year": loss_year,
        "confidence_score": min(confidence, 1.0),
        "risk_level": risk_level,
        "country_code": iso2,
        "country_risk": country_risk,
        "source": "deterministic-mock (Hansen/GFW rules engine)",
        "loss_area_ha": loss_area,
        "tree_cover_2000_pct": tree_cover,
        "details": details,
    }


# --------------------------------------------------------------------------- Moteur live GFW
def _gfw_query(analysis_geometry: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Interroge GFW Data API : pertes annuelles (ha) sur l'emprise, densité 2000 >= 30 %."""
    url = f"{settings.gfw_api_url.rstrip('/')}/dataset/{settings.gfw_dataset}/latest/query"
    sql = (
        "SELECT umd_tree_cover_loss__year, SUM(area__ha) AS area__ha "
        "FROM results WHERE umd_tree_cover_density_2000__threshold = 30 "
        "GROUP BY umd_tree_cover_loss__year ORDER BY umd_tree_cover_loss__year"
    )
    response = requests.post(
        url,
        headers={"x-api-key": settings.gfw_api_key, "Content-Type": "application/json"},
        data=json.dumps({"sql": sql, "geometry": analysis_geometry}),
        timeout=settings.gfw_timeout_seconds,
    )
    response.raise_for_status()
    payload = response.json()
    return list(payload.get("data") or [])


def live_check(geom: BaseGeometry, harvest_date: date) -> Dict[str, Any]:
    rows = _gfw_query(_analysis_polygon(geom))
    centroid = geom.centroid
    iso2, country_name, country_risk = resolve_country(centroid.x, centroid.y)

    from app.services.gis_validator import geodesic_area_ha

    area_ha = geodesic_area_ha(geom) or 1.0
    post_cutoff_rows = [
        r for r in rows if int(r.get("umd_tree_cover_loss__year") or 0) > settings.eudr_cutoff_date.year
    ]
    all_rows = [r for r in rows if r.get("umd_tree_cover_loss__year")]

    loss_area = round(sum(float(r.get("area__ha") or 0.0) for r in post_cutoff_rows), 4)
    # Seuil de bruit : 0,5 % de la parcelle ou 0,01 ha (~1 pixel Landsat = 0,09 ha, on reste strict)
    significant = loss_area >= max(0.01, area_ha * 0.005)

    if significant:
        loss_year = min(int(r["umd_tree_cover_loss__year"]) for r in post_cutoff_rows)
        fraction = min(loss_area / area_ha, 1.0)
        confidence = round(min(0.99, 0.80 + fraction * 0.5), 3)
        return {
            "compliant": False,
            "loss_year": loss_year,
            "confidence_score": confidence,
            "risk_level": "HIGH",
            "country_code": iso2,
            "country_risk": country_risk,
            "source": "gfw-live (umd_tree_cover_loss)",
            "loss_area_ha": loss_area,
            "tree_cover_2000_pct": None,
            "details": f"GFW : {loss_area} ha de perte détectés à partir de {loss_year} (post-2020) sur {area_ha:.2f} ha.",
        }

    historic_year = max((int(r["umd_tree_cover_loss__year"]) for r in all_rows), default=None)
    return {
        "compliant": True,
        "loss_year": historic_year,
        "confidence_score": 0.95,
        "risk_level": country_risk,
        "country_code": iso2,
        "country_risk": country_risk,
        "source": "gfw-live (umd_tree_cover_loss)",
        "loss_area_ha": loss_area,
        "tree_cover_2000_pct": None,
        "details": (
            f"GFW : aucune perte significative post-2020 ({loss_area} ha). Pays : {country_name}, benchmark UE : {country_risk}."
        ),
    }


# --------------------------------------------------------------------------- API publique
def check_deforestation_risk(geometry: Dict[str, Any], harvest_date: str) -> Dict[str, Any]:
    """Évalue le risque de déforestation post-2020 sur une géométrie GeoJSON.

    :param geometry: Geometry / Feature / FeatureCollection GeoJSON (WGS84).
    :param harvest_date: date de récolte ISO 8601 (YYYY-MM-DD).
    :return: dict conforme à `SatelliteCheckResult` :
             {compliant, loss_year, confidence_score, risk_level, ...}
    """
    parsed_date = date.fromisoformat(harvest_date)
    geom = _to_shapely(geometry)
    forced_year = _extract_simulated_loss_year(geometry)

    if settings.gfw_live_available and forced_year is None:
        try:
            return live_check(geom, parsed_date)
        except (requests.RequestException, ValueError, KeyError) as exc:
            logger.warning("GFW live indisponible (%s) — repli sur le moteur déterministe", exc)

    return deterministic_check(geom, parsed_date, forced_year)
