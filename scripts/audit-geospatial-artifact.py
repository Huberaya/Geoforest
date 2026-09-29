"""Offline repository reference check. No DB, .env, network or cloud deployment.

Unlike qualify-geospatial.py (historical CI pilot), checks the active worldwide
catalogue's bytes and structure, NOT PostGIS topology or production packaging.
"""

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.geospatial import references  # noqa: E402


def audit():
    result = {
        "scope": "repository_active_reference_files",
        "status": "FAIL",
        "verified_country_count": 0,
        "expected_country_count": 246,
        "excluded": sorted(references.EXCLUDED),
        "failures": [],
        "postgis_topology_retested": False,
        "vercel_bundle_verified": False,
        "production_qualified": False,
        "regulatory_status": "NOT_ASSESSED",
    }
    try:
        manifest = (references.WORLD_ROOT / "manifest.json").read_bytes()
        if (
            hashlib.sha256(manifest).hexdigest() != references.WORLD_MANIFEST_SHA256
            or references.CATALOGUE_ERROR
            or len(references.CATALOGUE) != 246
            or set(references.EXCLUDED) != {"AQ", "EG", "UM"}
        ):
            raise ValueError("catalogue")
    except (OSError, ValueError):
        result["failures"].append("CATALOGUE_UNAVAILABLE_OR_CHANGED")
        return result
    for country, spec in sorted(references.CATALOGUE.items()):
        try:
            references.read_reference(spec)
            result["verified_country_count"] += 1
        except (OSError, ValueError):
            result["failures"].append(
                {"country": country, "code": "REFERENCE_UNAVAILABLE_OR_INVALID"}
            )
    if not result["failures"]:
        result["status"] = "PASS"
    return result


if __name__ == "__main__":
    report = audit()
    print(json.dumps(report, indent=2, ensure_ascii=False))
    raise SystemExit(0 if report["status"] == "PASS" else 1)
