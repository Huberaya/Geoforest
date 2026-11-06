/**
 * Niveau de risque d'une PARCELLE, distinct du risque de son PAYS.
 *
 * ⚠️ Le défaut corrigé ici (C6d).
 *
 *   `risk_level` valait `country.risk` dans les trois fonctions d'analyse.
 *   Conséquence : une parcelle ghanéenne dont l'analyse avait échoué sortait
 *   en « Risque parcelle : Faible », parce que le Ghana est LOW à l'annexe.
 *   L'interface affichait côte à côte « Risque pays : Faible » et « Risque
 *   parcelle : Faible », ce qui se lit comme deux confirmations indépendantes
 *   alors qu'il n'y en avait qu'une, recopiée.
 *
 *   Or le règlement d'exécution (UE) 2025/1093 classe des PAYS. Il ne dit rien
 *   d'une parcelle. Le risque d'une parcelle dépend de ce qu'on a mesuré sur
 *   elle — et quand on n'a rien mesuré, il n'y a pas de niveau : il y a une
 *   absence.
 *
 * ⚠️ Principe appliqué : le risque pays est une ENTRÉE du raisonnement, jamais
 *    son résultat. Il ne peut que faire monter le niveau de la parcelle, et
 *    seulement si une analyse a réellement eu lieu.
 */
import type { RiskLevel } from "./types";

/** Ce qu'une analyse a établi sur la parcelle elle-même. */
export type ConstatParcelle =
  /** Aucune analyse n'a pu être menée : rien n'est connu de la parcelle. */
  | "NON_ANALYSEE"
  /** Analyse probante, aucune perte de couvert post-butoir au-dessus du seuil. */
  | "AUCUNE_PERTE"
  /** Analyse probante, perte de couvert post-butoir au-dessus du seuil. */
  | "PERTE_CONSTATEE"
  /** Moteur de démonstration : chiffres inventés, aucun verdict possible. */
  | "SIMULATION";

/** Ordre croissant de gravité — sert à ne jamais redescendre sous le pays. */
const RANG: Record<RiskLevel, number> = { LOW: 0, STANDARD: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Niveau de risque de la parcelle.
 *
 * @returns `null` quand aucune analyse n'a été menée — c'est-à-dire quand
 *          aucun niveau ne peut être affirmé.
 */
export function niveauRisqueParcelle(
  constat: ConstatParcelle,
  risquePays: RiskLevel,
): RiskLevel | null {
  switch (constat) {
    // ⚠️ Le cas central de C6d. Une analyse indisponible ne produit aucun
    //   niveau : recopier celui du pays reviendrait à affirmer un résultat
    //   d'analyse alors qu'il n'y en a pas eu.
    case "NON_ANALYSEE":
      return null;

    // Une simulation ne rend pas de verdict (P0-04) : elle ne peut donc pas
    // porter de niveau de risque parcellaire.
    case "SIMULATION":
      return null;

    // Perte constatée : le niveau est élevé quelle que soit l'origine. Une
    // parcelle déboisée après le 31/12/2020 n'est pas « à faible risque »
    // parce qu'elle se trouve dans un pays classé LOW.
    case "PERTE_CONSTATEE":
      return "HIGH";

    // Aucune perte mesurée. On ne descend jamais sous le niveau du pays : le
    // règlement demande de tenir compte de la classification (art. 10(2)(a)),
    // et une parcelle saine dans un pays HIGH reste un dossier à examiner.
    case "AUCUNE_PERTE":
      return RANG[risquePays] >= RANG.STANDARD ? risquePays : "STANDARD";
  }
}

/** Libellé affichable, y compris l'absence de niveau. */
export function libelleNiveauParcelle(niveau: RiskLevel | null): string {
  if (niveau === null) return "Non établi";
  return { LOW: "Faible", STANDARD: "Standard", HIGH: "Élevé", CRITICAL: "Critique" }[niveau];
}

/**
 * Détermine le constat à partir de ce que les fonctions d'analyse savent.
 * Isolé pour que la correspondance soit vérifiable en un seul endroit.
 */
export function constatDepuisAnalyse(
  source: "gfw-live" | "simulated" | "unavailable",
  conforme: boolean | null,
): ConstatParcelle {
  if (source === "unavailable") return "NON_ANALYSEE";
  if (source === "simulated") return "SIMULATION";
  if (conforme === false) return "PERTE_CONSTATEE";
  return "AUCUNE_PERTE";
}
