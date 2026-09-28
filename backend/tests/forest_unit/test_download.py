import io

import httpx
import pytest
from app.forest import download as d

ETAG = '"' + "a" * 32 + '"'
DATA = bytes(range(256)) * 1024


def server(*, get_status=206, head_overrides=None, get_overrides=None, body_delta=0):
    requests = []

    def handle(request):
        requests.append(request)
        headers = {
            "content-length": str(len(DATA)),
            "etag": ETAG,
            "x-goog-generation": "12345",
        }
        if request.method == "HEAD":
            headers.update(head_overrides or {})
            return httpx.Response(200, headers=headers)
        start, end = map(
            int, request.headers["range"].removeprefix("bytes=").split("-")
        )
        headers.update(
            {
                "content-range": f"bytes {start}-{end}/{len(DATA)}",
                "content-length": str(end - start + 1),
            }
        )
        headers.update(get_overrides or {})
        body = DATA[start : end + 1]
        if body_delta > 0:
            body += b"x" * body_delta
        elif body_delta < 0:
            body = body[:body_delta]
        return httpx.Response(
            get_status, headers=headers, stream=httpx.ByteStream(body)
        )

    return httpx.MockTransport(handle), requests


def reader(**kw):
    transport, requests = server(**kw)
    return d.RangeReader(d.GFCTile("lossyear", 10, -10), transport=transport), requests


def test_ranges_pin_version_and_cache():
    f, requests = reader()
    with f:
        f.seek(65530)
        assert f.read(20) == DATA[65530:65550]
        assert len(requests) == 3
        f.seek(65530)
        assert f.read(20) == DATA[65530:65550]
        assert len(requests) == 3
        for r in requests[1:]:
            assert r.headers["if-match"] == ETAG
            assert r.url.params["generation"] == "12345"
            assert r.headers["accept-encoding"] == "identity"
        assert len(f.provenance()["range_sha256"]) == 2
        assert f.provenance()["whole_upstream_sha256"] is None
        assert all(len(x["sha256"]) == 64 for x in f.ranges)
    assert f.closed and not f.cache


@pytest.mark.parametrize("status", [200, 301, 302, 403, 404, 412, 429, 500, 503])
def test_non_range_response_never_becomes_data(status):
    f, requests = reader(get_status=status)
    with f, pytest.raises(d.SourceReadError, match="SOURCE_RANGE_REJECTED"):
        f.read(10)
    assert len(requests) == 2


@pytest.mark.parametrize(
    "headers,code",
    [
        ({"etag": '"' + "b" * 32 + '"'}, "SOURCE_VERSION_CHANGED"),
        ({"x-goog-generation": "12346"}, "SOURCE_VERSION_CHANGED"),
        ({"content-range": "bytes 0-99/999"}, "INVALID_CONTENT_RANGE"),
        ({"content-length": "1"}, "INVALID_CONTENT_RANGE"),
        ({"content-encoding": "gzip"}, "HTTP_ENCODING_UNSUPPORTED"),
    ],
)
def test_get_headers_fail_closed(headers, code):
    f, _ = reader(get_overrides=headers)
    with f, pytest.raises(d.SourceReadError, match=code):
        f.read(1)
    assert not f.ranges


@pytest.mark.parametrize(
    "delta,code", [(-1, "SOURCE_RESPONSE_TRUNCATED"), (1, "SOURCE_RESPONSE_TOO_LARGE")]
)
def test_response_length(delta, code):
    f, _ = reader(body_delta=delta)
    with f, pytest.raises(d.SourceReadError, match=code):
        f.read(1)


@pytest.mark.parametrize(
    "headers,code",
    [
        ({"etag": ""}, "SOURCE_ETAG_REQUIRED"),
        ({"etag": "W/" + ETAG}, "SOURCE_ETAG_REQUIRED"),
        ({"x-goog-generation": "abc"}, "SOURCE_GENERATION_REQUIRED"),
        ({"content-length": "999999999999999999999"}, "INVALID_SOURCE_SIZE"),
        ({"content-length": "0"}, "SOURCE_SIZE_LIMIT"),
        ({"content-length": str(d.MAX_FILE_BYTES + 1)}, "SOURCE_SIZE_LIMIT"),
        ({"content-encoding": "gzip"}, "HTTP_ENCODING_UNSUPPORTED"),
    ],
)
def test_bad_metadata(headers, code):
    with pytest.raises(d.SourceReadError, match=code):
        reader(head_overrides=headers)


@pytest.mark.parametrize(
    "args",
    [
        ("../../secret", 10, -10),
        ("lossyear", True, -10),
        ("lossyear", 90, -10),
        ("lossyear", -60, -10),
        ("lossyear", 10, 180),
        ("lossyear", 10, 11),
        ("lossyear", 10.0, -10),
        ("lossyear", 10, -190),
    ],
)
def test_tile_validation(args):
    with pytest.raises(ValueError):
        d.GFCTile(*args)


def test_tile_axes():
    assert d.GFCTile("lossyear", 0, 0).tile_id == "00N_000E"
    assert d.GFCTile("datamask", -50, -180).tile_id == "50S_180W"


def test_reader_seeks_and_eof():
    f, _ = reader()
    with f:
        assert f.seek(-3, io.SEEK_END) == len(DATA) - 3
        b = bytearray(3)
        assert f.readinto(b) == 3
        assert b == DATA[-3:]
        assert f.read(20) == b""
        assert f.seek(-3, io.SEEK_CUR) == len(DATA) - 3
        for offset in [-1, len(DATA) + 1]:
            with pytest.raises(d.SourceReadError, match="SEEK_OUT_OF_BOUNDS"):
                f.seek(offset)
    with pytest.raises(ValueError):
        f.read(1)


def test_allocation_and_byte_budget(monkeypatch):
    f, _ = reader()
    with f:
        monkeypatch.setattr(d, "MAX_TRANSFER", d.BLOCK_BYTES)
        with pytest.raises(d.SourceReadError, match="READ_ALLOCATION_LIMIT"):
            f.read()
        f.read(1)
        f.seek(d.BLOCK_BYTES)
        with pytest.raises(d.SourceReadError, match="SOURCE_BYTE_BUDGET"):
            f.read(1)


def test_request_budget(monkeypatch):
    f, _ = reader()
    with f:
        monkeypatch.setattr(d, "MAX_REQUESTS", 2)
        f.read(1)
        f.seek(d.BLOCK_BYTES)
        with pytest.raises(d.SourceReadError, match="SOURCE_REQUEST_BUDGET"):
            f.read(1)


def test_time_budget():
    f, _ = reader()
    with f:
        f.deadline = 0
        with pytest.raises(d.SourceReadError, match="SOURCE_TIME_BUDGET"):
            f.read(1)


def test_cache_eviction(monkeypatch):
    f, requests = reader()
    with f:
        monkeypatch.setattr(d, "MAX_CACHE_BLOCKS", 1)
        f.read(1)
        f.seek(d.BLOCK_BYTES)
        f.read(1)
        assert len(f.cache) == 1
        f.seek(0)
        f.read(1)
        assert len(requests) == 4


def test_network_error_does_not_expose_details():
    def error(request):
        raise httpx.ConnectError("private diagnostic", request=request)

    with pytest.raises(d.SourceReadError, match="^SOURCE_NETWORK_ERROR$"):
        d.RangeReader(
            d.GFCTile("lossyear", 10, -10), transport=httpx.MockTransport(error)
        )
