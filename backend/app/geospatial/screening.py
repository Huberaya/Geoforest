"""Non-persistent, offline country screening prototype.

Callers must authorize access to their own parcel BEFORE calling this module.
No HTTP endpoint exposes this increment. No source failure becomes a match.
"""

import hashlib
import json
import math
import re
from datetime import datetime, timezone

import pycountry
from app.geospatial.references import CATALOGUE, ReferenceUnavailable, read_reference
from app.plots.geometry import validate_geometry
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

METHOD_VERSION = "country-screening-v1-pilot"
LIMITATIONS = [
    "Comparaison indicative avec un référentiel historique, pas une preuve du pays réel.",
    "Résolution et précision métrique non garanties ; côtes, îles et zones disputées nécessitent une revue.",
    "La marge de proximité est un paramètre technique de revue, pas un seuil EUDR ni une précision mesurée.",
    "Aucun verdict de propriété, légalité, risque ou déforestation ; aucune déclaration aux autorités.",
]


def screen_country(conn, geometry, declared_country, *, review_distance_m):
    """Read-only; explicit review band, bounded SQL, no network or repair.

    The parcel is validated even if its country is not covered. Database failures
    inside screening roll back to a savepoint before returning SOURCE_UNAVAILABLE.
    Errors in the prerequisite parcel validator propagate; callers must not treat
    those exceptions as a successful check.
    """
    if not isinstance(declared_country, str) or not re.fullmatch(
        r"[A-Z]{2}", declared_country
    ):
        raise ValueError("DECLARED_COUNTRY_ALPHA2_REQUIRED")
    if (
        type(review_distance_m) not in (int, float)
        or not 0 <= review_distance_m <= 50_000
        or not math.isfinite(review_distance_m)
    ):
        raise ValueError("REVIEW_DISTANCE_OUT_OF_BOUNDS")
    if not pycountry.countries.get(alpha_2=declared_country):
        raise ValueError("DECLARED_COUNTRY_UNKNOWN")
    conn.execute(text("SET LOCAL statement_timeout='8s'"))
    validated = validate_geometry(conn, geometry)
    parcel_json = json.dumps(
        validated["geometry"], sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    result = {
        "status": "NOT_COVERED",
        "declared_country": declared_country,
        "geometry_sha256": hashlib.sha256(parcel_json.encode()).hexdigest(),
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "method_version": METHOD_VERSION,
        "postgis_version": None,
        "method": "PostGIS ST_Covers / ST_Intersects; spheroidal distance to reference boundary",
        "review_distance_m": review_distance_m,
        "distance_to_reference_boundary_m": None,
        "reference_relation": None,
        "source": None,
        "human_review_required": True,
        "regulatory_status": "NOT_ASSESSED",
        "country_verified": False,
        "limitations": list(LIMITATIONS),
    }
    spec = CATALOGUE.get(declared_country)
    if spec is None:
        result["reason"] = "NO_ADMITTED_SOURCE_FOR_DECLARED_COUNTRY"
        return result
    result["source"] = spec.provenance()
    try:
        reference = read_reference(spec)
    except ReferenceUnavailable as exc:
        result.update(status="SOURCE_UNAVAILABLE", reason=str(exc))
        return result
    try:
        with conn.begin_nested():
            params = {"r": json.dumps(reference, allow_nan=False), "p": parcel_json}
            valid = conn.execute(
                text("""SELECT ST_IsValid(g) AND NOT ST_IsEmpty(g)
                FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(:r),4326) g) s"""),
                params,
            ).scalar_one()
            if not valid:
                result.update(
                    status="SOURCE_UNAVAILABLE", reason="REFERENCE_TOPOLOGY_INVALID"
                )
                return result
            facts = (
                conn.execute(
                    text("""WITH shapes AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(:r),4326) r,
                       ST_SetSRID(ST_GeomFromGeoJSON(:p),4326) p)
                SELECT postgis_lib_version() postgis_version, ST_Covers(r,p) covered, ST_Intersects(r,p) intersects,
                  ST_Intersects(ST_Boundary(r),p) touches_boundary,
                  ST_Distance(ST_Boundary(r)::geography,p::geography,true) distance_m
                FROM shapes"""),
                    params,
                )
                .mappings()
                .one()
            )
    except SQLAlchemyError:
        result.update(status="SOURCE_UNAVAILABLE", reason="REFERENCE_QUERY_FAILED")
        return result
    result["postgis_version"] = facts["postgis_version"]
    distance = facts["distance_m"]
    if distance is None or not math.isfinite(distance):
        result.update(status="SOURCE_UNAVAILABLE", reason="REFERENCE_DISTANCE_INVALID")
        return result
    result["distance_to_reference_boundary_m"] = round(distance, 3)
    relation = (
        "COVERED"
        if facts["covered"]
        else "PARTIAL_INTERSECTION"
        if facts["intersects"]
        else "DISJOINT"
    )
    result["reference_relation"] = relation
    if facts["touches_boundary"] or distance <= review_distance_m:
        result["status"] = "BOUNDARY_REVIEW_REQUIRED"
    elif facts["covered"]:
        result["status"] = "INSIDE_REFERENCE_INDICATIVE"
    elif facts["intersects"]:
        # A disjoint MultiPolygon can have one component inside and one outside
        # without any individual polygon crossing the boundary.
        result["status"] = "PARTIAL_REFERENCE_INTERSECTION"
    else:
        result["status"] = "OUTSIDE_REFERENCE_INDICATIVE"
    return result
