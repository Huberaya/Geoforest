"""Public, fictional study window only; no business DB or parcel data accessed.

Run with PYTHONPATH=backend .venv/bin/python scripts/qualify-forest.py
Writes reviewed source extracts/evidence, never modifies a live source registry.
"""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from app.forest.download import GFCTile
from app.forest.raster import read_gfc_window

root = Path(__file__).resolve().parents[1]
output = root / "backend/reference/forest/gfc-2025-qualification"
output.mkdir(parents=True, exist_ok=True)
report = {
    "executed_at": datetime.now(timezone.utc).isoformat(),
    "purpose": "Public real raster extracts for a fictional study window, not a customer's parcel",
    "production_admitted": False,
    "license": "CC-BY-4.0",
    "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "Source: Hansen/UMD/Google/USGS/NASA",
    "modifications": "64x64 native-grid crops, re-encoded as lossless GeoTIFF; no resampling or class changes",
    "layers": [],
}
for layer in ("lossyear", "datamask", "treecover2000"):
    data, evidence = read_gfc_window(GFCTile(layer, 10, -10), 18000, 18000, 64, 64)
    dest = output / f"{layer}.tif"
    with rasterio.open(
        dest,
        "w",
        driver="GTiff",
        height=64,
        width=64,
        count=1,
        dtype="uint8",
        crs="EPSG:4326",
        transform=Affine(*evidence["transform"][:6]),
        compress="deflate",
    ) as ds:
        ds.write(data, 1)
    values, counts = np.unique(data, return_counts=True)
    evidence["class_histogram"] = {str(int(v)): int(n) for v, n in zip(values, counts)}
    evidence["extract_file"] = dest.name
    evidence["extract_file_sha256"] = hashlib.sha256(dest.read_bytes()).hexdigest()
    report["layers"].append(evidence)
    print(
        layer,
        "extracted",
        sum(x["reserved_transfer_bytes"] for x in evidence["source_reads"]),
        "bytes reserved",
    )
(output / "qualification.json").write_text(
    json.dumps(report, indent=2, ensure_ascii=False) + "\n"
)
print(
    "Qualification extracts saved; no application activation or compliance assessment."
)
