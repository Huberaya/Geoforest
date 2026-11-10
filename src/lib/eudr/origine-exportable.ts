/**
 * Décide si l'origine d'un dossier est assez établie pour produire un export
 * de déclaration (C6f).
 *
 * ⚠️ La question que ce module tranche.
 *
 *   `country_benchmark_risk` et `country_code` sont des champs réglementaires.
 *   Jusqu'ici, un dossier dont le pays n'était pas résolu exportait une chaîne
 *   vide. Dans un dossier destiné à une autorité, une chaîne vide ne se lit pas
 *   « non résolu » : elle se lit « non renseigné par négligence ».
 *
 *   Et l'inverse est pire encore : un dossier portant une origine fausse se
 *   lit comme une affirmation. Un point mal saisi, résolu au hasard de l'ordre
 *   du fichier de frontières, produirait une déclaration qui désigne un pays
 *   de production qui n'est pas le bon.
 *
 * ⚠️ Principe retenu : on n'exporte pas ce qu'on ne sait pas nommer. Le refus
 *   est explicite et actionnable — il dit ce qui manque et comment le corriger.
 */
import type { StatutResolution } from "./resolution-pays";

export type VerdictExportabilite =
  | { exportable: true }
  | {
      exportable: false;
      /** Code stable, destiné au client et aux tests. */
      code: "ORIGINE_INDETERMINEE";
      statut: StatutResolution;
      detail: string;
      /** Ce que l'opérateur doit faire pour débloquer. */
      action: string;
    };

/**
 * @param statut        Statut de la résolution pays enregistré avec l'audit.
 * @param countryCode   Code ISO du pays de production retenu pour l'export.
 */
export function verifierOrigineExportable(
  statut: StatutResolution | string | null | undefined,
  countryCode: string | null | undefined,
): VerdictExportabilite {
  const code = (countryCode ?? "").trim().toUpperCase();

  // ⚠️ `XX` est le code d'absence de pays, pas un pays. Le traiter comme une
  //   origine reviendrait à exporter une déclaration dont le pays de
  //   production est « inconnu » — ce que le SI EUDR refuse, et ce qu'aucune
  //   autorité ne peut instruire.
  if (code === "" || code === "XX") {
    return {
      exportable: false,
      code: "ORIGINE_INDETERMINEE",
      statut: (statut as StatutResolution) ?? "HORS_COUVERTURE",
      detail:
        "Origine du produit non déterminée : aucune déclaration ne peut être établie sans pays de production.",
      action:
        "Corrigez la géolocalisation de la parcelle (le point doit se trouver à l'intérieur " +
        "d'un pays) puis relancez l'audit.",
    };
  }

  if (statut === "CONFLIT") {
    return {
      exportable: false,
      code: "ORIGINE_INDETERMINEE",
      statut: "CONFLIT",
      detail:
        "Origine contestée : le point se situe dans plusieurs pays à la fois selon le jeu de frontières.",
      action:
        "Déplacez le point à l'intérieur du territoire du pays de production attendu, " +
        "puis relancez l'audit.",
    };
  }

  if (statut === "HORS_COUVERTURE") {
    return {
      exportable: false,
      code: "ORIGINE_INDETERMINEE",
      statut: "HORS_COUVERTURE",
      detail:
        "Origine non établie : le point ne tombe dans aucun pays connu (mer, zone non couverte, " +
        "ou coordonnées saisies dans le mauvais ordre).",
      action:
        "Vérifiez l'ordre des coordonnées GeoJSON ([longitude, latitude]) et la position de la " +
        "parcelle, puis relancez l'audit.",
    };
  }

  return { exportable: true };
}
