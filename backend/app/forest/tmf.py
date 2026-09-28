"""TMF mirror adapter: actual native grids, not the mirror's nominal STAC boxes.

Catalogue metadata are pinned; dataset bytes remain version-checked at each
read. This is technical qualification, not empirical or legal certification.
"""

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
import shapely
from app.forest.download import RangeReader, SourceReadError, TMFMirrorTile
from app.forest.geometry import MAX_WINDOWS, PlanLimit
from app.plots.geometry import structure
from rasterio.enums import MaskFlags
from rasterio.windows import Window
from shapely.geometry import box, shape

ROOT = Path(__file__).resolve().parents[2] / "reference/tmf-mirror"
MANIFEST_SHA = "373f7664ebf992fc1701a2e2fe7d700c4abe6f1f4269b410ea461e2c1546d652"
STEP = 0.00026949458523585647
LAYERS = ("DeforestationYear", "DegradationYear", "AnnualChange_2020")
LIMITATIONS = (
    "Classes TMF de perturbation des forêts tropicales humides, pas déforestation ou dégradation juridique EUDR démontrée.",
    "L'année du premier événement ne détecte pas nécessairement toutes les perturbations récurrentes ultérieures.",
    "La classe annuelle 2020 décrit le produit TMF, pas une qualification juridique de forêt au 31 décembre 2020.",
    "Zéro signifie aucun événement renseigné, pas une absence prouvée ; la densité annuelle des observations Landsat n’est pas contrôlée ici.",
    "Les trois dernières années sont susceptibles de reclassification ; pas de date exacte de conversion.",
    "Les données arrêtées en 2025 ne surveillent pas 2026. Un point n'observe pas toute la parcelle.",
    "Les pixels de bord peuvent porter un signal extérieur à la parcelle ; aucune surface juridique calculée.",
    "Copie COG par Epoch distribuée via Source Cooperative ; transformations déclarées, pas approbation de la Commission européenne.",
    "Aux chevauchements de tuiles, un pixel est compté une fois ; sans comparaison des copies, aucune conclusion négative complète.",
    "GFC et TMF utilisent Landsat : leur concordance n'est pas celle de deux preuves statistiquement indépendantes.",
)
SOURCE = {
    "id": "tmf-2025-epoch",
    "license": "JRC open data — attribution required",
    "license_url": "https://forobs.jrc.ec.europa.eu/TMF/resources/tutorial/gee",
    "source_url": "https://forobs.jrc.ec.europa.eu/TMF/data",
    "mirror_url": "https://source.coop/epoch/jrc-tmf/README.md",
    "attribution": "Source: EC JRC; COG repackaging: Epoch / Source Cooperative; no EU endorsement",
    "citation": "Vancutsem et al. 2021, Science Advances, doi:10.1126/sciadv.abe1603",
    "catalogue_sha256": MANIFEST_SHA,
}


def catalogue():
    try:
        p = ROOT / "qualification.json"
        if p.is_symlink() or p.stat().st_size > 1024 * 1024:
            raise ValueError
        raw = p.read_bytes()
        if hashlib.sha256(raw).hexdigest() != MANIFEST_SHA:
            raise ValueError
        data = json.loads(raw)
        if len(data["tiles"]) != 86 or data["excluded"]:
            raise ValueError
        return {t["tile_id"]: t for t in data["tiles"]}
    except (OSError, ValueError, KeyError, TypeError):
        raise SourceReadError("TMF_CATALOGUE_UNAVAILABLE") from None


@dataclass
class TMFWindow:
    tile_id: str
    row: int
    col: int
    height: int
    width: int
    selection: np.ndarray
    boundary: np.ndarray

    def tile(self, layer):
        return TMFMirrorTile(layer, self.tile_id)


def plan(geometry):
    canonical, _ = structure(geometry)
    geom = shape(canonical)
    if geom.is_empty or not geom.is_valid:
        raise ValueError("INVALID_GEOMETRY_TOPOLOGY")
    entries = catalogue()
    candidates = [t for t in entries.values() if box(*t["bounds"]).intersects(geom)]
    if geom.geom_type == "Point":
        gx = math.floor(geom.x / STEP)
        gy = math.floor(-geom.y / STEP)
        for clamp in (False, True):
            for t in candidates:
                col = gx - t["global_col0"]
                row = gy - t["global_row0"]
                if not (0 <= row < t["height"] and 0 <= col < t["width"]):
                    if not clamp:
                        continue
                    col = max(0, min(t["width"] - 1, col))
                    row = max(0, min(t["height"] - 1, row))
                a = np.ones((1, 1), dtype=bool)
                return [TMFWindow(t["tile_id"], row, col, 1, 1, a, a.copy())], (
                    "POINT_SAMPLE_OVERLAPPING_SOURCE_GRIDS"
                    if len(candidates) > 1
                    else "POINT_SAMPLE_ONLY"
                )
        return [], "OUTSIDE_SOURCE_EXTENT"
    # Actual footprints may overlap. A native global grid key assigns each
    # pixel once, to the first tile in the pinned deterministic catalogue order.
    windows = []
    seen = set()
    covered = []
    candidate_windows = 0
    overlaps = False
    for t in candidates:
        part = geom.intersection(box(*t["bounds"]))
        if part.is_empty or part.area == 0:
            continue
        covered.append(part)
        x0, y0, x1, y1 = part.bounds
        c0 = max(0, math.floor(x0 / STEP) - t["global_col0"])
        c1 = min(t["width"] - 1, math.floor(x1 / STEP) - t["global_col0"])
        r0 = max(0, math.floor(-y1 / STEP) - t["global_row0"])
        r1 = min(t["height"] - 1, math.floor(-y0 / STEP) - t["global_row0"])
        if (r1 - r0 + 1) * (c1 - c0 + 1) > 256 * 256 * MAX_WINDOWS:
            raise PlanLimit("GEOMETRY_PIXEL_BUDGET")
        for r in range(r0, r1 + 1, 256):
            for c in range(c0, c1 + 1, 256):
                candidate_windows += 1
                if candidate_windows > MAX_WINDOWS:
                    raise PlanLimit("GEOMETRY_WINDOW_BUDGET")
                h = min(256, r1 - r + 1)
                w = min(256, c1 - c + 1)
                rr, cc = np.meshgrid(
                    np.arange(r, r + h) + t["global_row0"],
                    np.arange(c, c + w) + t["global_col0"],
                    indexing="ij",
                )
                cells = shapely.box(
                    cc * STEP, -(rr + 1) * STEP, (cc + 1) * STEP, -rr * STEP
                )
                intersects = shapely.intersects(geom, cells)
                selected = np.zeros((h, w), dtype=bool)
                selected[intersects] = (
                    shapely.area(shapely.intersection(geom, cells[intersects])) > 0
                )
                for iy, ix in np.argwhere(selected):
                    key = (int(rr[iy, ix]), int(cc[iy, ix]))
                    if key in seen:
                        overlaps = True
                        selected[iy, ix] = False
                    else:
                        seen.add(key)
                if np.any(selected):
                    boundary = selected & ~shapely.covers(geom, cells)
                    windows.append(
                        TMFWindow(t["tile_id"], r, c, h, w, selected, boundary)
                    )
    if not windows:
        return [], "OUTSIDE_SOURCE_EXTENT"
    if overlaps:
        return windows, "PARTIAL_OVERLAPPING_SOURCE_GRIDS"
    extent = shapely.union_all(covered)
    return windows, "FULL_GRID_EXTENT" if extent.covers(
        geom
    ) else "PARTIAL_SOURCE_EXTENT"


def read_window(tile, row, col, height, width, *, budget=None, transport=None):
    if type(tile) is not TMFMirrorTile:
        raise ValueError("TMF_TILE_REQUIRED")
    record = catalogue().get(tile.tile_id)
    if not record:
        raise SourceReadError("TMF_TILE_NOT_QUALIFIED")
    if any(type(x) is not int for x in (row, col, height, width)):
        raise ValueError("INTEGER_WINDOW_REQUIRED")
    if not (
        1 <= height <= 256
        and 1 <= width <= 256
        and 0 <= row <= record["height"] - height
        and 0 <= col <= record["width"] - width
    ):
        raise ValueError("WINDOW_OUT_OF_BOUNDS")
    readers = []
    faults = []

    class Observed(RangeReader):
        def read(self, size=-1):
            try:
                return super().read(size)
            except (OSError, ValueError):
                faults.append("TMF_READ_FAILED")
                raise

        def seek(self, offset, whence=0):
            try:
                return super().seek(offset, whence)
            except (OSError, ValueError):
                faults.append("TMF_SEEK_FAILED")
                raise

    def opener(path, mode="rb"):
        if path != "tmf.tif" or mode not in ("r", "rb"):
            raise FileNotFoundError
        if len(readers) >= 2:
            faults.append("TMF_OPEN_BUDGET")
            raise SourceReadError("TMF_OPEN_BUDGET")
        try:
            f = Observed(tile, budget=budget, transport=transport)
        except (OSError, ValueError):
            faults.append("TMF_OPEN_FAILED")
            raise
        readers.append(f)
        if f.etag != readers[0].etag:
            faults.append("SOURCE_VERSION_CHANGED")
            f.close()
            raise SourceReadError("SOURCE_VERSION_CHANGED")
        return f

    try:
        with rasterio.Env(
            GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_CACHEMAX=16 * 1024**2
        ):
            with rasterio.open("tmf.tif", opener=opener, driver="GTiff") as ds:
                dtype = "uint8" if tile.layer == "AnnualChange_2020" else "uint16"
                if (
                    ds.driver != "GTiff"
                    or ds.mask_flag_enums
                    not in (([MaskFlags.all_valid],), ([MaskFlags.nodata],))
                    or ds.crs != rasterio.crs.CRS.from_epsg(4326)
                    or ds.count != 1
                    or ds.dtypes != (dtype,)
                    or ds.width != record["width"]
                    or ds.height != record["height"]
                    or not np.allclose(
                        ds.transform, record["transform"], rtol=0, atol=1e-12
                    )
                    or ds.nodata not in (None, 0)
                    or any(h * w > 512 * 512 for h, w in ds.block_shapes)
                ):
                    raise SourceReadError("UNQUALIFIED_TMF_GRID")
                win = Window(col, row, width, height)
                a = ds.read(1, window=win, masked=False)
                transform = tuple(ds.window_transform(win))
                nodata = ds.nodata
        if faults:
            raise SourceReadError(faults[0])
        if a.shape != (height, width):
            raise SourceReadError("INVALID_TMF_WINDOW")
        if tile.layer == "AnnualChange_2020":
            if np.any(a > 6):
                raise SourceReadError("UNKNOWN_TMF_CLASS")
        elif np.any((a != 0) & ((a < 1982) | (a > 2025))):
            raise SourceReadError("UNKNOWN_TMF_YEAR")
        return a, {
            "method": "tmf-native-window-v1",
            "layer": tile.layer,
            "tile_id": tile.tile_id,
            "row": row,
            "col": col,
            "height": height,
            "width": width,
            "transform": transform,
            "crs": "EPSG:4326",
            "dtype": a.dtype.str,
            "nodata": nodata,
            "pixel_bytes_sha256": hashlib.sha256(a.tobytes()).hexdigest(),
            "source_reads": [f.provenance() for f in readers],
            "catalogue_sha256": MANIFEST_SHA,
            "rasterio_version": rasterio.__version__,
            "gdal_version": rasterio.__gdal_version__,
        }
    except (OSError, ValueError, SystemError, rasterio.errors.RasterioError) as exc:
        if isinstance(exc, SourceReadError):
            raise
        raise SourceReadError("TMF_RASTER_READ_FAILED") from None
    finally:
        for f in readers:
            f.close()


def summarize(layers, selection):
    dy = layers["DeforestationYear"]
    gy = layers["DegradationYear"]
    baseline = layers["AnnualChange_2020"]
    if (
        type(selection) is not np.ndarray
        or selection.dtype != np.bool_
        or selection.ndim != 2
        or selection.size > 256**2
    ):
        raise ValueError("INVALID_SELECTION")
    for a, dtype in ((dy, np.uint16), (gy, np.uint16), (baseline, np.uint8)):
        if type(a) is not np.ndarray or a.dtype != dtype or a.shape != selection.shape:
            raise ValueError("TMF_ARRAY_MISMATCH")
    if np.any(baseline > 6) or any(
        np.any((a != 0) & ((a < 1982) | (a > 2025))) for a in (dy, gy)
    ):
        raise ValueError("UNKNOWN_TMF_CLASS")
    positive = selection & ((dy >= 2021) | (gy >= 2021))
    # Only a TMF forest class in 2020 supplies a baseline interpretation. Other
    # land/water or missing classes cannot become a negative EUDR conclusion.
    baseline_forest = selection & np.isin(baseline, [1, 2, 4])
    n = int(np.count_nonzero(positive))
    covered = int(np.count_nonzero(baseline_forest))
    summary = {
        "method_version": "tmf-selected-pixels-v1",
        "selected_pixels": int(selection.sum()),
        "post_2020_signal_pixels": n,
        "deforestation_year_signal_pixels": int(
            np.count_nonzero(selection & (dy >= 2021))
        ),
        "degradation_year_signal_pixels": int(
            np.count_nonzero(selection & (gy >= 2021))
        ),
        "baseline_tmf_forest_pixels": covered,
        "non_baseline_tmf_forest_pixels": int(
            np.count_nonzero(selection & ~np.isin(baseline, [1, 2, 4]))
        ),
        "baseline_tmf_class_counts": {
            str(v): int(np.count_nonzero(selection & (baseline == v))) for v in range(7)
        },
        "baseline_interpretation": "TMF classes 1/2/4 in annual 2020; not a legal forest classification",
        "regulatory_status": "NOT_ASSESSED",
        "human_review_required": True,
    }
    return summary, positive
