/**
 * Machine d'état d'un dossier de diligence raisonnée (DDS) — chantier 3, B-12.
 *
 * Module pur (aucune dépendance à la base) : les routes et les contrôles de
 * non-régression s'appuient sur les mêmes règles.
 *
 * Règles :
 *   · Les transitions MANUELLES (PATCH /api/v1/due-diligence/{id}) suivent
 *     `TRANSITIONS`. Un état absent de ces listes cibles n'est jamais atteint
 *     à la main.
 *   · `EXPORTED` ne se pose que par l'export d'un dossier prêt
 *     (POST /api/v1/export/traces), après une nouvelle vérification de la
 *     readiness. Il signifie « brouillon généré, non transmis ».
 *   · `SUBMITTED` et `DECLARED` supposent un accusé d'un système officiel
 *     (TRACES NT). Aucune intégration n'existe : ces états sont inatteignables
 *     et l'application les refuse explicitement (P0-06, TRACES_SCOPE.md §5).
 *   · Un dossier « figé » (READY_FOR_DECLARATION, EXPORTED, SUBMITTED, DECLARED)
 *     n'accepte plus de rattachement d'analyse, de détachement ni de changement
 *     de ses données. Le repasser en revue (UNDER_REVIEW) est la seule issue.
 */
import type { DdsStatus } from "./types";

/** Transitions manuelles admises. Les cibles EXPORTED, SUBMITTED et DECLARED ne figurent dans aucune liste. */
export const TRANSITIONS: Record<DdsStatus, DdsStatus[]> = {
  DRAFT: ["MISSING_DATA", "IN_ANALYSIS", "ARCHIVED"],
  MISSING_DATA: ["DRAFT", "IN_ANALYSIS", "ARCHIVED"],
  IN_ANALYSIS: ["UNDER_REVIEW", "RISK_IDENTIFIED", "MISSING_DATA", "ARCHIVED"],
  UNDER_REVIEW: ["RISK_IDENTIFIED", "ACTION_REQUIRED", "READY_FOR_DECLARATION", "IN_ANALYSIS", "ARCHIVED"],
  RISK_IDENTIFIED: ["ACTION_REQUIRED", "UNDER_REVIEW", "ARCHIVED"],
  ACTION_REQUIRED: ["UNDER_REVIEW", "RISK_IDENTIFIED", "ARCHIVED"],
  READY_FOR_DECLARATION: ["UNDER_REVIEW", "ACTION_REQUIRED", "ARCHIVED"],
  // Sortie de l'export : le brouillon généré ne vaut plus pour des données modifiées.
  EXPORTED: ["UNDER_REVIEW", "ARCHIVED"],
  // Inatteignables (aucun accusé officiel). Les sorties sont décrites pour le jour où une intégration existerait.
  SUBMITTED: ["ARCHIVED"],
  DECLARED: ["ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

/** Transition réalisée par l'action d'export, et par elle seule. */
export const TRANSITION_EXPORT: { de: DdsStatus; vers: DdsStatus } = {
  de: "READY_FOR_DECLARATION",
  vers: "EXPORTED",
};

/** États qui figent le dossier : plus de rattachement, de détachement ni de modification de ses données. */
export const ETATS_FIGES: readonly DdsStatus[] = ["READY_FOR_DECLARATION", "EXPORTED", "SUBMITTED", "DECLARED"];

/** États qu'aucune action manuelle ne peut poser. */
export const ETATS_ACTION_SEULE: readonly DdsStatus[] = ["EXPORTED", "SUBMITTED", "DECLARED"];

/** États pour lesquels la readiness se lit « prêt » (READY_FOR_DDS) lorsque aucun blocage ni manquant ne subsiste. */
export const ETATS_VALIDES: readonly DdsStatus[] = ["READY_FOR_DECLARATION", "EXPORTED", "SUBMITTED", "DECLARED"];

export type VerdictTransition = { admise: true } | { admise: false; motif: string };

/** Vérifie une demande de changement de statut manuel. */
export function verifierTransitionManuelle(de: DdsStatus, vers: DdsStatus): VerdictTransition {
  if (vers === "SUBMITTED") {
    return {
      admise: false,
      motif:
        "Le statut « SUBMITTED » ne peut être atteint par aucune action : il suppose un accusé de soumission " +
        "officielle à TRACES, qu'aucune intégration de ce produit n'obtient à ce jour.",
    };
  }
  if (vers === "DECLARED") {
    return {
      admise: false,
      motif:
        "Le statut « DECLARED » ne peut pas être attribué depuis cette application : il suppose un accusé du " +
        "système d'information EUDR, qu'aucun composant du produit ne peut obtenir aujourd'hui.",
    };
  }
  if (vers === "EXPORTED") {
    return {
      admise: false,
      motif:
        "Le statut « EXPORTED » ne se pose que par l'export d'un dossier prêt pour déclaration " +
        "(POST /api/v1/export/traces).",
    };
  }
  if (!(TRANSITIONS[de] ?? []).includes(vers)) {
    return { admise: false, motif: `Transition refusée : « ${de} » → « ${vers} » n'est pas un enchaînement admis.` };
  }
  return { admise: true };
}

/** Vrai si le dossier, dans cet état, refuse rattachement, détachement et modification de ses données. */
export function estFige(statut: DdsStatus): boolean {
  return ETATS_FIGES.includes(statut);
}
