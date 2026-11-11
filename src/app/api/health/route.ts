import { NextResponse } from "next/server";

import { verifierRoleApplication } from "@/db/controle-role";
import { sonderTout } from "@/lib/alerting/regles";
import { composantCritique, evaluerSante } from "@/lib/alerting/health";
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

  const evaluation = evaluerSante(composants, process.env.GF_HEALTH_STRICT === "1");
  const { critiquesEnPanne, degrades, indisponible, degrade, statut, codeHttp } = evaluation;

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
        critique: composantCritique(c.nom),
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
    { status: codeHttp, headers: codeHttp === 503 ? { "Retry-After": "10" } : undefined },
  );
}
