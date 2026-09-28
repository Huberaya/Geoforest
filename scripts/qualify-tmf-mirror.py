"""Offline metadata qualification, explicit public reads, not a parcel endpoint.

Needs qualification-only pyarrow==25.0.1, plus backend requirements.
Never regenerate an admitted manifest in a live service's reference directory.
"""

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import pyarrow.parquet as pq
import rasterio
from app.forest.download import RangeReader, TMFMirrorTile

ROOT = Path(__file__).resolve().parents[1] / "backend/reference/tmf-mirror"
INDEX_SHA = "243752c8953f09b8da9567eadb7f73a74ece4ce0de30959951d13819d0464804"
STEP = 0.00026949458523585647


def qualify(row):
    tile_id = row["id"].removesuffix("_DeforestationYear")
    tile = TMFMirrorTile("DeforestationYear", tile_id)
    if row["assets"]["DeforestationYear"]["href"] != tile.url:
        raise ValueError("INDEX_URL_NOT_ADMITTED")
    readers = []

    def opener(path, mode="rb"):
        if path != "tmf.tif" or mode not in ("r", "rb"):
            raise FileNotFoundError
        if len(readers) >= 2:
            raise ValueError("TOO_MANY_OPENS")
        f = RangeReader(tile)
        readers.append(f)
        return f

    try:
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
            with rasterio.open("tmf.tif", opener=opener, driver="GTiff") as ds:
                t = tuple(ds.transform)
                if (
                    ds.crs != rasterio.crs.CRS.from_epsg(4326)
                    or ds.count != 1
                    or ds.dtypes != ("uint16",)
                ):
                    raise ValueError("UNSUPPORTED_CRS_OR_BAND")
                if not (
                    1 <= ds.width <= 50000 and 1 <= ds.height <= 50000
                ) or ds.nodata not in (None, 0):
                    raise ValueError("UNSUPPORTED_SIZE_OR_NODATA")
                if (
                    abs(t[0] - STEP) > 1e-14
                    or abs(t[4] + STEP) > 1e-14
                    or t[1] != 0
                    or t[3] != 0
                ):
                    raise ValueError("UNSUPPORTED_GRID")
                if any(h * w > 512 * 512 for h, w in ds.block_shapes):
                    raise ValueError("BLOCK_BUDGET")
                col0 = round(t[2] / STEP)
                row0 = round(-t[5] / STEP)
                if abs(col0 * STEP - t[2]) > 1e-9 or abs(-row0 * STEP - t[5]) > 1e-9:
                    raise ValueError("GRID_NOT_ALIGNED_TO_ZERO")
                return {
                    "tile_id": tile_id,
                    "width": ds.width,
                    "height": ds.height,
                    "transform": t,
                    "bounds": list(ds.bounds),
                    "global_col0": col0,
                    "global_row0": row0,
                    "nominal_index_bbox": row["bbox"],
                    "dtype": ds.dtypes[0],
                    "nodata": ds.nodata,
                    "block_shapes": ds.block_shapes,
                    "source_reads": [f.provenance() for f in readers],
                }
    except Exception as exc:
        return {"tile_id": tile_id, "error": type(exc).__name__, "admitted": False}
    finally:
        for f in readers:
            f.close()


def main():
    raw = (ROOT / "DeforestationYear_stac.parquet").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == INDEX_SHA
    rows = pq.read_table(ROOT / "DeforestationYear_stac.parquet").to_pylist()
    assert len(rows) == 86
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(qualify, rows))
    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "index_sha256": INDEX_SHA,
        "step": STEP,
        "rasterio_version": rasterio.__version__,
        "gdal_version": rasterio.__gdal_version__,
        "tiles": sorted(
            [r for r in results if "error" not in r], key=lambda r: r["tile_id"]
        ),
        "excluded": [r for r in results if "error" in r],
        "limitations": [
            "Native metadata checked, not empirical ground-truth validation.",
            "Nominal STAC boxes are not used as the native raster footprint.",
            "No EUDR verdict or sovereignty inference.",
        ],
    }
    (ROOT / "qualification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        len(report["tiles"]),
        "native grids inspected;",
        len(report["excluded"]),
        "not admitted",
    )


if __name__ == "__main__":
    main()
