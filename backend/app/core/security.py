"""Authentification du backend FastAPI (C5).

⚠️ Ce que ce module corrige.

    Ce backend n'avait AUCUNE authentification. `vercel.json` le rend joignable
    publiquement sur `/fastapi/*` et `/backend/*`, et `GET /api/v1/audits`
    renvoyait l'intégralité des dossiers de toutes les organisations — pas
    seulement ceux du demandeur, pas seulement des identifiants : le contenu.

    Un backend qui n'authentifie personne n'est pas « en cours de sécurisation ».
    C'est une fuite, tant qu'il est joignable.

⚠️ Le choix retenu : fermé par défaut.

    Aucun jeton configuré ⇒ les routes métier répondent 503, pas 200. Un backend
    mal configuré ne doit rien servir, plutôt que de servir tout le monde. La
    sonde `/health`, elle, reste ouverte : elle ne dit rien du métier, et un
    orchestrateur doit pouvoir constater qu'un service tourne même mal configuré.

⚠️ Ce que ce jeton n'est PAS : une authentification multi-tenant.

    Un jeton unique prouve « l'appelant est autorisé à parler au backend », pas
    « l'appelant est cette organisation ». Les routes `/audits` restent donc
    inter-tenant par construction, et c'est pourquoi elles sont DÉSACTIVÉES
    (410) plutôt que simplement protégées — voir `endpoints.py`. Le multi-tenant
    vit dans l'application Next.js, qui porte l'isolation par organisation.
"""
from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from app.core.config import settings

_ENTETE = "authorization"


def _jeton_attendu() -> str:
    return settings.backend_api_token.strip()


def exiger_jeton(authorization: str | None = Header(default=None)) -> None:
    """Dépendance FastAPI : exige un jeton d'API valide.

    ⚠️ Trois réponses distinctes, parce qu'elles appellent trois actions
    différentes :

      503 — aucun jeton configuré : le service est fermé, l'administrateur doit
            le configurer. Ne jamais confondre avec un refus d'autorisation.
      401 — en-tête absent ou mal formé : l'appelant doit envoyer un jeton.
      403 — jeton présent mais faux : soit une erreur de configuration, soit
            une tentative. On ne renvoie pas 401 pour éviter qu'un client
            réessaie indéfiniment avec le même jeton.

    ⚠️ Comparaison à temps constant (`hmac.compare_digest`) : une comparaison
    naïve laisse fuir la longueur du préfixe correct par le temps de réponse.
    """
    attendu = _jeton_attendu()
    if not attendu:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Backend fermé : aucun jeton d'API configuré. Définissez "
                "BACKEND_API_TOKEN pour activer les routes métier."
            ),
        )

    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="En-tête Authorization requis (format : Bearer <jeton>).",
            headers={"WWW-Authenticate": "Bearer"},
        )

    schema, _, fourni = authorization.partition(" ")
    if schema.lower() != "bearer" or not fourni.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Format attendu : Authorization: Bearer <jeton>.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not hmac.compare_digest(fourni.strip(), attendu):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Jeton d'API invalide.",
        )
