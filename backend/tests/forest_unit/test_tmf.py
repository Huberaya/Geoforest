import hashlib
import json

import httpx
import numpy as np
import pytest
from affine import Affine
from app.forest import tmf
from app.forest.download import SourceReadError, TMFMirrorTile
from app.forest.engine import analyze_geometry
from app.forest.geometry import PlanLimit
from rasterio.io import MemoryFile
from shapely.geometry import box, mapping

POINT = {"type": "Point", "coordinates": [-5.5, 5.5]}


def fetch_values(dy=0, gy=0, baseline=1):
    def fetch(tile, row, col, h, w, *, budget):
        v = {
            "DeforestationYear": dy,
            "DegradationYear": gy,
            "AnnualChange_2020": baseline,
        }[tile.layer]
        a = np.full(
            (h, w),
            v,
            dtype=np.uint8 if tile.layer == "AnnualChange_2020" else np.uint16,
        )
        return a, {"source_reads": [{"generation": None, "etag": "synthetic"}]}

    return fetch


@pytest.mark.parametrize(
    "dy,gy,base,signal",
    [
        (2005, 0, 1, "NO_SIGNAL_IN_SELECTED_LAND_PIXELS"),
        (2020, 0, 1, "NO_SIGNAL_IN_SELECTED_LAND_PIXELS"),
        (2021, 0, 1, "SIGNAL_OBSERVED"),
        (0, 2025, 1, "SIGNAL_OBSERVED"),
        (2025, 2025, 1, "SIGNAL_OBSERVED"),
        (0, 0, 0, "NOT_ASSESSABLE"),
        (0, 0, 3, "NOT_ASSESSABLE"),
        (0, 0, 5, "NOT_ASSESSABLE"),
        (0, 0, 6, "NOT_ASSESSABLE"),
        (2025, 0, 0, "SIGNAL_OBSERVED"),
    ],
)
def test_years_not_gfc_codes_and_baseline(dy, gy, base, signal):
    r = analyze_geometry(
        POINT, source_id="tmf-2025-epoch", fetch=fetch_values(dy, gy, base)
    )
    assert r["status"] == "OBSERVED"
    assert r["signal_status"] == signal
    assert r["post_2020_signal_pixels"] == int(dy > 2020 or gy > 2020)
    assert r["regulatory_status"] == "NOT_ASSESSED" and r["human_review_required"]
    assert r["confidence_probability"] is None and r["deforested_area_ha"] is None
    assert len(r["windows"][0]["evidence"]) == 3


def test_catalogue_native_not_nominal():
    entries = tmf.catalogue()
    assert len(entries) == 86
    t = entries["N10_W10"]
    assert t["bounds"][3] > 10
    windows, _ = tmf.plan({"type": "Point", "coordinates": [-5, 10.02]})
    assert windows and windows[0].tile_id == "N10_W10"
    assert windows[0].row < 100


def test_manifest_corruption_fail_closed(tmp_path, monkeypatch):
    monkeypatch.setattr(tmf, "ROOT", tmp_path)
    (tmp_path / "qualification.json").write_text("{}")
    r = analyze_geometry(POINT, source_id="tmf-2025-epoch")
    assert (
        r["status"] == "SOURCE_UNAVAILABLE" and r["signal_status"] == "NOT_ASSESSABLE"
    )
    assert r["errors"] == ["TMF_CATALOGUE_UNAVAILABLE"]


def test_outside_without_network():
    def forbidden(*a, **kw):
        pytest.fail("no external access outside catalogue")

    r = analyze_geometry(
        {"type": "Point", "coordinates": [0, 85]},
        source_id="tmf-2025-epoch",
        fetch=forbidden,
    )
    assert r["status"] == "NOT_COVERED"


def test_polygon_hole_and_no_duplicate_pixels():
    outer = box(-5.501, 5.499, -5.499, 5.501)
    hole = box(-5.5005, 5.4995, -5.4995, 5.5005)
    full, _ = tmf.plan(json.loads(json.dumps(mapping(outer))))
    cut, _ = tmf.plan(json.loads(json.dumps(mapping(outer.difference(hole)))))
    assert sum(w.selection.sum() for w in cut) < sum(w.selection.sum() for w in full)
    keys = set()
    for w in cut:
        t = tmf.catalogue()[w.tile_id]
        for y, x in np.argwhere(w.selection):
            key = (t["global_row0"] + w.row + y, t["global_col0"] + w.col + x)
            assert key not in keys
            keys.add(key)


def test_overlap_never_complete_negative():
    r = analyze_geometry(
        {"type": "Point", "coordinates": [0.0001, 0.0001]},
        source_id="tmf-2025-epoch",
        fetch=fetch_values(),
    )
    assert r["status"] == "PARTIAL"
    assert r["signal_status"] == "NOT_ASSESSABLE"


def test_budget_and_unknown_source():
    with pytest.raises(PlanLimit):
        tmf.plan(json.loads(json.dumps(mapping(box(-6, 5, -5, 6)))))
    with pytest.raises(ValueError, match="SOURCE_NOT_ADMITTED"):
        analyze_geometry(POINT, source_id="https://localhost/private")


def test_partial_keeps_prior_signal(monkeypatch):
    windows, _ = tmf.plan(POINT)
    monkeypatch.setattr(tmf, "plan", lambda g: (windows * 2, "POINT_SAMPLE_ONLY"))
    count = 0

    def fetch(*a, **kw):
        nonlocal count
        count += 1
        if count > 3:
            raise SourceReadError("TEST_OUTAGE")
        return fetch_values(2025)(*a, **kw)

    r = analyze_geometry(POINT, source_id="tmf-2025-epoch", fetch=fetch)
    assert r["status"] == "PARTIAL" and r["signal_status"] == "SIGNAL_OBSERVED"


@pytest.mark.parametrize(
    "layer,tile",
    [
        ("lossyear", "N10_W10"),
        ("DeforestationYear", "../x"),
        ("AnnualChange_2026", "N10_W10"),
    ],
)
def test_descriptor_rejects_unknown(layer, tile):
    with pytest.raises(ValueError):
        TMFMirrorTile(layer, tile)


def transport(data, *, broken=False):
    def respond(req):
        h = {"etag": '"' + "a" * 32 + '-2"', "content-length": str(len(data))}
        if req.method == "HEAD":
            return httpx.Response(200, headers=h)
        assert req.headers["if-match"] == h["etag"]
        start, end = map(int, req.headers["range"][6:].split("-"))
        h.update(
            {
                "content-length": str(end - start + 1),
                "content-range": f"bytes {start}-{end}/{len(data)}",
            }
        )
        return httpx.Response(
            503 if broken else 206,
            headers=h,
            stream=httpx.ByteStream(data[start : end + 1]),
        )

    return httpx.MockTransport(respond)


@pytest.mark.parametrize(
    "layer,value,dtype",
    [
        ("DeforestationYear", 2025, "uint16"),
        ("DegradationYear", 2005, "uint16"),
        ("AnnualChange_2020", 1, "uint8"),
    ],
)
@pytest.mark.parametrize("internal_mask", [False, True])
def test_native_raster_multipart_etag_no_gcs(
    monkeypatch, layer, value, dtype, internal_mask
):
    t = Affine(tmf.STEP, 0, 0, 0, -tmf.STEP, 4 * tmf.STEP)
    monkeypatch.setattr(
        tmf,
        "catalogue",
        lambda: {"N10_W10": {"width": 4, "height": 4, "transform": tuple(t)}},
    )
    with MemoryFile() as f:
        with f.open(
            driver="GTiff",
            width=4,
            height=4,
            count=1,
            dtype=dtype,
            crs="EPSG:4326",
            transform=t,
        ) as ds:
            ds.write(np.full((4, 4), value, dtype=dtype), 1)
            if internal_mask:
                ds.write_mask(np.zeros((4, 4), dtype=np.uint8))
        raw = f.read()
    if internal_mask:
        with pytest.raises(SourceReadError, match="UNQUALIFIED_TMF_GRID"):
            tmf.read_window(
                TMFMirrorTile(layer, "N10_W10"), 1, 1, 2, 2, transport=transport(raw)
            )
        return
    a, proof = tmf.read_window(
        TMFMirrorTile(layer, "N10_W10"), 1, 1, 2, 2, transport=transport(raw)
    )
    assert a.tolist() == [[value] * 2] * 2
    assert proof["pixel_bytes_sha256"] == hashlib.sha256(a.tobytes()).hexdigest()
    assert proof["source_reads"][0]["generation"] is None
    with pytest.raises(SourceReadError):
        tmf.read_window(
            TMFMirrorTile(layer, "N10_W10"),
            1,
            1,
            2,
            2,
            transport=transport(raw, broken=True),
        )


@pytest.mark.parametrize("value", [21, 1981, 2026, 65535])
def test_unknown_year_rejected(value):
    arrays = {
        k: np.array(
            [[1 if k == "AnnualChange_2020" else value]],
            dtype=np.uint8 if k == "AnnualChange_2020" else np.uint16,
        )
        for k in tmf.LAYERS
    }
    with pytest.raises(ValueError, match="UNKNOWN_TMF_CLASS"):
        tmf.summarize(arrays, np.ones((1, 1), dtype=bool))
