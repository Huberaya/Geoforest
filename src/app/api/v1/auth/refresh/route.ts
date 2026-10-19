import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { dbAdmin } from "@/db/admin";
import { logAuditEvent } from "@/lib/audit-log";
import { clesCadence, consommerFenetre } from "@/lib/auth/cadence-partagee";
import { REFRESH_COOKIE } from "@/lib/auth/constants";
import { apiError, jsonResponse } from "@/lib/auth/respond";
import { clientIp, clearSessionCookieHeaders, rotateRefreshToken, sessionCookieHeaders } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Renouvellement : 60 par minute et par adresse.
 *
 * Une session se renouvelle toutes les quinze minutes ; un onglet qui se
 * réveille après une mise en veille en déclenche un ou deux. Soixante est donc
 * très au-dessus de l'usage réel, et très en dessous de ce qu'exige un essai
 * exhaustif de jetons — lesquels font par ailleurs 256 bits.
 */
const RENOUVELLEMENT_MAX = 60;
const RENOUVELLEMENT_FENETRE_SECONDES = 60;

/**
 * Rotation du jeton de rafraîchissement.
 * Un jeton déjà consommé révoque toute la famille de sessions (détection de vol).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // ⚠️ Limite **partagée** : le compteur est en base, toutes instances
  //   confondues. Le limiteur du proxy est en mémoire, donc propre à chaque
  //   processus ; il ne borne pas une campagne répartie sur plusieurs instances.
  const ip = clientIp(request.headers);
  const fenetre = await consommerFenetre(dbAdmin, {
    cle: clesCadence.renouvellement(ip),
    max: RENOUVELLEMENT_MAX,
    fenetreSecondes: RENOUVELLEMENT_FENETRE_SECONDES,
  });
  if (!fenetre.autorise) {
    const refus = apiError(
      "rate_limited",
      "Trop de renouvellements de session. Réessayez plus tard.",
      429,
    );
    refus.headers.set("Retry-After", String(fenetre.reessayerDans));
    return refus;
  }

  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return apiError("missing_refresh_token", "Aucune session à renouveler.", 401);
  }

  const rotated = await rotateRefreshToken(refreshToken, {
    userAgent: request.headers.get("user-agent"),
    ip: clientIp(request.headers),
  });

  if (!rotated) {
    await logAuditEvent({
      userEmail: "inconnu",
      action: "REFRESH_REJECTED",
      entityType: "SESSION",
      entityId: "inconnu",
      details: { ip: clientIp(request.headers) },
    });
    return jsonResponse({ error: { code: "invalid_refresh_token", message: "Session expirée." } }, 401, clearSessionCookieHeaders());
  }

  return jsonResponse(
    {
      status: "refreshed",
      user: {
        id: rotated.user.id,
        email: rotated.user.email,
        name: rotated.user.name,
        role: rotated.user.role,
        organizationId: rotated.user.organizationId,
      },
      expiresAt: rotated.issued.expiresAt.toISOString(),
    },
    200,
    sessionCookieHeaders(rotated.issued, rotated.remember),
  );
}
