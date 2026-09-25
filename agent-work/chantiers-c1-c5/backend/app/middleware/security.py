"""Middlewares de sécurité et de rate-limit."""
from __future__ import annotations

import time
import uuid
import logging
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.config import settings
from app.core.rate_limiter import api_limiter, login_limiter

logger = logging.getLogger(__name__)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Ajoute des en-têtes HTTP de sécurité de base."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(self), payment=()"
        )
        from app.core.config import settings as _s
        if _s.environment == "production":
            response.headers["Strict-Transport-Security"] = (
                "max-age=63072000; includeSubDomains; preload"
            )
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Rate limiting basique par IP.

    - /auth/login : seuil serré (anti brute-force)
    - autres endpoints : seuil plus large
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        client_ip = request.client.host if request.client else "unknown"
        path = request.url.path
        is_login = path.endswith("/auth/login") and request.method == "POST"
        limiter = login_limiter if is_login else api_limiter
        key = f"{client_ip}:{path}" if is_login else client_ip

        allowed, remaining = limiter.hit(key)
        if not allowed:
            return JSONResponse(
                status_code=429,
                content={"detail": "Trop de requêtes. Réessayez plus tard."},
                headers={"Retry-After": "60"},
            )

        response: Response = await call_next(request)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response


class LoggingMiddleware(BaseHTTPMiddleware):
    """Log basique des requêtes en dev."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        t0 = time.monotonic()
        response: Response = await call_next(request)
        if settings.environment == "development":
            dur = (time.monotonic() - t0) * 1000
            logger.info(
                "%s %s → %s (%.0f ms)",
                request.method,
                request.url.path,
                response.status_code,
                dur,
            )
        return response
