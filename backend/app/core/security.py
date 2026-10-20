"""Authentification du backend FastAPI.

⚠️ Pourquoi un jeton de service, et pas une session.

Ce backend ne connaît ni utilisateur ni organisation : sa base SQLite ne
contient aucune colonne de tenant. Il ne peut donc pas appliquer un
cloisonnement inter-organisations. La seule position tenable est de le
traiter comme un service **mono-tenant**, interne, et de refuser toute
requête anonyme.

Le jeton est comparé en temps constant. Absent de la configuration, le
service **échoue fermé** (503) : une variable oubliée ne doit pas rouvrir
les données.
"""
from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException, status

from app.core.config import settings


def require_backend_token(authorization: str | None = Header(default=None)) -> None:
    """Dépendance FastAPI : exige `Authorization: Bearer <GF_BACKEND_TOKEN>`."""

    # ⚠️ Lu à chaque requête, et non depuis `settings` : `Settings` est
    #   construit une fois à l'import. Un jeton posé après l'import (tests,
    #   rotation, injection d'environnement) serait sinon ignoré en silence,
    #   et le service répondrait 503 alors que la variable est bien là.
    attendu = os.getenv("GF_BACKEND_TOKEN", "").strip()
    if not attendu:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Service non configuré : GF_BACKEND_TOKEN est absent. "
                "Les routes de données restent fermées."
            ),
        )

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Jeton d'accès requis.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    fourni = authorization[7:].strip()
    # `compare_digest` sur des octets : la comparaison ne dépend pas du temps
    # que mettrait un `==` à s'arrêter au premier caractère différent.
    if not hmac.compare_digest(fourni.encode("utf-8"), attendu.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Jeton d'accès invalide.",
            headers={"WWW-Authenticate": "Bearer"},
        )
