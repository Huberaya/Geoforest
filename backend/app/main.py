"""Point d'entrée FastAPI — GeoForest Trace (conformité EUDR 2023/1115)."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.endpoints import router as v1_router
from app.core.config import settings
from app.core.database import get_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    get_db()  # crée le schéma SQLite si nécessaire
    yield


app = FastAPI(
    lifespan=lifespan,
    title=settings.app_name,
    version=settings.app_version,
    description=(
        "Micro-SaaS de conformité au Règlement (UE) 2023/1115 (EUDR) : validation GIS des parcelles, "
        "détection de déforestation post-2020 (Hansen / Global Forest Watch) et export TRACES-NT."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.include_router(v1_router, prefix=settings.api_v1_prefix)


@app.get("/health", tags=["system"])
def root_health() -> dict:
    return {"status": "ok", "service": settings.app_name, "version": settings.app_version}
