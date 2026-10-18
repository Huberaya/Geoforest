"""Garde-fous de configuration CORS pour le service FastAPI retiré du chemin produit."""
import pytest

from app.core.config import settings, validate_cors_origins


def test_origines_cors_par_defaut_sans_joker():
    assert "*" not in settings.cors_origins
    assert settings.cors_origins == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def test_production_refuse_origine_cors_joker():
    with pytest.raises(ValueError, match="CORS_ORIGINS ne peut pas contenir"):
        validate_cors_origins(["https://app.example", "*"], production=True)


def test_production_accepte_liste_origines_explicitement_autorisees():
    validate_cors_origins(["https://app.example", "https://admin.example"], production=True)


def test_developpement_peut_utiliser_origines_configurees():
    validate_cors_origins(["http://localhost:3000", "*"], production=False)
