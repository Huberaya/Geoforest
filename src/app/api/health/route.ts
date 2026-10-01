import { NextResponse } from "next/server";

import { sonderTout, type EtatComposant } from "@/lib/alerting/regles";
import { journal } from "@/lib/observability/journal";
import { disponibiliteSecondes, noterJauges } from "@/lib/observability/metriques";

export const dynamic = "force-dynamic";

/**
 * Sonde de vivacité.
 *
 * P0-07 : une base injoignable n'est pas un état « dégradé » renvoyé en 200.
 * Le service est **indisponible** et le dit, afin qu'un supervisionnaire, un
 * équilibreur de charge ou un orchestrateur retire l'instance du pool au lieu
 * de continuer à lui confier des écritures qui ne seraient pas persistées.
 *
 * ⚠️ P1-06 — « dégradé » et « indisponible » ne se confondent pas, et les
 *   traiter de la même façon aggraverait la panne. Une instance dont la base
 *   est tombée ne peut plus rien servir : **503**, elle sort du pool. Une
 *   instance dont la sauvegarde a du retard rend encore un service correct :
 *   la sortir du pool transformerait un incident mineur en interruption. Elle
 *   répond donc **200 « degraded »** et c'est une **alerte** qui est émise —
 *   l'outil adapté.
 *
 *   `GF_HEALTH_STRICT=1` met « dégradé » à 503 également, pour les
 *   déploiements qui préfèrent retirer l'instance au moindre doute.
 */

/** Composants sans lesquels l'instance ne peut pas servir. */
const CRITIQUES = new Set(["base", "stockage"]);

export async function GET() {
  const debut = Date.now();
  const composants = await sonderTout();

  const critiquesEnPanne = composants.filter(
    (c) => CRITIQUES.has(c.nom) && c.etat === "indisponible",
  );
  const degrades = composants.filter((c) => c.etat === "degrade" || c.etat === "non_configure");
  const indisponible = critiquesEnPanne.length > 0;
  const degrade = !indisponible && degrades.length > 0;

  const statut: EtatComposant | "healthy" | "degraded" | "unavailable" = indisponible
    ? "unavailable"
    : degrade
      ? "degraded"
      : "healthy";

  noterJauges("sante", statut === "healthy" ? 1 : statut === "degraded" ? 0.5 : 0);
  if (indisponible) {
    journal.error("sante.indisponible", {
      composants: critiquesEnPanne.map((c) => `${c.nom}: ${c.detail}`),
    });
  }

  const strict = process.env.GF_HEALTH_STRICT === "1";
  const codeHttp = indisponible || (strict && degrade) ? 503 : 200;

  return NextResponse.json(
    {
      status: statut,
      // ⚠️ `uptime_seconds` est celui du **processus**, pas du service : après
      // un redéploiement il repart de zéro alors que le service n'a jamais
      // cessé d'être rendu par une autre instance. Le dire évite de prendre
      // une mesure locale pour une disponibilité globale.
      uptime_seconds: disponibiliteSecondes(),
      version: process.env.GF_VERSION ?? process.env.npm_package_version ?? "inconnue",
      environnement: process.env.NODE_ENV ?? "development",
      dureeMs: Date.now() - debut,
      composants: composants.map((c) => ({
        nom: c.nom,
        etat: c.etat,
        critique: CRITIQUES.has(c.nom),
        detail: c.detail,
        mesures: c.mesure,
        dureeMs: c.dureeMs,
      })),
      // Ce qui ne va pas, en clair, pour qui lit la sonde à la main.
      alertes: [...critiquesEnPanne, ...degrades].map((c) => `${c.nom} : ${c.detail}`),
      notice: indisponible
        ? "Instance à retirer du pool : un composant critique est indisponible."
        : degrade
          ? "Instance dégradée mais serviable : une alerte est émise, l'instance reste dans le pool."
          : null,
    },
    { status: codeHttp, headers: indisponible ? { "Retry-After": "10" } : undefined },
  );
}
