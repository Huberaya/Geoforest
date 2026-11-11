import type { Composant, EtatComposant } from "./regles";

const CRITIQUES = new Set(["base", "schema"]);

export interface EvaluationSante {
  critiquesEnPanne: Composant[];
  degrades: Composant[];
  indisponible: boolean;
  degrade: boolean;
  statut: EtatComposant | "healthy" | "degraded" | "unavailable";
  codeHttp: 200 | 503;
}

export function composantCritique(nom: string): boolean {
  return CRITIQUES.has(nom);
}

/**
 * Évalue la vivacité sans confondre une dépendance de stockage indisponible
 * avec un processus mort. La readiness garde son propre contrôle bloquant.
 */
export function evaluerSante(composants: Composant[], strict = false): EvaluationSante {
  const critiquesEnPanne = composants.filter(
    (c) => composantCritique(c.nom) && c.etat === "indisponible",
  );
  const degrades = composants.filter(
    (c) =>
      c.etat === "degrade" ||
      c.etat === "non_configure" ||
      (!composantCritique(c.nom) && c.etat === "indisponible"),
  );
  const indisponible = critiquesEnPanne.length > 0;
  const degrade = !indisponible && degrades.length > 0;
  const statut: EvaluationSante["statut"] = indisponible
    ? "unavailable"
    : degrade
      ? "degraded"
      : "healthy";

  return {
    critiquesEnPanne,
    degrades,
    indisponible,
    degrade,
    statut,
    codeHttp: indisponible || (strict && degrade) ? 503 : 200,
  };
}
