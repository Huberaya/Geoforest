"""Native-grid intersection, no buffering, repair or geometry simplification.

Callers authorize and validate the persisted revision with PostGIS first. This
additional GEOS check protects the standalone worker, not tenant authorization.
"""

from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal

import numpy as np
import shapely
from app.forest.download import GFCTile
from app.plots.geometry import structure
from shapely.geometry import box, shape

STEP = 0.00025
TICKS = 4000
COLS = 1440000
ROWS = 560000
MAX_WINDOWS = 16
MAX_CANDIDATE_PIXELS = 256 * 256 * MAX_WINDOWS


class PlanLimit(ValueError):
    pass


@dataclass
class GridWindow:
    north: int
    west: int
    row: int
    col: int
    height: int
    width: int
    selection: np.ndarray
    boundary: np.ndarray

    def tile(self, layer):
        return GFCTile(layer, self.north, self.west)


def tick(value, origin, descending=False):
    # Avoid +/- one pixel from binary arithmetic on an exact decimal grid edge.
    v = Decimal(str(value))
    d = Decimal(origin) - v if descending else v - Decimal(origin)
    return int((d * TICKS).to_integral_value(rounding=ROUND_FLOOR))


def plan_geometry(geometry):
    canonical, _ = structure(geometry)
    geom = shape(canonical)
    if geom.is_empty or not geom.is_valid:
        raise ValueError("INVALID_GEOMETRY_TOPOLOGY")
    if geom.geom_type == "Point":
        x, y = geom.x, geom.y
        if not -60 <= y <= 80:
            return [], "OUTSIDE_SOURCE_EXTENT"
        gx = min(COLS - 1, tick(x, -180))
        gy = min(ROWS - 1, tick(y, 80, True))
        return [
            GridWindow(
                80 - gy // 40000 * 10,
                -180 + gx // 40000 * 10,
                gy % 40000,
                gx % 40000,
                1,
                1,
                np.ones((1, 1), dtype=bool),
                np.ones((1, 1), dtype=bool),
            )
        ], "POINT_SAMPLE_ONLY"

    extent = box(-180, -60, 180, 80)
    coverage = "FULL_GRID_EXTENT" if extent.covers(geom) else "PARTIAL_SOURCE_EXTENT"
    clipped = geom.intersection(extent)
    if clipped.is_empty or clipped.area == 0:
        return [], "OUTSIDE_SOURCE_EXTENT"
    # Plan components separately, avoiding a huge empty bounding box between islands.
    parts = list(clipped.geoms) if hasattr(clipped, "geoms") else [clipped]
    bounds = {}
    for part in parts:
        if part.area == 0:
            continue
        x0, y0, x1, y1 = part.bounds
        left, right = max(0, tick(x0, -180)), min(COLS - 1, tick(x1, -180))
        top, bottom = max(0, tick(y1, 80, True)), min(ROWS - 1, tick(y0, 80, True))
        # Inclusive upper bounds deliberately retain edge candidates. Positive-area
        # intersection below removes cells touching only a line or vertex.
        if (right - left + 1) * (bottom - top + 1) > MAX_CANDIDATE_PIXELS:
            raise PlanLimit("GEOMETRY_PIXEL_BUDGET")
        for ty in range(top // 40000, bottom // 40000 + 1):
            for tx in range(left // 40000, right // 40000 + 1):
                r0, r1 = max(top, ty * 40000), min(bottom, (ty + 1) * 40000 - 1)
                c0, c1 = max(left, tx * 40000), min(right, (tx + 1) * 40000 - 1)
                # Fixed grid partitions deduplicate overlapping component boxes.
                for by in range((r0 - ty * 40000) // 256, (r1 - ty * 40000) // 256 + 1):
                    for bx in range(
                        (c0 - tx * 40000) // 256, (c1 - tx * 40000) // 256 + 1
                    ):
                        key = (ty, tx, by, bx)
                        v = [
                            max(r0, ty * 40000 + by * 256),
                            min(r1, ty * 40000 + (by + 1) * 256 - 1),
                            max(c0, tx * 40000 + bx * 256),
                            min(c1, tx * 40000 + (bx + 1) * 256 - 1),
                        ]
                        if key in bounds:
                            old = bounds[key]
                            v = [
                                min(old[0], v[0]),
                                max(old[1], v[1]),
                                min(old[2], v[2]),
                                max(old[3], v[3]),
                            ]
                        bounds[key] = v
                        if len(bounds) > MAX_WINDOWS:
                            raise PlanLimit("GEOMETRY_WINDOW_BUDGET")
    windows = []
    for (ty, tx, _, _), (r0, r1, c0, c1) in sorted(bounds.items()):
        rows, cols = np.meshgrid(
            np.arange(r0, r1 + 1), np.arange(c0, c1 + 1), indexing="ij"
        )
        # Coordinates of this decimal grid have exactly five decimal places.
        west = np.round(-180 + cols / TICKS, 5)
        east = np.round(-180 + (cols + 1) / TICKS, 5)
        north = np.round(80 - rows / TICKS, 5)
        south = np.round(80 - (rows + 1) / TICKS, 5)
        cells = shapely.box(west, south, east, north)
        candidates = shapely.intersects(clipped, cells)
        selection = np.zeros(candidates.shape, dtype=bool)
        selection[candidates] = (
            shapely.area(shapely.intersection(clipped, cells[candidates])) > 0
        )
        if not np.any(selection):
            continue
        boundary = selection & ~shapely.covers(clipped, cells)
        windows.append(
            GridWindow(
                80 - ty * 10,
                -180 + tx * 10,
                r0 - ty * 40000,
                c0 - tx * 40000,
                r1 - r0 + 1,
                c1 - c0 + 1,
                selection,
                boundary,
            )
        )
    return windows, coverage
