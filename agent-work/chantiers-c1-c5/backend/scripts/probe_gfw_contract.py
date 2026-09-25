#!/usr/bin/env python3
"""Probe manuel et non-production du contrat GFW C5 sur une géométrie synthétique.

N'écrit rien en base, ne reçoit aucune géométrie utilisateur et n'affiche jamais la clé.
Le probe contourne uniquement la garde « contrat déjà vérifié » dans ce processus CLI; les
routes de l'application restent bloquées tant que les trois garde-fous live ne sont pas levés.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from urllib.parse import urlparse

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings  # noqa: E402
from app.services.satellite.deforestation_screening import (  # noqa: E402
    GFWProviderError,
    _query_gfw_yearly_loss_unchecked,
)

# Petit polygone fixe, synthétique et situé au large (près de 0°N, 0°E). Ne jamais remplacer
# par une géométrie de parcelle. L'absence de pixels est acceptable pour le test de transport.
SYNTHETIC_TEST_POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [-0.001, -0.001],
        [0.001, -0.001],
        [0.001, 0.001],
        [-0.001, 0.001],
        [-0.001, -0.001],
    ]],
}


def _validate_preconditions() -> None:
    if not settings.gfw_live_test_enabled:
        raise RuntimeError("Probe bloqué : définir GFW_LIVE_TEST_ENABLED=true explicitement.")
    if settings.environment.lower() not in {"development", "test"}:
        raise RuntimeError("Probe autorisé uniquement avec ENVIRONMENT=development ou test.")
    if settings.gfw_live_enabled or settings.gfw_contract_verified:
        raise RuntimeError(
            "Probe bloqué : garder GFW_LIVE_ENABLED=false et GFW_CONTRACT_VERIFIED=false."
        )
    if not settings.gfw_api_key.strip():
        raise RuntimeError("Probe bloqué : aucune clé GFW autorisée n'est configurée.")
    parsed = urlparse(settings.gfw_api_url)
    if parsed.scheme != "https" or parsed.hostname != "data-api.globalforestwatch.org":
        raise RuntimeError("Probe bloqué : l'URL doit être l'hôte officiel GFW en HTTPS.")
    if settings.gfw_dataset != "umd_tree_cover_loss" or settings.gfw_dataset_version != "v1.13":
        raise RuntimeError("Probe bloqué : ce script ne couvre que umd_tree_cover_loss v1.13.")
    thresholds = {settings.gfw_canopy_threshold_pct, settings.gfw_sensitivity_canopy_threshold_pct}
    if thresholds != {10, 30}:
        raise RuntimeError("Probe bloqué : les deux seuils doivent être 10 % et 30 %.")


async def _run_probe() -> int:
    thresholds = (settings.gfw_canopy_threshold_pct, settings.gfw_sensitivity_canopy_threshold_pct)
    for threshold in thresholds:
        rows = await _query_gfw_yearly_loss_unchecked(SYNTHETIC_TEST_POLYGON, threshold)
        years = ", ".join(str(year) for year in sorted(rows)) or "aucune année retournée"
        print(f"OK — filtre {threshold} % : {len(rows)} années exploitables; {years}.")

    print(
        "Probe terminé : transport, requête JSON et décodage de la réponse vérifiés. "
        "Cela ne valide pas la précision scientifique ni l'agrégation des surfaces sur une parcelle réelle."
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--confirm-synthetic-polygon",
        action="store_true",
        help="Confirmer l'envoi du polygone de test fixe au fournisseur GFW.",
    )
    args = parser.parse_args()
    if not args.confirm_synthetic_polygon:
        parser.error("confirmation requise : --confirm-synthetic-polygon")

    try:
        _validate_preconditions()
        return asyncio.run(_run_probe())
    except GFWProviderError as exc:
        print(f"Échec du probe GFW (code={exc.code}); aucun contenu fournisseur ni secret affiché.", file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception as exc:  # Fail closed; avoid printing external payloads or headers.
        print(f"Échec du probe GFW ({type(exc).__name__}); détails sensibles masqués.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
