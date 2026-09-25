"""Compatibilité temporaire pour un ancien service à verdicts risqués.

Le moteur déterministe de démonstration et le chemin `compliant` ont été supprimés
au chantier 5. Les appels doivent migrer vers `deforestation_screening.screen_plot`,
qui fournit un signal descriptif et explicite les limites de la source.
"""
from __future__ import annotations

from typing import Any


def check_deforestation_risk(geometry: dict[str, Any], harvest_date: str) -> dict[str, Any]:
    """Refuse les anciens appels : ils retournaient un verdict/confiance non justifiés."""
    raise RuntimeError(
        "check_deforestation_risk est supprimé depuis C5; utilisez screen_plot pour un dépistage descriptif."
    )
