"""Offline reproducible normalization of the pinned Natural Earth map-units snapshot.

No network, no parcel/customer data. Uses PostGIS for validated ISO-group dissolve,
never ST_MakeValid. Run with PYTHONPATH=backend and the application DB environment.
"""

import hashlib
import json
from collections import defaultdict
from pathlib import Path

import pycountry
from app.database import transaction
from app.geospatial.references import ReferenceUnavailable, reference_structure
from sqlalchemy import text

root = Path(__file__).resolve().parents[1] / "backend/reference/naturalearth"
raw = (root / "map_units.geojson").read_bytes()
expected = "57da82be755f4afccd8f3b14251bb2752f5df1395f47d2d86f817470c4a48862"
if hashlib.sha256(raw).hexdigest() != expected:
    raise SystemExit("Pinned upstream hash mismatch")
features = json.loads(raw)["features"]
groups = defaultdict(list)
unmapped = []
for f in features:
    p = f["properties"]
    code = p["ISO_A2_EH"]
    if not pycountry.countries.get(alpha_2=code):
        unmapped.append({"ne_id": str(p["NE_ID"]), "name": p["GEOUNIT"], "code": code})
        continue
    groups[code].append(f)
manifest = {
    "dataset": "Natural Earth 1:10m Admin 0 Map Units",
    "repository_tag": "v5.1.2",
    "upstream_commit": "f1890d9f152c896d250a77557a5751a93d494776",
    "upstream_sha256": expected,
    "retrieved_on": "2026-09-28",
    "worldview": "de facto, snapshot only; no legal sovereignty conclusion",
    "transformation": "Group map units by ISO_A2_EH; PostGIS ST_UnaryUnion of valid components; no repair, reprojection or simplification",
    "countries": {},
    "excluded": {},
    "unmapped_units": unmapped,
}
(root / "countries").mkdir(exist_ok=True)
with transaction() as conn:
    conn.execute(text("SET LOCAL statement_timeout='30s'"))
    manifest["preparation_postgis"] = conn.execute(
        text("SELECT postgis_full_version()")
    ).scalar_one()
    for code, fs in sorted(groups.items()):
        parts = []
        try:
            for f in fs:
                g = f["geometry"]
                reference_structure(g)
                if not conn.execute(
                    text("SELECT ST_IsValid(ST_GeomFromGeoJSON(:g))"),
                    {"g": json.dumps(g)},
                ).scalar_one():
                    raise ReferenceUnavailable("UPSTREAM_TOPOLOGY_INVALID")
                parts.append(g)
            collection = {"type": "GeometryCollection", "geometries": parts}
            # Remove internal map-unit edges by a documented dissolve, not a repair.
            geom = conn.execute(
                text(
                    "SELECT ST_AsGeoJSON(ST_Multi(ST_UnaryUnion(ST_SetSRID(ST_GeomFromGeoJSON(:g),4326))),15,0)"
                ),
                {"g": json.dumps(collection)},
            ).scalar_one()
            geom = json.loads(geom)
            positions = reference_structure(geom)
            if not conn.execute(
                text("SELECT ST_IsValid(ST_GeomFromGeoJSON(:g))"),
                {"g": json.dumps(geom)},
            ).scalar_one():
                raise ReferenceUnavailable("DERIVED_TOPOLOGY_INVALID")
            iso3 = pycountry.countries.get(alpha_2=code).alpha_3
            payload = {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {
                            "shapeGroup": iso3,
                            "shapeISO": iso3,
                            "shapeType": "ADM0",
                        },
                        "geometry": geom,
                    }
                ],
            }
            data = (
                json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n"
            ).encode()
            if len(data) > 4 * 1024 * 1024:
                raise ReferenceUnavailable("REFERENCE_BYTE_BUDGET")
            (root / "countries" / f"{code}.geojson").write_bytes(data)
            manifest["countries"][code] = {
                "iso3": iso3,
                "sha256": hashlib.sha256(data).hexdigest(),
                "positions": positions,
                "map_units": [f["properties"]["GEOUNIT"] for f in fs],
                "ne_ids": [str(f["properties"]["NE_ID"]) for f in fs],
            }
        except ReferenceUnavailable as exc:
            manifest["excluded"][code] = str(exc)
for c in pycountry.countries:
    if c.alpha_2 not in groups:
        manifest["excluded"][c.alpha_2] = "NO_UNAMBIGUOUS_ISO_MAP_UNIT"
(root / "manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
)
print(
    json.dumps(
        {
            "countries": len(manifest["countries"]),
            "excluded": manifest["excluded"],
            "unmapped_units": len(unmapped),
        },
        indent=2,
    )
)
