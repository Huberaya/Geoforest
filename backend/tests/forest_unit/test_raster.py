import hashlib
import json
from pathlib import Path

import httpx
import numpy as np
import pytest
import rasterio
from affine import Affine
from app.forest.download import GFCTile, SourceReadError
from app.forest.raster import read_gfc_window
from rasterio.io import MemoryFile
from rasterio.windows import Window


@pytest.fixture(scope="module")
def synthetic_tiff():
    def make(*, value=25, nodata=None, west=-10):
        with MemoryFile() as f:
            with f.open(
                driver="GTiff",
                width=40000,
                height=40000,
                count=1,
                dtype="uint8",
                transform=Affine(0.00025, 0, west, 0, -0.00025, 10),
                crs="EPSG:4326",
                compress="lzw",
                blockysize=1,
                SPARSE_OK=True,
                nodata=nodata,
            ) as ds:
                a = np.full((4, 40000), value, dtype="uint8")
                ds.write(a, 1, window=Window(0, 1, 40000, 4))
            return f.read()

    return make


def transport_for(data, *, broken_get=False):
    etag = '"' + "c" * 32 + '"'

    def respond(request):
        h = {
            "etag": etag,
            "x-goog-generation": "54321",
            "content-length": str(len(data)),
        }
        if request.method == "HEAD":
            return httpx.Response(200, headers=h)
        start, end = map(int, request.headers["range"][6:].split("-"))
        h.update(
            {
                "content-range": f"bytes {start}-{end}/{len(data)}",
                "content-length": str(end - start + 1),
            }
        )
        return httpx.Response(
            503 if broken_get else 206,
            headers=h,
            stream=httpx.ByteStream(data[start : end + 1]),
        )

    return httpx.MockTransport(respond)


def test_native_window_real_decoder_synthetic_data(synthetic_tiff):
    a, evidence = read_gfc_window(
        GFCTile("lossyear", 10, -10),
        1,
        1,
        4,
        4,
        transport=transport_for(synthetic_tiff()),
    )
    assert a.tolist() == [[25] * 4] * 4
    assert evidence["pixel_bytes_sha256"] == hashlib.sha256(a.tobytes()).hexdigest()
    assert evidence["transform"][:6] == (0.00025, 0.0, -9.99975, 0.0, -0.00025, 9.99975)
    assert evidence["regulatory_status"] == "NOT_ASSESSED"
    assert evidence["human_review_required"] is True


@pytest.mark.parametrize(
    "kw,code",
    [
        ({"value": 26}, "UNKNOWN_RASTER_CLASS"),
        ({"nodata": 0}, "UNQUALIFIED_NODATA_TAG"),
        ({"west": -11}, "UNQUALIFIED_RASTER_GRID"),
    ],
)
def test_raster_rejection(synthetic_tiff, kw, code):
    with pytest.raises(SourceReadError, match=code):
        read_gfc_window(
            GFCTile("lossyear", 10, -10),
            1,
            1,
            4,
            4,
            transport=transport_for(synthetic_tiff(**kw)),
        )


def test_native_callback_failure_cannot_return_zero_data(synthetic_tiff):
    with pytest.raises(SourceReadError):
        read_gfc_window(
            GFCTile("lossyear", 10, -10),
            1,
            1,
            4,
            4,
            transport=transport_for(synthetic_tiff(), broken_get=True),
        )


@pytest.mark.parametrize(
    "window",
    [
        (-1, 0, 1, 1),
        (0, 0, 0, 1),
        (0, 0, 257, 1),
        (40000, 0, 1, 1),
        (0, 39999, 1, 2),
        (True, 0, 1, 1),
        (0, 0, 1.0, 1),
    ],
)
def test_window_limits(window):
    with pytest.raises(ValueError):
        read_gfc_window(GFCTile("lossyear", 10, -10), *window)


def test_zero_loss_is_not_nodata(synthetic_tiff):
    a, _ = read_gfc_window(
        GFCTile("lossyear", 10, -10),
        1,
        1,
        4,
        4,
        transport=transport_for(synthetic_tiff(value=0)),
    )
    assert not np.any(a)
    assert not np.ma.isMaskedArray(a)


def test_reviewed_public_extracts_offline():
    root = (
        Path(__file__).resolve().parents[2] / "reference/forest/gfc-2025-qualification"
    )
    evidence = json.loads((root / "qualification.json").read_text())
    assert evidence["production_admitted"] is False
    assert len(evidence["layers"]) == 3
    transforms = []
    for layer in evidence["layers"]:
        path = root / layer["extract_file"]
        assert (
            hashlib.sha256(path.read_bytes()).hexdigest()
            == layer["extract_file_sha256"]
        )
        with rasterio.open(path) as ds:
            a = ds.read(1)
            assert a.shape == (64, 64)
            assert tuple(ds.transform) == tuple(layer["transform"])
            transforms.append(ds.transform)
            assert (
                hashlib.sha256(a.tobytes()).hexdigest() == layer["pixel_bytes_sha256"]
            )
            values, counts = np.unique(a, return_counts=True)
            assert {str(int(v)): int(n) for v, n in zip(values, counts)} == layer[
                "class_histogram"
            ]
    assert transforms[0] == transforms[1] == transforms[2]
