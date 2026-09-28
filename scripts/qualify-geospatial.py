"""Read-only qualification of the admitted public snapshot.

Run with PYTHONPATH=backend and the normal application database environment.
No download, no customer geometry, no migration or persistent write.
"""

import json

from app.database import transaction
from app.geospatial.references import CIV, read_reference, reference_structure
from sqlalchemy import text

geometry = read_reference(CIV)
with transaction() as conn:
    conn.execute(text("SET LOCAL statement_timeout='8s'"))
    facts = dict(
        conn.execute(
            text("""SELECT ST_IsValid(g) valid, ST_IsEmpty(g) empty,
        ST_NPoints(g) positions, postgis_lib_version() postgis_version
        FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(:g),4326) g) s"""),
            {"g": json.dumps(geometry, allow_nan=False)},
        )
        .mappings()
        .one()
    )
assert facts["valid"] and not facts["empty"], "Reference topology rejected"
assert facts["positions"] == reference_structure(geometry)
print(
    json.dumps(
        {
            "source": CIV.provenance(),
            "technical_checks": facts,
            "qualification": "INDICATIVE_PILOT_ONLY",
            "rejected_countries": ["FR"],
            "global_coverage": False,
            "production_qualified": False,
        },
        ensure_ascii=False,
        indent=2,
    )
)
