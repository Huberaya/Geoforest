import base64
import zlib

import numpy as np
import pytest
from app.forest.download import SourceReadError, WorkBudget
from app.forest.engine import analyze_geometry
from app.forest.geometry import PlanLimit, plan_geometry
from app.forest.isolation import isolated_analysis


def polygon(x0, y0, x1, y1):
    return {
        "type": "Polygon",
        "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
    }


def count(g):
    windows, coverage = plan_geometry(g)
    return sum(int(w.selection.sum()) for w in windows), windows, coverage


def test_one_exact_pixel_does_not_select_touching_neighbours():
    n, w, c = count(polygon(0, 0, 0.00025, 0.00025))
    assert n == 1 and c == "FULL_GRID_EXTENT"
    assert sum(int(x.boundary.sum()) for x in w) == 0


def test_subpixel_is_selected_but_marked_boundary():
    n, w, _ = count(polygon(0.00001, 0.00001, 0.00002, 0.00002))
    assert n == 1
    assert sum(int(x.boundary.sum()) for x in w) == 1


def test_hole_and_multiple_components():
    g = polygon(0, 0, 0.001, 0.001)
    g["coordinates"].append(
        polygon(0.00025, 0.00025, 0.00075, 0.00075)["coordinates"][0]
    )
    assert count(g)[0] == 12
    multi = {
        "type": "MultiPolygon",
        "coordinates": [
            polygon(0, 0, 0.00025, 0.00025)["coordinates"],
            polygon(1, 1, 1.00025, 1.00025)["coordinates"],
        ],
    }
    assert count(multi)[0] == 2


def test_crosses_two_tiles_without_double_count():
    n, w, _ = count(polygon(-0.00025, 0.00001, 0.00025, 0.00024))
    assert n == 2
    assert {x.west for x in w} == {-10, 0}


@pytest.mark.parametrize("x,y", [(0, 0), (180, 80), (-180, -60), (5, 5)])
def test_point_is_one_canonical_cell(x, y):
    n, w, c = count({"type": "Point", "coordinates": [x, y]})
    assert n == 1 and c == "POINT_SAMPLE_ONLY"
    assert 0 <= w[0].row < 40000 and 0 <= w[0].col < 40000


def test_partial_extent_is_never_full():
    n, _, c = count(polygon(0, 79.9999, 0.0001, 80.0001))
    assert n == 1 and c == "PARTIAL_SOURCE_EXTENT"
    assert (
        count({"type": "Point", "coordinates": [0, 89]})[2] == "OUTSIDE_SOURCE_EXTENT"
    )


def test_large_extent_fails_before_fetch():
    with pytest.raises(PlanLimit):
        plan_geometry(polygon(0, 0, 1, 1))
    assert analyze_geometry(polygon(0, 0, 1, 1))["status"] == "BUDGET_EXCEEDED"


def test_bowtie_rejected_not_repaired():
    with pytest.raises(ValueError, match="INVALID_GEOMETRY_TOPOLOGY"):
        plan_geometry(
            {
                "type": "Polygon",
                "coordinates": [[[0, 0], [0.01, 0.01], [0, 0.01], [0.01, 0], [0, 0]]],
            }
        )


def fake_fetch(value=25, fail_after=None, changed=False):
    calls = []

    def fetch(tile, row, col, height, width, *, budget):
        calls.append(tile)
        if fail_after is not None and len(calls) > fail_after:
            raise SourceReadError("SOURCE_NETWORK_ERROR")
        a = np.full(
            (height, width), value if tile.layer == "lossyear" else 1, dtype=np.uint8
        )
        version = "2" if changed and len(calls) > 2 else "1"
        return a, {
            "source_reads": [{"generation": version, "etag": version}],
            "layer": tile.layer,
        }

    return fetch


def test_complete_positive_with_replayable_pixels():
    r = analyze_geometry(
        polygon(0.00001, 0.00001, 0.00002, 0.00002), fetch=fake_fetch()
    )
    assert r["status"] == "OBSERVED" and r["signal_status"] == "SIGNAL_OBSERVED"
    assert r["windows"][0]["summary"]["boundary_post_2020_signal_pixels"] == 1
    data = r["windows"][0]["evidence"][0]["pixels_zlib_base64"]
    assert 25 in zlib.decompress(base64.b64decode(data))
    assert (
        r["regulatory_status"] == "NOT_ASSESSED"
        and r["entire_parcel_assessed"] is False
    )


def test_positive_before_failure_is_preserved():
    g = {
        "type": "MultiPolygon",
        "coordinates": [
            polygon(0, 0, 0.0001, 0.0001)["coordinates"],
            polygon(1, 1, 1.0001, 1.0001)["coordinates"],
        ],
    }
    r = analyze_geometry(g, fetch=fake_fetch(fail_after=2))
    assert r["status"] == "PARTIAL" and r["signal_status"] == "SIGNAL_OBSERVED"
    assert r["errors"] == ["SOURCE_NETWORK_ERROR"]


def test_no_false_negative_with_partial_coverage():
    r = analyze_geometry(
        polygon(0, 79.9999, 0.0001, 80.0001), fetch=fake_fetch(value=0)
    )
    assert r["status"] == "PARTIAL" and r["signal_status"] == "NOT_ASSESSABLE"


def test_source_generation_consistent_across_windows():
    g = {
        "type": "MultiPolygon",
        "coordinates": [
            polygon(0.00001, 0.00001, 0.0001, 0.0001)["coordinates"],
            polygon(1, 1, 1.0001, 1.0001)["coordinates"],
        ],
    }
    r = analyze_geometry(g, fetch=fake_fetch(changed=True))
    assert r["status"] == "PARTIAL"
    assert r["errors"] == ["SOURCE_VERSION_CHANGED_BETWEEN_WINDOWS"]


def test_shared_budget():
    b = WorkBudget()
    b.reserve(64 * 1024**2)
    with pytest.raises(SourceReadError, match="WORK_BYTE_BUDGET"):
        b.reserve(1)
    b = WorkBudget()
    b.requests = 512
    with pytest.raises(SourceReadError, match="WORK_REQUEST_BUDGET"):
        b.reserve(0)


def test_real_subprocess_outside_extent_no_network():
    r = isolated_analysis({"type": "Point", "coordinates": [0, 89]})
    assert r["status"] == "NOT_COVERED"


def test_subprocess_timeout_kills_and_reaps():
    with pytest.raises(SourceReadError, match="WORKER_TIMEOUT"):
        isolated_analysis({"type": "Point", "coordinates": [0, 89]}, timeout=0.001)
