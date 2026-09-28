"""Pinned public reference data. No fetching, reprojection or silent repair.

Only CI is admitted for indicative screening in this first increment. FRA is
archived for rejected-source qualification, never used as a country boundary.
A country outline is NOT a parcel: its surface has no parcel-area limit.
"""

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path

MAX_SOURCE_BYTES = 4 * 1024 * 1024
MAX_REFERENCE_POSITIONS = 250_000
ROOT = Path(__file__).resolve().parents[2] / "reference" / "geoboundaries"


class ReferenceUnavailable(ValueError):
    """Fixed machine-readable diagnostics, never raw source content."""


@dataclass(frozen=True)
class ReferenceSpec:
    country: str
    iso3: str
    filename: str
    sha256: str
    boundary_id: str
    represented_year: str
    upstream_commit: str
    downloaded_on: str
    built_on: str
    primary_source: str
    primary_license: str

    def provenance(self):
        return {
            "provider": "geoBoundaries gbOpen",
            "country": self.country,
            "boundary_id": self.boundary_id,
            "upstream_commit": self.upstream_commit,
            "sha256": self.sha256,
            "represented_year": self.represented_year,
            "downloaded_on": self.downloaded_on,
            "built_on": self.built_on,
            "primary_source": self.primary_source,
            "primary_license": self.primary_license,
            "collection_license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "source_url": "https://www.geoboundaries.org/",
            "download_url": (
                "https://raw.githubusercontent.com/wmgeolab/geoBoundaries/"
                f"{self.upstream_commit}/releaseData/gbOpen/{self.iso3}/ADM0/"
                f"geoBoundaries-{self.iso3}-ADM0.geojson"
            ),
            "attribution": "geoBoundaries — Runfola et al. (2020), doi:10.1371/journal.pone.0231866; Natural Earth",
            "qualification": "HISTORICAL_INDICATIVE_ONLY",
            "accuracy_m": None,
            "coordinate_handling": "OGC CRS84 longitude/latitude; unchanged coordinates, no reprojection",
        }


CIV = ReferenceSpec(
    country="CI",
    iso3="CIV",
    filename="CIV.geojson",
    sha256="423151fa6f9ab251bf97e6beff43a0c5ce6c0ba3163ba4004bdb94711b3ed108",
    boundary_id="CIV-ADM0-2848817",
    represented_year="2018",
    upstream_commit="9469f09592ced973a3448cf66b6100b741b64c0d",
    downloaded_on="2026-09-28",
    built_on="2023-12-12",
    primary_source="Natural Earth",
    primary_license="Public Domain",
)
CATALOGUE = {"CI": CIV}


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ReferenceUnavailable("DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def reference_structure(geometry):
    if not isinstance(geometry, dict) or set(geometry) != {"type", "coordinates"}:
        raise ReferenceUnavailable("REFERENCE_GEOMETRY_MEMBERS")
    kind = geometry["type"]
    if kind not in ("Polygon", "MultiPolygon"):
        raise ReferenceUnavailable("REFERENCE_POLYGONS_ONLY")
    polygons = geometry["coordinates"]
    if kind == "Polygon":
        polygons = [polygons]
    if not isinstance(polygons, list) or not polygons:
        raise ReferenceUnavailable("REFERENCE_EMPTY")
    count = 0
    for polygon in polygons:
        if not isinstance(polygon, list) or not polygon:
            raise ReferenceUnavailable("REFERENCE_EMPTY_POLYGON")
        for ring in polygon:
            if not isinstance(ring, list) or len(ring) < 4:
                raise ReferenceUnavailable("REFERENCE_RING_INVALID")
            count += len(ring)
            if count > MAX_REFERENCE_POSITIONS:
                raise ReferenceUnavailable("REFERENCE_POSITION_BUDGET")
            for pair in ring:
                if not isinstance(pair, list) or len(pair) != 2:
                    raise ReferenceUnavailable("REFERENCE_2D_REQUIRED")
                for n, bound in zip(pair, [180, 85], strict=True):
                    if type(n) not in (int, float) or not -bound <= n <= bound:
                        raise ReferenceUnavailable("REFERENCE_COORDINATE_UNSUPPORTED")
                    if not math.isfinite(n):
                        raise ReferenceUnavailable("REFERENCE_COORDINATE_UNSUPPORTED")
            if ring[0] != ring[-1]:
                raise ReferenceUnavailable("REFERENCE_RING_OPEN")
            if any(abs(a[0] - b[0]) > 180 for a, b in zip(ring, ring[1:])):
                raise ReferenceUnavailable("REFERENCE_ANTIMERIDIAN_UNSUPPORTED")
    return count


def read_reference(spec: ReferenceSpec):
    # Spec comes from the deployment-controlled catalogue, never an API payload.
    path = ROOT / spec.filename
    if path.resolve().parent != ROOT.resolve():
        raise ReferenceUnavailable("REFERENCE_PATH_REJECTED")
    try:
        with path.open("rb") as stream:
            raw = stream.read(MAX_SOURCE_BYTES + 1)
    except OSError as exc:
        raise ReferenceUnavailable("REFERENCE_FILE_UNAVAILABLE") from exc
    if len(raw) > MAX_SOURCE_BYTES:
        raise ReferenceUnavailable("REFERENCE_BYTE_BUDGET")
    if hashlib.sha256(raw).hexdigest() != spec.sha256:
        raise ReferenceUnavailable("REFERENCE_CHECKSUM_MISMATCH")
    try:
        document = json.loads(raw, object_pairs_hook=_unique_pairs)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ReferenceUnavailable("REFERENCE_JSON_INVALID") from exc
    if (
        not isinstance(document, dict)
        or document.get("type") != "FeatureCollection"
        or not isinstance(document.get("features"), list)
        or len(document["features"]) != 1
    ):
        raise ReferenceUnavailable("REFERENCE_COLLECTION_INVALID")
    if "crs" in document and document["crs"] != {
        "type": "name",
        "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
    }:
        raise ReferenceUnavailable("REFERENCE_CRS_UNSUPPORTED")
    feature = document["features"][0]
    if (
        not isinstance(feature, dict)
        or feature.get("type") != "Feature"
        or "crs" in feature
    ):
        raise ReferenceUnavailable("REFERENCE_FEATURE_INVALID")
    props = feature.get("properties")
    if (
        not isinstance(props, dict)
        or props.get("shapeGroup") != spec.iso3
        or props.get("shapeType") != "ADM0"
        or props.get("shapeISO") != spec.iso3
    ):
        raise ReferenceUnavailable("REFERENCE_COUNTRY_MISMATCH")
    geometry = feature.get("geometry")
    reference_structure(geometry)
    return geometry
