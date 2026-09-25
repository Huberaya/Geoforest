"""GeoForest Trace — Point d'entrée FastAPI."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import async_session_factory, init_db
from app.db.seed import seed_if_empty
from app.middleware.logging import LoggingMiddleware
from app.middleware.security import RateLimitMiddleware, SecurityHeadersMiddleware

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await init_db()
    if settings.environment in ("development", "demo"):
        async with async_session_factory() as session:
            await seed_if_empty(session)
            await session.commit()
    yield


app = FastAPI(
    lifespan=lifespan,
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "GeoForest Trace — Plateforme SaaS de diligence raisonnée EUDR "
        "(Règlement (UE) 2023/1115). Collecte, vérification, analyse géospatiale, "
        "documentation et orchestration de la conformité déforestation."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
)

# Ordre des middlewares : le premier add_middleware est le plus à l'extérieur
# (dernier exécuté sur la sortie). On veut : Logging → RateLimit → Security → CORS.
app.add_middleware(LoggingMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Request-ID", "X-RateLimit-Remaining"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Données invalides",
            "errors": [
                {"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()
            ],
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logging.exception("Exception non gérée sur %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Erreur interne du serveur"})


app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/health", tags=["system"])
async def health() -> dict:
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
    }


@app.get("/version", tags=["system"])
async def version_info() -> dict:
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
        "eudr_cutoff_date": settings.eudr_cutoff_date.isoformat(),
        "eudr_application_lme": settings.eudr_application_date_lme.isoformat(),
        "eudr_application_sme": settings.eudr_application_date_micro_sme.isoformat(),
    }
