"""Fail closed even when an ASGI adapter does not emit lifespan events."""

import time
from threading import Lock

from app.config import settings
from app.database import transaction
from app.readiness import UnsafeRuntimeDatabase, verify_ready_connection
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse


class RuntimeReadinessGate:
    def __init__(self, app):
        self.app = app
        self._lock = Lock()
        self._until = 0.0
        self._database = None

    def check(self):
        cfg = settings()
        if not self._lock.acquire(timeout=5):
            raise UnsafeRuntimeDatabase("Runtime check busy")
        try:
            if self._database == cfg.database_url and time.monotonic() < self._until:
                return
            # Failed checks are never cached as success.
            self._until = 0.0
            with transaction() as conn:
                verify_ready_connection(conn)
            self._database = cfg.database_url
            self._until = time.monotonic() + 60
        finally:
            self._lock.release()

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] == "http"
            and settings().app_env == "production"
            and scope["path"] != "/health/live"
        ):
            try:
                await run_in_threadpool(self.check)
            except (SQLAlchemyError, UnsafeRuntimeDatabase):
                await JSONResponse(
                    {"detail": "Configuration de données non prête"},
                    status_code=503,
                    headers={
                        "Cache-Control": "no-store",
                        "X-Content-Type-Options": "nosniff",
                    },
                )(scope, receive, send)
                return
        await self.app(scope, receive, send)
