"""Bounded public GFC reads, not a parcel endpoint or authorization boundary.

Only constructed URLs are admitted. No caller URL, geometry, identifiers, API
credentials, redirects, compressed HTTP bodies or implicit full-file download.
The caller must authorize a parcel before deriving any requested window.
"""

import hashlib
import io
import re
import time
from collections import OrderedDict
from dataclasses import dataclass

import httpx

BASE = "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2025-v1.13/"
LAYERS = frozenset({"lossyear", "datamask", "treecover2000"})
BLOCK_BYTES = 64 * 1024
MAX_TRANSFER = 8 * 1024 * 1024
MAX_REQUESTS = 128
MAX_CACHE_BLOCKS = 16
MAX_SECONDS = 30
MAX_FILE_BYTES = 4 * 1024**3


class SourceReadError(OSError):
    """Diagnostic codes only: do not expose URLs/query contents from exceptions."""


@dataclass(frozen=True)
class GFCTile:
    layer: str
    north: int
    west: int

    def __post_init__(self):
        if not isinstance(self.layer, str) or self.layer not in LAYERS:
            raise ValueError("UNSUPPORTED_LAYER")
        if type(self.north) is not int or self.north not in range(-50, 81, 10):
            raise ValueError("UNSUPPORTED_TILE_LATITUDE")
        if type(self.west) is not int or self.west not in range(-180, 171, 10):
            raise ValueError("UNSUPPORTED_TILE_LONGITUDE")

    @property
    def tile_id(self):
        return (
            f"{abs(self.north):02d}{'N' if self.north >= 0 else 'S'}_"
            f"{abs(self.west):03d}{'E' if self.west >= 0 else 'W'}"
        )

    @property
    def url(self):
        return BASE + f"Hansen_GFC-2025-v1.13_{self.layer}_{self.tile_id}.tif"


class RangeReader(io.RawIOBase):
    """Seekable, per-read-session bounded LRU. No cross-tenant result cache.

    This cache contains only upstream public bytes, not parcel observations.
    The fixed budgets include re-fetches after eviction and the HEAD request.
    GDAL/Rasterio adapters must still bound decoded pixels/memory separately.
    """

    def __init__(self, tile: GFCTile, *, transport=None):
        super().__init__()
        if type(tile) is not GFCTile:
            raise ValueError("GFC_TILE_REQUIRED")
        self.tile = tile
        self.position = 0
        self.transferred = 0
        self.requests = 0
        self.ranges = []
        self.cache = OrderedDict()
        self.deadline = time.monotonic() + MAX_SECONDS
        self.client = httpx.Client(
            transport=transport,
            follow_redirects=False,
            trust_env=False,
            timeout=5,
            headers={"Accept-Encoding": "identity"},
        )
        try:
            self._budget()
            self.requests += 1
            # Stream HEAD too: never accept a surprise response body.
            with self.client.stream("HEAD", tile.url) as response:
                if response.status_code != 200:
                    raise SourceReadError("SOURCE_METADATA_UNAVAILABLE")
                h = response.headers
                if h.get("content-encoding", "identity") != "identity":
                    raise SourceReadError("HTTP_ENCODING_UNSUPPORTED")
                size = h.get("content-length", "")
                generation = h.get("x-goog-generation", "")
                etag = h.get("etag", "")
                if not re.fullmatch(r"[0-9]{1,11}", size):
                    raise SourceReadError("INVALID_SOURCE_SIZE")
                self.size = int(size)
                if not 8 <= self.size <= MAX_FILE_BYTES:
                    raise SourceReadError("SOURCE_SIZE_LIMIT")
                if not re.fullmatch(r"[0-9]{1,30}", generation):
                    raise SourceReadError("SOURCE_GENERATION_REQUIRED")
                if not re.fullmatch(r'"[0-9a-fA-F]{32}"', etag):
                    raise SourceReadError("SOURCE_ETAG_REQUIRED")
                self.generation = generation
                self.etag = etag
                self.last_modified = h.get("last-modified")
            self._budget()
        except (httpx.HTTPError, SourceReadError) as exc:
            self.close()
            if isinstance(exc, SourceReadError):
                raise
            raise SourceReadError("SOURCE_NETWORK_ERROR") from None

    def _budget(self):
        if self.closed:
            raise ValueError("READER_CLOSED")
        if time.monotonic() >= self.deadline:
            raise SourceReadError("SOURCE_TIME_BUDGET")
        if self.requests >= MAX_REQUESTS:
            raise SourceReadError("SOURCE_REQUEST_BUDGET")

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        if self.closed:
            raise ValueError("READER_CLOSED")
        if type(offset) is not int or whence not in (0, 1, 2):
            raise ValueError("INVALID_SEEK")
        position = offset + {0: 0, 1: self.position, 2: self.size}[whence]
        if not 0 <= position <= self.size:
            raise SourceReadError("SEEK_OUT_OF_BOUNDS")
        self.position = position
        return position

    def _block(self, start):
        self._budget()
        if start in self.cache:
            self.cache.move_to_end(start)
            return self.cache[start]
        end = min(start + BLOCK_BYTES, self.size) - 1
        expected = end - start + 1
        if self.transferred + expected > MAX_TRANSFER:
            raise SourceReadError("SOURCE_BYTE_BUDGET")
        self.requests += 1
        self.transferred += expected  # Reserve even if the request fails.
        try:
            with self.client.stream(
                "GET",
                self.tile.url,
                params={"generation": self.generation},
                headers={
                    "Range": f"bytes={start}-{end}",
                    "If-Match": self.etag,
                },
                timeout=max(0.001, min(5, self.deadline - time.monotonic())),
            ) as response:
                if response.status_code != 206:
                    raise SourceReadError("SOURCE_RANGE_REJECTED")
                h = response.headers
                if (
                    h.get("etag") != self.etag
                    or h.get("x-goog-generation") != self.generation
                ):
                    raise SourceReadError("SOURCE_VERSION_CHANGED")
                if h.get("content-encoding", "identity") != "identity":
                    raise SourceReadError("HTTP_ENCODING_UNSUPPORTED")
                if h.get(
                    "content-range"
                ) != f"bytes {start}-{end}/{self.size}" or h.get(
                    "content-length"
                ) != str(expected):
                    raise SourceReadError("INVALID_CONTENT_RANGE")
                body = bytearray()
                for chunk in response.iter_raw():
                    if time.monotonic() >= self.deadline:
                        raise SourceReadError("SOURCE_TIME_BUDGET")
                    if len(body) + len(chunk) > expected:
                        raise SourceReadError("SOURCE_RESPONSE_TOO_LARGE")
                    body.extend(chunk)
                if len(body) != expected:
                    raise SourceReadError("SOURCE_RESPONSE_TRUNCATED")
        except httpx.HTTPError:
            raise SourceReadError("SOURCE_NETWORK_ERROR") from None
        data = bytes(body)
        self.ranges.append(
            {
                "offset": start,
                "length": expected,
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
        self.cache[start] = data
        if len(self.cache) > MAX_CACHE_BLOCKS:
            self.cache.popitem(last=False)
        return data

    def read(self, size=-1):
        self._budget()
        if type(size) is not int:
            raise ValueError("INVALID_READ_SIZE")
        remaining = self.size - self.position
        size = remaining if size < 0 else min(size, remaining)
        # A library attempting to materialize an entire raster fails closed.
        if size > MAX_TRANSFER:
            raise SourceReadError("READ_ALLOCATION_LIMIT")
        result = bytearray()
        while len(result) < size:
            start = (self.position // BLOCK_BYTES) * BLOCK_BYTES
            block = self._block(start)
            offset = self.position - start
            portion = block[
                offset : offset + min(size - len(result), len(block) - offset)
            ]
            result.extend(portion)
            self.position += len(portion)
        return bytes(result)

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[: len(data)] = data
        return len(data)

    def provenance(self):
        return {
            "dataset": "Hansen GFC",
            "version": "2025-v1.13",
            "url": self.tile.url,
            "generation": self.generation,
            "etag": self.etag,
            "upstream_size_bytes": self.size,
            "last_modified": self.last_modified,
            "range_sha256": list(self.ranges),
            "whole_upstream_sha256": None,
            "reserved_transfer_bytes": self.transferred,
            "requests": self.requests,
        }

    def close(self):
        if not self.closed:
            if hasattr(self, "cache"):
                self.cache.clear()
            if hasattr(self, "client"):
                self.client.close()
        super().close()
