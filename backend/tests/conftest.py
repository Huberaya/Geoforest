"""Configuration commune des tests du backend.

⚠️ Le jeton est posé **avant** l'import de `app.core.config` : `Settings` lit
l'environnement à sa construction, et les modules de test importent `app.main`
en tête de fichier. Le poser dans une fixture serait trop tard.
"""
from __future__ import annotations

import os

os.environ.setdefault("BACKEND_API_TOKEN", "jeton-de-test-backend")

import pytest  # noqa: E402

from app.core.config import settings  # noqa: E402


@pytest.fixture()
def fixer_jeton_backend():
    """Pose (ou retire, avec "") le jeton attendu par `exiger_jeton`, puis le restaure.

    ⚠️ `settings` est figé à l'import : modifier l'environnement après coup est
    sans effet. On modifie l'instance, comme `test_securite_backend.py`.
    """
    precedent = settings.backend_api_token

    def _fixer(valeur: str) -> None:
        object.__setattr__(settings, "backend_api_token", valeur)

    yield _fixer
    object.__setattr__(settings, "backend_api_token", precedent)
