import { NextResponse } from "next/server";

import { verifierRoleApplication } from "@/db/controle-role";
import { sonderTout, type EtatComposant } from "@/lib/alerting/regles";
import { journal } from "@/lib/observability/journal";
import { VERSION_APPLICATION } from "@/lib/version";
import { disponibiliteSecondes, noterJauges } from "@/lib/observability/metriques";

export const dynamic = "force-dynamic";

/**
 * Sonde de vivacité et diagnostic synthétique.
 *
 * La disponibilité du processus ne doit pas être confondue avec son aptitude
 * à recevoir du trafic :
 * - /api/health indique si le processus répond et expose l'état des composants.
 * - /api/ready vérifie les dépendances nécessaires aux écritures durables et
 *   renvoie 503 si la base, le schéma ou le stockage des pièces est indisponible.
 *
 * Le stockage défaillant est donc signalé comme dégradé ici (HTTP 200), mais
 * reste bloquant dans /api/ready (HTTP 503). Cela évite de redémarrer en boucle
 * une instance dont le seul problème est une dépendance externe à réparer.
 *
 * GF_HEALTH_STRICT=1 conserve le comportement opérationnel strict : tout état
 * dégradé provoque aussi un HTTP 503.
 */

/** Dépendances dont l'indisponibilité rend le processus non fonctionnel. */
const CRITIQUES = new Set(["base", "schema"]);

export async function GET() {
  const debut = Date.now();
  const composants = await sonderTout();

  // Le rôle applicatif reste contrôlé en continu : un rôle qui contourne la RLS
  // est un risque de sécurité, même si les requêtes SQL réussissent.
  const debutRole = Date.now();
  const role = await verifierRoleApplication().catch(() => null);
  if (role) {
    composants.push({
      nom: "role_base",
      etat: role.ok ? "ok" : "degrade",
      detail: role.ok
        ? `Rôle « ${role.role} » : RLS appliquée, aucun droit de destruction`
        : role.messages.join(" | "),
      mesure: {
        role: role.role,
        superutilisateur: role.superutilisateur,
        contourne_rls: role.contourneRls,
        tables_sans_cloisonnement: role.tablesSansCloisonnement.length,
        droits_destruction: role.droitsDestruction.length,
      },
      dureeMs: Date.now() - debutRole,
    });
  }

  const critiquesEnPanne = composants.filter(
    (c) => CRITIQUES.has(c.nom) && c.etat === "indisponible",
  );
  // Une dépendance non critique indisponible reste visible comme dégradation.
  // En particulier, le stockage bloque /api/ready, pas la vivacité /api/health.
  const degrades = composants.filter(
    (c) =>
      c.etat === "degrade" ||
      c.etat === "non_configure" ||
      (!CRITIQUES.has(c.nom) && c.etat === "indisponible"),
  );
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
  } else if (degrade) {
    journal.warn("sante.degradee", {
      composants: degrades.map((c) => `${c.nom}: ${c.detail}`),
    });
  }

  const strict = process.env.GF_HEALTH_STRICT === "1";
  const codeHttp = indisponible || (strict && degrade) ? 503 : 200;

  return NextResponse.json(
    {
      status: statut,
      uptime_seconds: disponibiliteSecondes(),
      version: VERSION_APPLICATION,
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
      alertes: [...critiquesEnPanne, ...degrades].map((c) => `${c.nom} : ${c.detail}`),
      notice: indisponible
        ? "Instance à retirer du pool : une dépendance critique est indisponible."
        : degrade
          ? "Instance vivante mais dégradée : consulter les alertes et /api/ready avant de lui confier du trafic."
          : null,
    },
    { status: codeHttp, headers: indisponible ? { "Retry-After": "10" } : undefined },
  );
}
