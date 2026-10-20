"""Identité de l'opérateur — trois états, jamais confondus.

Pendant du module TypeScript `src/lib/eudr/identite-operateur.ts`. Les deux
implémentations doivent classer les dossiers **de la même façon** : un dossier
accepté par l'interface et refusé par l'API (ou l'inverse) rendrait la règle
inutilisable, et l'écart ne se verrait qu'en production.

⚠️ Pourquoi ce module existe.

Les versions antérieures remplaçaient un opérateur absent par un triplet de
remplissage (« Opérateur non renseigné » / ``XX0000000000000`` / ``XX``), écrit
en base dans des colonnes ``NOT NULL``. Ce triplet a la forme d'une identité
réelle : une fois stocké, il est indiscernable d'une identité déclarée, traverse
l'historique puis l'export, et le dossier part en déclaration en paraissant
complet.

L'absence est donc représentée par ``None``. Un dossier hérité portant encore la
valeur de remplissage est **reconnu** comme tel, jamais réécrit : savoir qu'un
dossier a été créé sans identité est une information, l'effacer la détruirait.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

#: Valeur écrite par les versions antérieures, conservée pour la *reconnaître*.
EORI_PLACEHOLDER_HISTORIQUE = "XX0000000000000"

ETATS = ("declared", "missing", "legacy_placeholder")


@dataclass(frozen=True)
class IdentiteOperateur:
    """Résultat du classement d'une identité stockée."""

    etat: str
    exportable: bool
    raison: str


def classer_identite_operateur(
    nom: Optional[str], eori: Optional[str]
) -> IdentiteOperateur:
    """Classe une identité stockée. Ne modifie rien, ne devine rien.

    Un EORI vide compte comme absent : ``""`` n'est pas une identité, et le
    traiter comme telle reproduirait le défaut sous une autre forme.
    """
    eori_normalise = (eori or "").strip()
    nom_normalise = (nom or "").strip()

    if not eori_normalise:
        return IdentiteOperateur(
            etat="missing",
            exportable=False,
            raison=(
                "Aucune identité d'opérateur n'est enregistrée pour ce dossier : "
                "une déclaration de diligence raisonnée doit identifier "
                "l'opérateur (nom et numéro EORI)."
            ),
        )

    # Comparaison insensible à la casse : c'est une sentinelle, pas un
    # identifiant. `xx0000000000000` désigne la même absence.
    if eori_normalise.upper() == EORI_PLACEHOLDER_HISTORIQUE:
        return IdentiteOperateur(
            etat="legacy_placeholder",
            exportable=False,
            raison=(
                "Ce dossier porte l'identité de remplissage héritée des versions "
                "antérieures (XX0000000000000) : l'opérateur réel n'a jamais été "
                "saisi. La valeur est conservée telle quelle ; elle doit être "
                "reprise explicitement."
            ),
        )

    if len(nom_normalise) < 2:
        return IdentiteOperateur(
            etat="missing",
            exportable=False,
            raison=(
                "Le dossier porte un EORI mais aucun nom d'opérateur exploitable : "
                "une déclaration doit nommer l'opérateur."
            ),
        )

    return IdentiteOperateur(etat="declared", exportable=True, raison="")
