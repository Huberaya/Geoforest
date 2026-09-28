import hashlib
from datetime import datetime, timezone

from app.config import settings
from app.database import transaction
from sqlalchemy import text
from starlette.responses import JSONResponse


class RequestBoundary:
    """Bound API bodies before parsing. Shared, atomic rate buckets across worker processes."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])

        async def reject(status, detail):
            await JSONResponse({"detail": detail}, status_code=status)(
                scope, receive, send
            )

        chunks = []
        total = 0
        if scope["path"].startswith("/api/"):
            try:
                if (
                    int(headers.get(b"content-length", b"0"))
                    > settings().max_body_bytes
                ):
                    return await reject(413, "Requête trop volumineuse")
            except ValueError:
                return await reject(400, "Content-Length invalide")
            while True:
                event = await receive()
                if event["type"] == "http.disconnect":
                    return
                total += len(event.get("body", b""))
                if total > settings().max_body_bytes:
                    return await reject(413, "Requête trop volumineuse")
                chunks.append(event.get("body", b""))
                if not event.get("more_body", False):
                    break
            # Do not trust caller-controlled X-Forwarded-For. Proxy-level per-IP limits
            # are additionally needed in production; peer limits here are conservative.
            peer = (scope.get("client") or ("unknown", 0))[0]
            category = (
                "login"
                if scope["path"] in {"/api/auth/login", "/api/portal/exchange"}
                else "api"
            )
            window = datetime.now(timezone.utc).replace(second=0, microsecond=0)
            key = hashlib.sha256(f"{peer}|{category}".encode()).hexdigest()

            def rate_check():
                with transaction() as conn:
                    hits = conn.execute(
                        text("""INSERT INTO rate_buckets(key,window_start,hits) VALUES(:k,:w,1)
                      ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,
                      hits=CASE WHEN rate_buckets.window_start=excluded.window_start THEN rate_buckets.hits+1 ELSE 1 END
                      RETURNING hits"""),
                        {"k": key, "w": window},
                    ).scalar_one()
                    conn.execute(
                        text(
                            "DELETE FROM rate_buckets WHERE window_start < now()-interval '10 minutes'"
                        )
                    )
                    return hits

            from starlette.concurrency import run_in_threadpool

            try:
                hits = await run_in_threadpool(rate_check)
            except Exception:
                return await reject(503, "Service temporairement indisponible")
            if hits > (10 if category == "login" else 120):
                return await reject(429, "Trop de requêtes : réessayez dans une minute")
            delivered = False

            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {
                        "type": "http.request",
                        "body": b"".join(chunks),
                        "more_body": False,
                    }
                return await receive()
        else:
            replay = receive

        async def safe_send(message):
            if message["type"] == "http.response.start":
                message["headers"] += [
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"x-frame-options", b"DENY"),
                    (b"cache-control", b"no-store"),
                ]
            await send(message)

        await self.app(scope, replay, safe_send)
