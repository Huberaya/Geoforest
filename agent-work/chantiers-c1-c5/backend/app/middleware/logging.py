"""Logging des requêtes HTTP."""
from __future__ import annotations

import logging
import time
import uuid
from typing import Callable

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        t0 = time.monotonic()
        request_id = uuid.uuid4().hex
        request.state.request_id = request_id
        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        dur = (time.monotonic() - t0) * 1000
        logger.info(
            "%s %s → %s (%.0f ms) [rid=%s]",
            request.method,
            request.url.path,
            response.status_code,
            dur,
            request_id[:8],
        )
        return response
