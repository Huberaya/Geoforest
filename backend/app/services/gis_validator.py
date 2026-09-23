"""Validation géométrique des parcelles selon l'EUDR (art. 9(1)(d) du Règlement (UE) 2023/1115).

Règles appliquées :
  * Topologie valide (pas d'auto-intersection, anneaux fermés) — Shapely / GEOS.
  * Surface géodésique sur l'ellipsoïde WGS84 (EPSG:4326) via pyproj.Geod.
  * Surface >= 4 ha  -> polygone obligatoire.
  * Surface  < 4 ha  -> point OU polygone autorisé.
  * Précision minimale : 6 décimales sur chaque coordonnée.
"""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional, Tuple

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


def _decimals(value: float) -> int:
    """Nombre de décimales significatives de la représentation la plus courte du flottant."""
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


def _collect_geometries(geojson: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Retourne la liste des géométries brutes contenues dans un objet GeoJSON."""
    if not isinstance(geojson, dict) or "type" not in geojson:
        raise GeometryExtractionError("INVALID_GEOJSON", "Objet GeoJSON invalide : champ 'type' manquant")

    gtype = geojson["type"]
    if gtype == "FeatureCollection":
        features = geojson.get("features") or []
        if not features:
            raise GeometryExtractionError("EMPTY_COLLECTION", "FeatureCollection vide")
        geoms: List[Dict[str, Any]] = []
        for feature in features:
            geom = feature.get("geometry") if isinstance(feature, dict) else None
            if geom:
                geoms.append(geom)
        if not geoms:
            raise GeometryExtractionError("EMPTY_COLLECTION", "Aucune géométrie dans la FeatureCollection")
        return geoms
    if gtype == "Feature":
        geom = geojson.get("geometry")
        if not geom:
            raise GeometryExtractionError("MISSING_GEOMETRY", "Feature sans géométrie")
        return [geom]
    if gtype == "GeometryCollection":
        geoms = geojson.get("geometries") or []
        if not geoms:
            raise GeometryExtractionError("EMPTY_COLLECTION", "GeometryCollection vide")
        return list(geoms)
    return [geojson]


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


def _merge_geometries(geoms: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Fusionne plusieurs géométries homogènes en une seule (Multi*)."""
    if len(geoms) == 1:
        return geoms[0]
    types = {g.get("type") for g in geoms}
    if types <= {"Polygon", "MultiPolygon"}:
        polygons: List[List[Any]] = []
        for g in geoms:
            if g["type"] == "Polygon":
                polygons.append(g["coordinates"])
            else:
                polygons.extend(g["coordinates"])
        return {"type": "MultiPolygon", "coordinates": polygons}
    if types <= {"Point", "MultiPoint"}:
        points: List[Any] = []
        for g in geoms:
            if g["type"] == "Point":
                points.append(g["coordinates"])
            else:
                points.extend(g["coordinates"])
        return {"type": "MultiPoint", "coordinates": points}
    raise GeometryExtractionError(
        "MIXED_GEOMETRY_TYPES",
        f"Types de géométries hétérogènes non supportés dans un même dossier : {sorted(types)}",
    )


def geodesic_area_ha(geom: BaseGeometry) -> float:
    """Surface géodésique (WGS84) en hectares. Points -> 0."""
    if geom.is_empty or geom.geom_type in {"Point", "MultiPoint"}:
        return 0.0
    area_m2, _ = _GEOD.geometry_area_perimeter(geom)
    return abs(area_m2) / 10_000.0


def _round_geometry(geom: BaseGeometry, decimals: int = 8) -> Dict[str, Any]:
    """Sérialise en GeoJSON avec un arrondi stable (8 décimales ≈ 1 mm)."""
    raw = mapping(geom)

    def _round(coords: Any) -> Any:
        if isinstance(coords, (list, tuple)):
            if coords and all(isinstance(c, (int, float)) for c in coords):
                return [round(float(c), decimals) for c in coords]
            return [_round(c) for c in coords]
        return coords

    return {"type": raw["type"], "coordinates": _round(raw["coordinates"])}


# --------------------------------------------------------------------------- API
def validate_geometry(geojson: Dict[str, Any], declared_area_ha: Optional[float] = None) -> Dict[str, Any]:
    """Valide une géométrie GeoJSON de parcelle contre les règles EUDR.

    Retourne un dictionnaire sérialisable conforme à `GeometryValidationResult`.
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

    # 1. Extraction ----------------------------------------------------------
    try:
        raw_geoms = _collect_geometries(geojson)
        if len(raw_geoms) > 1:
            warnings.append(
                {
                    "code": "MULTIPLE_FEATURES_MERGED",
                    "message": f"{len(raw_geoms)} géométries fusionnées en une seule parcelle multi-partie",
                }
            )
        raw_geom = _merge_geometries(raw_geoms)
    except GeometryExtractionError as exc:
        errors.append({"code": exc.code, "message": exc.message})
        return result

    gtype = raw_geom.get("type")
    result["geometry_type"] = gtype
    if gtype not in _SUPPORTED_TYPES:
        errors.append(
            {
                "code": "UNSUPPORTED_GEOMETRY_TYPE",
                "message": f"Type '{gtype}' non supporté. EUDR : Point, MultiPoint, Polygon ou MultiPolygon",
            }
        )
        return result

    # 2. Coordonnées : plage WGS84 + précision -------------------------------
    positions = list(_iter_positions(raw_geom.get("coordinates")))
    if not positions:
        errors.append({"code": "EMPTY_COORDINATES", "message": "Aucune coordonnée trouvée"})
        return result
    result["vertex_count"] = len(positions)

    out_of_range = [
        (lon, lat)
        for lon, lat in positions
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

    min_decimals = min(min(_decimals(lon), _decimals(lat)) for lon, lat in positions)
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

    # 3. Anneaux fermés ------------------------------------------------------
    for problem in _check_rings_closed(raw_geom):
        errors.append({"code": "RING_NOT_CLOSED", "message": f"Polygone non fermé — {problem}"})
    if any(e["code"] == "RING_NOT_CLOSED" for e in errors):
        return result

    # 4. Topologie (Shapely / GEOS) ------------------------------------------
    try:
        geom: BaseGeometry = shape(raw_geom)
    except Exception as exc:  # noqa: BLE001 — on remonte l'erreur GEOS telle quelle
        errors.append({"code": "SHAPE_ERROR", "message": f"Géométrie illisible : {exc}"})
        return result

    if geom.is_empty:
        errors.append({"code": "EMPTY_GEOMETRY", "message": "Géométrie vide"})
        return result

    if not geom.is_valid:
        reason = explain_validity(geom)
        code = "SELF_INTERSECTION" if "Self-intersection" in reason or "Ring Self-intersection" in reason else "INVALID_TOPOLOGY"
        errors.append({"code": code, "message": f"Topologie invalide : {reason}"})
        return result

    if isinstance(geom, (Polygon, MultiPolygon)) and geom.area == 0:
        errors.append({"code": "DEGENERATE_POLYGON", "message": "Polygone dégénéré (surface nulle)"})
        return result

    # 5. Surface & règle des 4 ha --------------------------------------------
    area_ha = geodesic_area_ha(geom)
    is_point = isinstance(geom, (Point, MultiPoint))
    effective_area = area_ha if not is_point else float(declared_area_ha or 0.0)
    result["area_ha"] = round(area_ha, 4)
    centroid = geom.centroid
    result["centroid"] = [round(centroid.x, 6), round(centroid.y, 6)]
    result["bbox"] = [round(v, 6) for v in geom.bounds]

    if effective_area >= settings.eudr_polygon_threshold_ha:
        result["eudr_geometry_rule"] = "POLYGON_REQUIRED"
        if is_point:
            errors.append(
                {
                    "code": "POLYGON_REQUIRED",
                    "message": (
                        f"Surface déclarée {effective_area:.2f} ha ≥ {settings.eudr_polygon_threshold_ha} ha : "
                        "l'EUDR exige un polygone (art. 9(1)(d)), un point n'est pas suffisant"
                    ),
                }
            )
    else:
        result["eudr_geometry_rule"] = "POINT_ALLOWED"
        if is_point and declared_area_ha is None:
            warnings.append(
                {
                    "code": "POINT_WITHOUT_DECLARED_AREA",
                    "message": "Parcelle géolocalisée par point sans surface déclarée : supposée < 4 ha",
                }
            )

    if not is_point and area_ha > 100_000:
        warnings.append(
            {
                "code": "SUSPICIOUS_AREA",
                "message": f"Surface anormalement grande ({area_ha:,.0f} ha) : vérifiez l'ordre [lon, lat]",
            }
        )

    result["normalized_geometry"] = _round_geometry(geom)
    result["valid"] = len(errors) == 0
    return result
