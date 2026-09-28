"""Bounded, non-destructive geolocation checks. No legal compliance verdict.

This module is not an authorization boundary: callers must authenticate and apply
supplier/tenant authorization before reading existing geometries or writing data.
It never fetches any external resource or repairs a supplied geometry.
"""

import json
import math
from decimal import ROUND_DOWN, Decimal

from fastapi import HTTPException
from sqlalchemy import text

MAX_POSITIONS = 10_000
# Explicit MVP computational limit, not an EUDR threshold.
MAX_AREA_HA = 100_000
SUPPORTED = {"Point", "Polygon", "MultiPolygon"}
LAW_URL = (
    "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20251226"
)
IS_URL = "https://acceptance.eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html"


def invalid(code, message):
    raise HTTPException(422, {"code": code, "message": message})


def structure(geometry):
    """Validate dimensionality/budgets before asking PostGIS to parse input."""
    if not isinstance(geometry, dict):
        invalid("GEOMETRY_OBJECT_REQUIRED", "Une géométrie GeoJSON est attendue")
    if "crs" in geometry:
        invalid(
            "CRS_NOT_SUPPORTED",
            "Convertissez explicitement la source en WGS84 EPSG:4326",
        )
    kind = geometry.get("type")
    if not isinstance(kind, str) or kind not in SUPPORTED:
        invalid(
            "GEOMETRY_TYPE_NOT_SUPPORTED",
            "Types pris en charge : Point, Polygon, MultiPolygon",
        )
    if set(geometry) - {"type", "coordinates", "bbox"}:
        invalid(
            "UNSUPPORTED_GEOMETRY_MEMBER", "Propriété de géométrie non prise en charge"
        )
    count = 0
    positions = []

    def position(value):
        nonlocal count
        if not isinstance(value, list) or len(value) != 2:
            invalid(
                "POSITION_2D_REQUIRED",
                "Une position doit contenir longitude puis latitude, sans altitude",
            )
        if any(
            type(n) not in (int, float) or (type(n) is float and not math.isfinite(n))
            for n in value
        ):
            invalid(
                "NON_FINITE_COORDINATE",
                "Les coordonnées doivent être des nombres finis",
            )
        if not -180 <= value[0] <= 180 or not -90 <= value[1] <= 90:
            invalid(
                "COORDINATE_OUT_OF_RANGE",
                "Longitude entre -180 et 180 ; latitude entre -90 et 90",
            )
        count += 1
        if count > MAX_POSITIONS:
            invalid(
                "POSITION_LIMIT", "Limite technique : 10 000 positions par géométrie"
            )
        positions.append(value)

    def polygon(rings):
        if not isinstance(rings, list) or not rings or len(rings) > MAX_POSITIONS:
            invalid(
                "POLYGON_RINGS_REQUIRED", "Le polygone doit contenir au moins un anneau"
            )
        for ring in rings:
            if not isinstance(ring, list) or len(ring) < 4:
                invalid(
                    "RING_TOO_SHORT",
                    "Un anneau exige au moins quatre positions, fermeture incluse",
                )
            if len(ring) > MAX_POSITIONS:
                invalid(
                    "POSITION_LIMIT",
                    "Limite technique : 10 000 positions par géométrie",
                )
            for pair in ring:
                position(pair)
            if ring[0] != ring[-1]:
                invalid(
                    "OPEN_RING",
                    "Anneau ouvert : la première et la dernière position doivent être identiques",
                )
            if any(abs(a[0] - b[0]) > 180 for a, b in zip(ring, ring[1:])):
                invalid(
                    "ANTIMERIDIAN_NOT_SUPPORTED",
                    "Découpez explicitement la source à l’antiméridien avant import",
                )
            if any(abs(pair[1]) > 85 for pair in ring):
                invalid(
                    "POLAR_POLYGON_NOT_SUPPORTED",
                    "Les polygones au-delà de 85° de latitude ne sont pas pris en charge dans ce pilote",
                )

    coords = geometry.get("coordinates")
    if kind == "Point":
        position(coords)
    elif kind == "Polygon":
        polygon(coords)
    else:
        if not isinstance(coords, list) or not coords or len(coords) > MAX_POSITIONS:
            invalid(
                "MULTIPOLYGON_EMPTY",
                "Le multipolygone doit contenir au moins un polygone",
            )
        for rings in coords:
            polygon(rings)
    # An input bbox is not trusted; all derived bounds are computed from coordinates.
    canonical = {"type": kind, "coordinates": coords}
    return canonical, positions


def _truncate_six(value):
    if isinstance(value, list):
        return [_truncate_six(v) for v in value]
    return float(Decimal(str(value)).quantize(Decimal("0.000001"), rounding=ROUND_DOWN))


def _postgis(conn, geometry):
    # No ST_MakeValid/ST_SnapToGrid: preserve input and explicitly report failures.
    return dict(
        conn.execute(
            text("""
        WITH value AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(:raw),4326) AS geom)
        SELECT ST_IsValid(geom) AS valid,
               ST_IsValidReason(geom) AS reason,
               ST_IsEmpty(geom) AS empty,
               CASE WHEN ST_IsValid(geom) AND GeometryType(geom) IN ('POLYGON','MULTIPOLYGON')
                    THEN ST_Area(geom::geography,true)/10000.0 END AS area_ha
        FROM value
    """),
            {"raw": json.dumps(geometry, allow_nan=False)},
        )
        .mappings()
        .one()
    )


def validate_geometry(conn, geometry, declared_area_ha=None, commodity=None):
    """Validate one caller-supplied geometry and return explanatory checks.

    No tenant geometry search occurs here. Advisory fields never authorize a
    declaration, establish a country's identity or classify EUDR applicability.
    """
    canonical, positions = structure(geometry)
    if commodity not in {
        None,
        "coffee",
        "cocoa",
        "wood",
        "rubber",
        "soya",
        "palm_oil",
        "cattle",
    }:
        invalid("COMMODITY_INVALID", "Matière déclarée inconnue")
    area = None
    if declared_area_ha is not None:
        try:
            if isinstance(declared_area_ha, bool):
                raise ValueError
            area = Decimal(str(declared_area_ha))
            if not area.is_finite() or area <= 0 or area > MAX_AREA_HA:
                raise ValueError
        except (ValueError, ArithmeticError):
            invalid(
                "DECLARED_AREA_INVALID",
                "Surface déclarée positive, finie et au maximum 100 000 ha dans ce pilote",
            )
    actual = _postgis(conn, canonical)
    if actual["empty"] or not actual["valid"]:
        invalid("INVALID_TOPOLOGY", "Géométrie invalide : " + actual["reason"])
    if canonical["type"] != "Point":
        if actual["area_ha"] is None or actual["area_ha"] <= 0:
            invalid("ZERO_AREA", "Le polygone doit délimiter une surface positive")
        if actual["area_ha"] > MAX_AREA_HA:
            invalid(
                "AREA_TECHNICAL_LIMIT",
                "Surface supérieure à la limite technique de 100 000 ha du pilote",
            )
    truncated = {
        "type": canonical["type"],
        "coordinates": _truncate_six(canonical["coordinates"]),
    }
    transformed = _postgis(conn, truncated)
    warnings = []
    rings = (
        [canonical["coordinates"]]
        if canonical["type"] == "Polygon"
        else canonical["coordinates"]
        if canonical["type"] == "MultiPolygon"
        else []
    )
    if any(len(p) > 1 for p in rings):
        warnings.append(
            {
                "code": "IS_HOLES_NOT_SUPPORTED",
                "message": "Trous valides techniquement, mais non pris en charge selon la documentation IS consultée",
                "source": IS_URL,
            }
        )
    if not transformed["valid"] or (
        canonical["type"] != "Point" and not transformed["area_ha"]
    ):
        warnings.append(
            {
                "code": "IS_TRUNCATION_INVALIDATES",
                "message": "La troncature à six décimales invalide cette géométrie ; la source est conservée sans correction",
                "source": IS_URL,
            }
        )
    elif truncated != canonical:
        warnings.append(
            {
                "code": "IS_TRUNCATION_CHANGES",
                "message": "La troncature à six décimales modifie les coordonnées ; aucun envoi officiel n’a été testé",
                "source": IS_URL,
            }
        )
    if canonical["type"] == "Point":
        warnings.append(
            {
                "code": "POINT_HAS_NO_CALCULATED_AREA",
                "message": "Un point ne permet pas de calculer une superficie",
            }
        )
        if area is None:
            warnings.append(
                {
                    "code": "AREA_UNKNOWN",
                    "message": "Surface déclarée inconnue ; aucune valeur de 4 ha n’est inventée",
                }
            )
        elif area > 4 and commodity not in {None, "cattle"}:
            warnings.append(
                {
                    "code": "POLYGON_REQUIRED_IF_STANDARD_REGIME",
                    "message": "Plus de 4 ha hors bovins : un polygone est requis au titre de l’article 2(28), sous réserve du régime applicable à qualifier",
                    "source": LAW_URL,
                }
            )
        if abs(positions[0][1]) > 85:
            warnings.append(
                {
                    "code": "MAP_LATITUDE_LIMIT",
                    "message": "Point valide hors de la zone d’affichage courante de la carte du pilote",
                }
            )
    if area and actual["area_ha"]:
        discrepancy = abs(Decimal(str(actual["area_ha"])) - area) / area
        if discrepancy > Decimal("0.1"):
            warnings.append(
                {
                    "code": "AREA_DISCREPANCY",
                    "message": "Écart supérieur au seuil technique indicatif de 10 % entre surfaces déclarée et calculée ; à vérifier, pas un verdict réglementaire",
                }
            )
    return {
        "geometry": canonical,
        "geometry_type": canonical["type"],
        "position_count": len(positions),
        "calculated_area_ha": actual["area_ha"],
        "declared_area_ha": str(area) if area is not None else None,
        "bbox": [
            min(p[0] for p in positions),
            min(p[1] for p in positions),
            max(p[0] for p in positions),
            max(p[1] for p in positions),
        ],
        "technical_status": "VALID",
        "regulatory_status": "NOT_ASSESSED",
        "official_system_status": "NOT_TESTED",
        "measurement_accuracy": "NOT_ESTABLISHED_BY_DECIMAL_COUNT",
        "method": "PostGIS ST_IsValid; ST_Area geography WGS84 spheroid; non-destructive six-decimal truncation check",
        "validator_version": "plots-v1-draft",
        "warnings": warnings,
    }
