"""Validation géométrique des parcelles selon l'EUDR (art. 9(1)(d) du Règlement (UE) 2023/1115).

Règles appliquées :
  * Topologie valide (pas d'auto-intersection, anneaux fermés) — Shapely / GEOS.
  * Surface géodésique sur l'ellipsoïde WGS84 (EPSG:4326) via pyproj.Geod.
  * Évaluation du seuil des 4 ha PAR PARCELLE INDIVIDUELLE (art. 9(1)(d)) :
      - Parcelle >= 4 ha -> polygone obligatoire.
      - Parcelle  < 4 ha -> point OU polygone autorisé.
  * Précision minimale : 6 décimales sur chaque coordonnée (vérifiée sur la chaîne brute ou le flottant).
  * Support des lots composites (mélange de points <4 ha et de polygones >=4 ha sans rejet erroné).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from pyproj import Geod
from shapely.geometry import MultiPoint, MultiPolygon, Point, Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.validation import explain_validity

from app.core.config import settings

_GEOD = Geod(ellps="WGS84")
_SUPPORTED_TYPES = {"Point", "MultiPoint", "Polygon", "MultiPolygon"}


class GeometryExtractionError(ValueError):
    """Levée quand le GeoJSON ne peut pas être interprété."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# --------------------------------------------------------------------------- utils
def _iter_positions(coords: Any) -> Iterable[Tuple[float, float]]:
    """Itère récursivement sur toutes les positions [lon, lat] d'un tableau GeoJSON."""
    if not isinstance(coords, (list, tuple)):
        return
    if len(coords) >= 2 and all(isinstance(c, (int, float)) for c in coords[:2]):
        yield float(coords[0]), float(coords[1])
        return
    for item in coords:
        yield from _iter_positions(item)


def _decimals(value: Any) -> int:
    """Nombre de décimales significatives de la valeur."""
    if isinstance(value, str):
        s = value.strip().replace('"', "")
        if "." in s:
            return len(s.split(".")[1].rstrip("0")) or len(s.split(".")[1])
        return 0
    text = repr(float(value))
    if "e" in text or "E" in text:
        mantissa, exp = text.lower().split("e")
        exponent = int(exp)
        frac = mantissa.split(".")[1] if "." in mantissa else ""
        return max(0, len(frac) - exponent)
    if "." not in text:
        return 0
    frac = text.split(".")[1]
    return 0 if frac == "0" else len(frac)


def min_decimals_from_json_text(text: str) -> Optional[int]:
    """Nombre de décimales réellement écrites dans le fichier source.

    ⚠️ La mesure ne peut pas se faire sur les valeurs parsées : ``json.loads``
    transforme ``-5.500000`` en ``-5.5``, ce qui détruit l'information de
    précision et provoquait 92 % de faux rejets (P0-05). On lit donc les
    littéraux du texte d'origine, à l'intérieur des seuls tableaux
    "coordinates".
    """
    minimum: Optional[int] = None
    index = text.find('"coordinates"')

    while index != -1:
        colon = text.find(":", index)
        if colon == -1:
            break
        start = colon + 1
        while start < len(text) and text[start].isspace():
            start += 1
        if start >= len(text) or text[start] != "[":
            break

        depth = 0
        end = start
        while end < len(text):
            if text[end] == "[":
                depth += 1
            elif text[end] == "]":
                depth -= 1
                if depth == 0:
                    break
            end += 1

        for literal in re.findall(r"-?\d+(?:\.\d+)?", text[start : end + 1]):
            decimals = len(literal.split(".")[1]) if "." in literal else 0
            minimum = decimals if minimum is None else min(minimum, decimals)

        index = text.find('"coordinates"', end)

    return minimum


def _decimals_from_values(positions: Sequence[Tuple[float, float]]) -> int:
    return min(min(_decimals(lon), _decimals(lat)) for lon, lat in positions)


@dataclass
class SinglePlotItem:
    geometry: Dict[str, Any]
    properties: Dict[str, Any]
    feature_index: int


def _collect_plot_items(geojson: Dict[str, Any]) -> List[SinglePlotItem]:
    """Retourne la liste des parcelles individuelles contenues dans le GeoJSON."""
    if not isinstance(geojson, dict) or "type" not in geojson:
        raise GeometryExtractionError("INVALID_GEOJSON", "Objet GeoJSON invalide : champ 'type' manquant")

    gtype = geojson.get("type")
    if gtype == "FeatureCollection":
        features = geojson.get("features") or []
        if not features:
            raise GeometryExtractionError("EMPTY_COLLECTION", "FeatureCollection vide")
        items: List[SinglePlotItem] = []
        for idx, feat in enumerate(features):
            if isinstance(feat, dict) and feat.get("geometry"):
                items.append(
                    SinglePlotItem(
                        geometry=feat["geometry"],
                        properties=feat.get("properties") or {},
                        feature_index=idx,
                    )
                )
        if not items:
            raise GeometryExtractionError("EMPTY_COLLECTION", "Aucune géométrie dans la FeatureCollection")
        return items

    if gtype == "Feature":
        geom = geojson.get("geometry")
        if not geom:
            raise GeometryExtractionError("MISSING_GEOMETRY", "Feature sans géométrie")
        return [SinglePlotItem(geometry=geom, properties=geojson.get("properties") or {}, feature_index=0)]

    if gtype == "GeometryCollection":
        geoms = geojson.get("geometries") or []
        if not geoms:
            raise GeometryExtractionError("EMPTY_COLLECTION", "GeometryCollection vide")
        return [SinglePlotItem(geometry=g, properties={}, feature_index=idx) for idx, g in enumerate(geoms)]

    return [SinglePlotItem(geometry=geojson, properties={}, feature_index=0)]


def _check_rings_closed(geom: Dict[str, Any]) -> List[str]:
    """Vérifie que chaque anneau d'un (Multi)Polygon est explicitement fermé."""
    problems: List[str] = []
    gtype = geom.get("type")
    rings: List[List[Any]] = []
    if gtype == "Polygon":
        rings = list(geom.get("coordinates") or [])
    elif gtype == "MultiPolygon":
        for poly in geom.get("coordinates") or []:
            rings.extend(poly)
    for idx, ring in enumerate(rings):
        if not isinstance(ring, list) or len(ring) < 4:
            problems.append(f"anneau #{idx + 1} : un polygone fermé requiert au moins 4 positions")
            continue
        first, last = ring[0], ring[-1]
        if list(first[:2]) != list(last[:2]):
            problems.append(f"anneau #{idx + 1} : première et dernière position différentes (anneau non fermé)")
    return problems


def geodesic_area_ha(geom: BaseGeometry) -> float:
    """Surface géodésique (WGS84) en hectares. Points -> 0."""
    if geom.is_empty or geom.geom_type in {"Point", "MultiPoint"}:
        return 0.0
    area_m2, _ = _GEOD.geometry_area_perimeter(geom)
    return abs(area_m2) / 10_000.0


def _round_coords(coords: Any, decimals: Optional[int] = None) -> Any:
    decimals = decimals if decimals is not None else settings.eudr_is_coordinate_decimals
    if isinstance(coords, (list, tuple)):
        if coords and all(isinstance(c, (int, float)) for c in coords):
            return [round(float(c), decimals) for c in coords]
        return [_round_coords(c, decimals) for c in coords]
    return coords


def _round_geometry(geom: BaseGeometry, decimals: int = 8) -> Dict[str, Any]:
    """Sérialise en GeoJSON avec un arrondi stable (8 décimales ≈ 1 mm)."""
    raw = mapping(geom)
    return {"type": raw["type"], "coordinates": _round_coords(raw["coordinates"], decimals or settings.eudr_is_coordinate_decimals)}


# --------------------------------------------------------------------------- API
def validate_geometry(
    geojson: Dict[str, Any],
    declared_area_ha: Optional[float] = None,
    raw_text: Optional[str] = None,
) -> Dict[str, Any]:
    """Valide une géométrie GeoJSON de parcelle contre les règles EUDR.

    Gère à la fois les parcelles uniques et les lots multi-parcelles avec
    application de la règle des 4 ha par parcelle individuelle.

    Args:
        declared_area_ha: surface déclarée par l'opérateur (saisie en base,
            jamais issue du fichier déposé — cf. P0-03).
        raw_text: texte JSON d'origine. Indispensable pour mesurer la précision
            sans la détruire (cf. P0-05). S'il est absent, la précision est
            mesurée sur les valeurs parsées : le résultat est alors inexact et
            accompagné de l'avertissement PRECISION_APPROXIMATED.
    """
    errors: List[Dict[str, str]] = []
    warnings: List[Dict[str, str]] = []
    result: Dict[str, Any] = {
        "valid": False,
        "geometry_type": None,
        "area_ha": 0.0,
        "vertex_count": 0,
        "centroid": None,
        "bbox": None,
        "precision_ok": True,
        "min_decimals_found": None,
        "eudr_geometry_rule": "POINT_ALLOWED",
        "errors": errors,
        "warnings": warnings,
        "normalized_geometry": None,
    }

    # 1. Extraction des parcelles --------------------------------------------
    try:
        plot_items = _collect_plot_items(geojson)
    except GeometryExtractionError as exc:
        errors.append({"code": exc.code, "message": exc.message})
        return result

    is_multi_feature = len(plot_items) > 1 or geojson.get("type") == "FeatureCollection"
    types_found = {p.geometry.get("type") for p in plot_items if isinstance(p.geometry, dict)}

    # Vérification des types supportés
    for t in types_found:
        if t not in _SUPPORTED_TYPES:
            errors.append(
                {
                    "code": "UNSUPPORTED_GEOMETRY_TYPE",
                    "message": f"Type '{t}' non supporté. EUDR : Point, MultiPoint, Polygon ou MultiPolygon",
                }
            )
            return result

    # 2. Collecte des coordonnées et vérification précision ------------------
    all_positions: List[Tuple[float, float]] = []
    for item in plot_items:
        coords = item.geometry.get("coordinates")
        pos = list(_iter_positions(coords))
        if not pos:
            errors.append(
                {
                    "code": "EMPTY_COORDINATES",
                    "message": f"Parcelle #{item.feature_index + 1} : aucune coordonnée trouvée",
                }
            )
            return result
        all_positions.extend(pos)

    result["vertex_count"] = len(all_positions)

    out_of_range = [
        (lon, lat)
        for lon, lat in all_positions
        if not (-180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0)
        or math.isnan(lon)
        or math.isnan(lat)
    ]
    if out_of_range:
        lon, lat = out_of_range[0]
        errors.append(
            {
                "code": "COORDINATES_OUT_OF_RANGE",
                "message": f"Coordonnée hors WGS84 : [{lon}, {lat}] (attendu lon ∈ [-180,180], lat ∈ [-90,90], ordre [lon, lat])",
            }
        )
        return result

    # Précision mesurée sur le texte source quand il est fourni (exact),
    # sinon sur les valeurs parsées (approximation signalée).
    min_decimals = _decimals_from_values(all_positions)
    if raw_text:
        from_text = min_decimals_from_json_text(raw_text)
        if from_text is not None:
            min_decimals = from_text
        else:
            warnings.append(
                {
                    "code": "PRECISION_APPROXIMATED",
                    "message": "Précision mesurée sur les valeurs parsées : le texte source n'a pas permis de l'établir.",
                }
            )
    else:
        warnings.append(
            {
                "code": "PRECISION_APPROXIMATED",
                "message": "Texte source absent : la précision est mesurée sur les valeurs parsées et peut être sous-estimée.",
            }
        )

    result["min_decimals_found"] = min_decimals
    if min_decimals < settings.eudr_min_coordinate_decimals:
        result["precision_ok"] = False
        errors.append(
            {
                "code": "INSUFFICIENT_PRECISION",
                "message": (
                    f"Précision insuffisante : {min_decimals} décimale(s) détectée(s), "
                    f"EUDR exige au moins {settings.eudr_min_coordinate_decimals} décimales (~11 cm)"
                ),
            }
        )

    # 3. Anneaux fermés & Topologie Shapely par parcelle ---------------------
    shapely_geoms: List[BaseGeometry] = []
    plot_areas: List[float] = []
    has_polygon_required = False
    normalized_features: List[Dict[str, Any]] = []

    num_points = sum(1 for p in plot_items if p.geometry.get("type") in {"Point", "MultiPoint"})
    per_point_declared_area = (
        (float(declared_area_ha) / num_points) if (declared_area_ha is not None and num_points > 0) else None
    )

    for item in plot_items:
        raw_g = item.geometry
        gtype = raw_g.get("type")
        is_point = gtype in {"Point", "MultiPoint"}

        # Anneaux
        for prob in _check_rings_closed(raw_g):
            errors.append({"code": "RING_NOT_CLOSED", "message": f"Parcelle #{item.feature_index + 1} : {prob}"})

        # Topologie
        try:
            sh_geom: BaseGeometry = shape(raw_g)
        except Exception as exc:
            errors.append({"code": "SHAPE_ERROR", "message": f"Parcelle #{item.feature_index + 1} illisible : {exc}"})
            return result

        if sh_geom.is_empty:
            errors.append({"code": "EMPTY_GEOMETRY", "message": f"Parcelle #{item.feature_index + 1} : géométrie vide"})
            return result

        if not sh_geom.is_valid:
            reason = explain_validity(sh_geom)
            code = "SELF_INTERSECTION" if "Self-intersection" in reason or "Ring Self-intersection" in reason else "INVALID_TOPOLOGY"
            errors.append({"code": code, "message": f"Parcelle #{item.feature_index + 1} topologie invalide : {reason}"})
            return result

        if isinstance(sh_geom, (Polygon, MultiPolygon)) and sh_geom.area == 0:
            errors.append({"code": "DEGENERATE_POLYGON", "message": f"Parcelle #{item.feature_index + 1} : polygone de surface nulle"})
            return result

        shapely_geoms.append(sh_geom)

        # 4. Surface & règle des 4 ha PAR PARCELLE INDIVIDUELLE (art. 9(1)(d))
        if is_point:
            # P0-03 : la surface d'un point est une DONNÉE DÉCLARATIVE. Elle ne
            # peut provenir que de la saisie de l'opérateur, jamais d'une
            # propriété du fichier GeoJSON : un fichier est une pièce fournie
            # par un tiers et n'est pas une source de vérité.
            plot_dec_area = per_point_declared_area
            effective_plot_area = plot_dec_area or 0.0
            plot_areas.append(effective_plot_area)

            if effective_plot_area > settings.eudr_polygon_threshold_ha:
                has_polygon_required = True
                name_str = item.properties.get("name") or f"Parcelle #{item.feature_index + 1}"
                errors.append(
                    {
                        "code": "POLYGON_REQUIRED",
                        "message": (
                            f"{name_str} : surface {effective_plot_area:.2f} ha > {settings.eudr_polygon_threshold_ha} ha. "
                            "L'EUDR exige un polygone (art. 9(1)(d)), un point n'est pas suffisant."
                        ),
                    }
                )
            elif plot_dec_area is None and declared_area_ha is None:
                warnings.append(
                    {
                        "code": "POINT_WITHOUT_DECLARED_AREA",
                        "message": f"Parcelle #{item.feature_index + 1} par point sans surface déclarée : supposée < 4 ha",
                    }
                )
        else:
            poly_area = geodesic_area_ha(sh_geom)
            plot_areas.append(poly_area)
            if poly_area > settings.eudr_polygon_threshold_ha:
                has_polygon_required = True

        norm_g = _round_geometry(sh_geom)
        norm_props = dict(item.properties)
        norm_props["area_ha"] = round(plot_areas[-1], 4)
        normalized_features.append({"type": "Feature", "properties": norm_props, "geometry": norm_g})

    if any(e["code"] == "RING_NOT_CLOSED" for e in errors):
        return result

    # 5. Métriques globales du dossier ---------------------------------------
    geodesic_total_ha = sum(geodesic_area_ha(sh) for sh in shapely_geoms)
    result["area_ha"] = round(geodesic_total_ha, 4)
    result["eudr_geometry_rule"] = "POLYGON_REQUIRED" if has_polygon_required else "POINT_ALLOWED"

    # Centroid & Bounding Box
    all_lons = [p[0] for p in all_positions]
    all_lats = [p[1] for p in all_positions]
    result["centroid"] = [round(sum(all_lons) / len(all_lons), 6), round(sum(all_lats) / len(all_lats), 6)]
    result["bbox"] = [
        round(min(all_lons), 6),
        round(min(all_lats), 6),
        round(max(all_lons), 6),
        round(max(all_lats), 6),
    ]

    # Construction de la géométrie normalisée
    if len(plot_items) == 1 and not is_multi_feature:
        result["geometry_type"] = plot_items[0].geometry.get("type")
        result["normalized_geometry"] = normalized_features[0]["geometry"]
    else:
        point_count = sum(1 for p in plot_items if p.geometry.get("type") in {"Point", "MultiPoint"})
        poly_count = len(plot_items) - point_count
        if point_count > 0 and poly_count > 0:
            result["geometry_type"] = "FeatureCollection"
            warnings.append(
                {
                    "code": "COMPOSITE_BATCH",
                    "message": f"Lot composite : {point_count} point(s) (< 4 ha) et {poly_count} polygone(s)",
                }
            )
        elif poly_count > 1:
            result["geometry_type"] = "MultiPolygon"
        elif point_count > 1:
            result["geometry_type"] = "MultiPoint"
        else:
            result["geometry_type"] = "FeatureCollection"

        result["normalized_geometry"] = {
            "type": "FeatureCollection",
            "features": normalized_features,
        }

    if geodesic_total_ha > 100_000:
        warnings.append(
            {
                "code": "SUSPICIOUS_AREA",
                "message": f"Surface totale anormalement grande ({geodesic_total_ha:,.0f} ha) : vérifiez l'ordre [lon, lat]",
            }
        )

    result["valid"] = len(errors) == 0
    return result
