import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/session";
import { jetonConfigure, jetonValide } from "./acces";

/**
 * Protecteur des routes de supervision.
 *
 * ⚠️ P1-06 — pourquoi ne pas réutiliser `guard()`.
 *   `guard()` exige une session, et c'est exactement ce qu'il doit faire pour
 *   les routes métier. Mais un supervisionnaire (Prometheus, un cron, une
 *   sonde) ne sait pas ouvrir de session interactive : il présente un jeton.
 *   Le placer derrière `guard()` renverrait 401 avant même de regarder le
 *   jeton, ce qui obligerait à publier la route — et une route de métriques
 *   publique est une carte du service offerte au premier venu.
 *
 *   L'ordre est donc : jeton d'abord, session ensuite, refus sinon. Et le
 *   refus est le défaut : sans jeton configuré, la session reste exigée.
 */
export function routeSupervision(
  handler: (request: NextRequest) => Promise<Response>,
): (request: NextRequest) => Promise<Response> {
  return async (request: NextRequest): Promise<Response> => {
    if (jetonValide(request)) return handler(request);

    try {
      await requireAuth();
      return handler(request);
    } catch {
      return NextResponse.json(
        {
          detail: jetonConfigure()
            ? "Jeton de supervision invalide, et aucune session valide."
            : "Accès refusé : aucune session valide (GF_METRICS_TOKEN n'est pas configuré).",
          // ⚠️ Diagnostic volontairement exposé : un refus sans explication
          //   coûte des heures à l'exploitant, et ce qu'il révèle — si un
          //   jeton est configuré et sous quelle forme il est attendu — n'est
          //   pas un secret.
          jetonConfigure: jetonConfigure(),
          enteteAttendu: "Authorization: Bearer <GF_METRICS_TOKEN>",
        },
        { status: 401 },
      );
    }
  };
}
