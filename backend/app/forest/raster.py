"""Qualification adapter for small, native-grid GFC windows.

Not exposed to the application yet. A production worker needs process-level
CPU/memory isolation in addition to these network and decoded-window budgets.
"""

import hashlib
import time

import numpy as np
import rasterio
from app.forest.download import GFCTile, RangeReader, SourceReadError
from rasterio.errors import RasterioError
from rasterio.windows import Window

MAX_WINDOW_SIDE = 256
MAX_OPEN_HANDLES = 2


def read_gfc_window(tile, row, col, height, width, *, transport=None, budget=None):
    if type(tile) is not GFCTile:
        raise ValueError("GFC_TILE_REQUIRED")
    if any(type(x) is not int for x in (row, col, height, width)):
        raise ValueError("INTEGER_WINDOW_REQUIRED")
    if not (1 <= height <= MAX_WINDOW_SIDE and 1 <= width <= MAX_WINDOW_SIDE):
        raise ValueError("WINDOW_SIZE_LIMIT")
    if not (0 <= row <= 40000 - height and 0 <= col <= 40000 - width):
        raise ValueError("WINDOW_OUT_OF_BOUNDS")

    readers = []
    faults = []
    deadline = time.monotonic() + 30

    class ObservedReader(RangeReader):
        # Native GDAL callbacks can log/suppress Python read errors; retain them
        # so a substituted zero-filled native array can never become evidence.
        def read(self, size=-1):
            try:
                return super().read(size)
            except (OSError, ValueError):
                faults.append("SOURCE_READ_FAILED")
                raise

        def seek(self, offset, whence=0):
            try:
                return super().seek(offset, whence)
            except (OSError, ValueError):
                faults.append("SOURCE_SEEK_FAILED")
                raise

    def opener(path, mode="rb"):
        # Virtual filename only. Sidecars, directory listing and remote paths
        # are never delegated to a generic filesystem or GDAL network driver.
        if path != "gfc.tif" or mode not in ("r", "rb"):
            raise FileNotFoundError("UNSUPPORTED_VIRTUAL_FILE")
        if len(readers) >= MAX_OPEN_HANDLES or time.monotonic() >= deadline:
            faults.append("SOURCE_OPEN_BUDGET")
            raise SourceReadError("SOURCE_OPEN_BUDGET")
        try:
            f = ObservedReader(tile, transport=transport, budget=budget)
        except (OSError, ValueError):
            faults.append("SOURCE_OPEN_FAILED")
            raise
        f.deadline = min(f.deadline, deadline)
        readers.append(f)
        if (f.generation, f.etag) != (readers[0].generation, readers[0].etag):
            faults.append("SOURCE_VERSION_CHANGED")
            f.close()
            raise SourceReadError("SOURCE_VERSION_CHANGED")
        return f

    try:
        with rasterio.Env(
            GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_CACHEMAX=16 * 1024**2
        ):
            with rasterio.open("gfc.tif", opener=opener, driver="GTiff") as ds:
                expected_transform = (
                    0.00025,
                    0,
                    tile.west,
                    0,
                    -0.00025,
                    tile.north,
                    0,
                    0,
                    1,
                )
                if (
                    ds.driver != "GTiff"
                    or ds.crs != rasterio.crs.CRS.from_epsg(4326)
                    or ds.width != 40000
                    or ds.height != 40000
                    or ds.count != 1
                    or ds.dtypes != ("uint8",)
                    or not np.allclose(
                        tuple(ds.transform), expected_transform, rtol=0, atol=1e-12
                    )
                    or any(h * w > 40000 for h, w in ds.block_shapes)
                ):
                    raise SourceReadError("UNQUALIFIED_RASTER_GRID")
                # A source nodata tag of zero on lossyear would conflict with the
                # documented no-loss class; reject rather than hide those cells.
                if ds.nodata is not None:
                    raise SourceReadError("UNQUALIFIED_NODATA_TAG")
                window = Window(col, row, width, height)
                data = ds.read(1, window=window, masked=False)
                transform = tuple(ds.window_transform(window))
                block_shapes = ds.block_shapes
        if faults:
            raise SourceReadError(faults[0])
        if time.monotonic() >= deadline:
            raise SourceReadError("SOURCE_TIME_BUDGET")
        max_value = {"lossyear": 25, "datamask": 2, "treecover2000": 100}[tile.layer]
        if (
            data.shape != (height, width)
            or data.dtype != np.uint8
            or np.any(data > max_value)
        ):
            raise SourceReadError("UNKNOWN_RASTER_CLASS")
        evidence = {
            "method": "gfc-native-window-v1-qualification",
            "tile_id": tile.tile_id,
            "layer": tile.layer,
            "row": row,
            "col": col,
            "height": height,
            "width": width,
            "transform": transform,
            "crs": "EPSG:4326",
            "dtype": "uint8",
            "native_block_shapes": block_shapes,
            "pixel_bytes_sha256": hashlib.sha256(data.tobytes(order="C")).hexdigest(),
            "source_reads": [f.provenance() for f in readers],
            "rasterio_version": rasterio.__version__,
            "gdal_version": rasterio.__gdal_version__,
            "regulatory_status": "NOT_ASSESSED",
            "human_review_required": True,
        }
        return data, evidence
    except (RasterioError, OSError, ValueError) as exc:
        if isinstance(exc, SourceReadError):
            raise
        raise SourceReadError("RASTER_READ_FAILED") from None
    finally:
        for f in readers:
            f.close()
