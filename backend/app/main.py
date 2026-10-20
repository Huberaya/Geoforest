"""Point d'entrée FastAPI — GeoForest Trace (conformité EUDR 2023/1115)."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.endpoints import router as v1_router, router_protege as v1_router_protege
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
    # ⚠️ Fermées par défaut : la documentation interactive décrit toutes les
    #   routes et leurs schémas. Elle ne s'ouvre que sur demande explicite
    #   (`GF_BACKEND_DOCS=on`), pour un poste de développement.
    docs_url="/docs" if settings.docs_publiques else None,
    redoc_url="/redoc" if settings.docs_publiques else None,
    openapi_url="/openapi.json" if settings.docs_publiques else None,
)

@app.middleware("http")
async def keep_raw_body(request: Request, call_next):
    """Conserve le corps brut avant tout parsing.

    La précision des coordonnées GeoJSON doit être mesurée sur les littéraux du
    fichier reçu : `json.loads` transforme `-5.500000` en `-5.5` et détruit
    l'information (cf. P0-05). Sans cette copie, elle serait irrécupérable.
    """
    if request.method in ("POST", "PUT", "PATCH"):
        request.scope["geoforest_raw_body"] = await request.body()
    return await call_next(request)


# ⚠️ Méthodes et en-têtes nommés, et non `*` : ce service n'a que quatre
#   routes de données, toutes en GET ou POST. Autoriser `*` laissait passer
#   PUT, DELETE et PATCH jusqu'au routeur, où ils ne produisaient qu'un 405 —
#   mais le navigateur, lui, avait déjà envoyé la requête avec les
#   identifiants. `Authorization` et `Content-Type` sont les deux seuls
#   en-têtes dont le client a besoin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition"],
)

app.include_router(v1_router, prefix=settings.api_v1_prefix)
app.include_router(v1_router_protege, prefix=settings.api_v1_prefix)


@app.get("/health", tags=["system"])
def root_health() -> dict:
    return {"status": "ok", "service": settings.app_name, "version": settings.app_version}
