"""Configuration commune des tests du backend.

⚠️ Le jeton est posé **avant** l'import de `app.core.config` : `Settings` lit
l'environnement à sa construction, et les modules de test importent `app.main`
en tête de fichier. Le poser dans une fixture serait trop tard.
"""
from __future__ import annotations

import os

os.environ.setdefault("GF_BACKEND_TOKEN", "jeton-de-test-backend")
