"""Bounded parcel observations; callers must authorize the revision first."""

import base64
import hashlib
import json
import zlib
from datetime import datetime, timezone

import numpy as np
import shapely
from app.forest.download import SourceReadError, WorkBudget
from app.forest.geometry import PlanLimit, plan_geometry
from app.forest.observations import LIMITATIONS, summarize_gfc
from app.forest.raster import read_gfc_window


def analyze_geometry(geometry, *, fetch=None, source_id="gfc-2025-v1.13"):
    if source_id not in {"gfc-2025-v1.13", "tmf-2025-epoch"}:
        raise ValueError("SOURCE_NOT_ADMITTED")
    is_tmf = source_id == "tmf-2025-epoch"
    if is_tmf:
        from app.forest import tmf
    fetch = fetch or (tmf.read_window if is_tmf else read_gfc_window)
    planner = tmf.plan if is_tmf else plan_geometry
    layer_names = tmf.LAYERS if is_tmf else ("lossyear", "datamask")
    digest = hashlib.sha256(
        json.dumps(
            geometry, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()
    ).hexdigest()
    result = {
        "method_version": "tmf-parcel-grid-v1" if is_tmf else "gfc-parcel-grid-v1",
        "source_id": source_id,
        "geometry_sha256": digest,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "geos_version": shapely.geos_version_string,
        "status": "NOT_ASSESSED",
        "signal_status": "NOT_ASSESSABLE",
        "spatial_coverage": "NOT_ASSESSED",
        "grid_intersection": "positive-area polygon intersection; half-open east/south point cell, outer edge clamped",
        "regulatory_status": "NOT_ASSESSED",
        "human_review_required": True,
        "confidence_probability": None,
        "deforested_area_ha": None,
        "data_period_end_year": 2025,
        "temporal_gap_after": "2025-12-31",
        "limitations": list(tmf.LIMITATIONS if is_tmf else LIMITATIONS),
        "windows": [],
        "errors": [],
        "sources": [
            {
                "id": "gfc-2025-v1.13",
                "license": "CC-BY-4.0",
                "license_url": "https://creativecommons.org/licenses/by/4.0/",
                "attribution": "Source: Hansen/UMD/Google/USGS/NASA",
                "source_url": "https://glad.earthengine.app/view/global-forest-change",
            }
        ],
    }
    if is_tmf:
        result["sources"] = [dict(tmf.SOURCE)]
    try:
        windows, extent = planner(geometry)
    except PlanLimit as exc:
        return result | {"status": "BUDGET_EXCEEDED", "errors": [str(exc)]}
    except SourceReadError as exc:
        return result | {"status": "SOURCE_UNAVAILABLE", "errors": [str(exc)]}
    result["planned_windows"] = len(windows)
    result["spatial_coverage"] = extent
    if not windows:
        return result | {"status": "NOT_COVERED"}
    budget = WorkBudget()
    versions = {}
    for window in windows:
        layers = {}
        evidence = []
        try:
            for layer in layer_names:
                data, meta = fetch(
                    window.tile(layer),
                    window.row,
                    window.col,
                    window.height,
                    window.width,
                    budget=budget,
                )
                for source in meta["source_reads"]:
                    key = (window.tile(layer).tile_id, layer)
                    version = (source["generation"], source["etag"])
                    if key in versions and versions[key] != version:
                        raise SourceReadError("SOURCE_VERSION_CHANGED_BETWEEN_WINDOWS")
                    versions[key] = version
                layers[layer] = data
                # Self-contained evidence: actual pixel bytes, not a digest alone.
                evidence.append(
                    meta
                    | {
                        "pixels_zlib_base64": base64.b64encode(
                            zlib.compress(data.tobytes())
                        ).decode()
                    }
                )
            if is_tmf:
                summary, signal_pixels = tmf.summarize(layers, window.selection)
            else:
                summary = summarize_gfc(
                    layers["lossyear"], layers["datamask"], window.selection
                )
                signal_pixels = layers["lossyear"] >= 21
            summary["boundary_selected_pixels"] = int(np.count_nonzero(window.boundary))
            summary["boundary_post_2020_signal_pixels"] = int(
                np.count_nonzero(window.boundary & signal_pixels)
            )
            result["windows"].append(
                {
                    "summary": summary,
                    "evidence": evidence,
                    "selection_packbits_base64": base64.b64encode(
                        np.packbits(window.selection).tobytes()
                    ).decode(),
                    "selection_shape": [window.height, window.width],
                    "boundary_packbits_base64": base64.b64encode(
                        np.packbits(window.boundary).tobytes()
                    ).decode(),
                }
            )
        except SourceReadError as exc:
            result["errors"].append(str(exc))
            # Never silently skip failures and declare a clean complete parcel.
            break
    for field, source_field in (
        ("selected_pixels", "selected_pixels"),
        ("post_2020_signal_pixels", "post_2020_signal_pixels"),
        ("boundary_signal_pixels", "boundary_post_2020_signal_pixels"),
    ):
        result[field] = sum(w["summary"][source_field] for w in result["windows"])
    completed = len(result["windows"])
    result["completed_windows"] = completed
    result["network_budget"] = {
        "reserved_bytes": budget.bytes_reserved,
        "requests": budget.requests,
    }
    positive = any(w["summary"]["post_2020_signal_pixels"] for w in result["windows"])
    if is_tmf:
        land = sum(
            w["summary"]["baseline_tmf_forest_pixels"] for w in result["windows"]
        )
        missing = sum(
            w["summary"]["non_baseline_tmf_forest_pixels"] for w in result["windows"]
        )
    else:
        land = sum(
            w["summary"]["historical_land_mask_pixels"] for w in result["windows"]
        )
        missing = sum(
            w["summary"]["historical_no_data_mask_pixels"]
            + w["summary"]["historical_water_mask_pixels"]
            for w in result["windows"]
        )
    complete = completed == len(windows) and extent in (
        "FULL_GRID_EXTENT",
        "POINT_SAMPLE_ONLY",
    )
    result["status"] = (
        "OBSERVED" if complete else "PARTIAL" if completed else "SOURCE_UNAVAILABLE"
    )
    result["signal_status"] = (
        "SIGNAL_OBSERVED"
        if positive
        else "NO_SIGNAL_IN_SELECTED_LAND_PIXELS"
        if complete and land and not missing
        else "NOT_ASSESSABLE"
    )
    result[
        "baseline_has_non_interpretable_pixels"
        if is_tmf
        else "historical_mask_has_gaps_or_water"
    ] = bool(missing)
    result["entire_parcel_assessed"] = (
        False  # Cartographic pixels never certify a whole parcel.
    )
    return result
