import { routeSupervision } from "@/lib/observability/route-supervision";
import {
  disponibiliteSecondes,
  expositionPrometheus,
  lireCompteurs,
  lireJauges,
  resumeRoutes,
} from "@/lib/observability/metriques";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Mesures du service.
 *
 * ⚠️ P1-06 — deux avertissements, inscrits dans la réponse elle-même pour que
 *   quiconque les consulte les lise :
 *
 *   1. **Portée processus.** Les compteurs sont ceux de cette instance. Derrière
 *      un équilibreur de charge, il faut agréger ; le format d'exposition est
 *      celui de Prometheus précisément pour que cet agrégateur se branche sans
 *      réécriture.
 *   2. **Quantiles estimés.** Les p95 viennent d'un échantillon borné des
 *      dernières requêtes, pas de l'historique complet. Suffisant pour détecter
 *      une dégradation, insuffisant pour produire un engagement de service.
 */
export const GET = routeSupervision(async (request: NextRequest) => {
  const accepte = request.headers.get("accept") ?? "";
  if (accepte.includes("openmetrics") || accepte.includes("text/plain") || accepte.includes("prometheus")) {
    return new NextResponse(expositionPrometheus(), {
      status: 200,
      headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
    });
  }

  return NextResponse.json({
    // ⚠️ `portee` et `precision` figurent dans la réponse : une mesure sans sa
    // portée est une mesure qui sera lue de travers.
    portee: "processus",
    precision: "quantiles estimés sur échantillon borné",
    uptime_seconds: disponibiliteSecondes(),
    routes: resumeRoutes(),
    jauges: lireJauges(),
    compteurs: lireCompteurs(),
  });
});
