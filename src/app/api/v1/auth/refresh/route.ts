import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { logAuditEvent } from "@/lib/audit-log";
import { REFRESH_COOKIE } from "@/lib/auth/constants";
import { apiError, jsonResponse } from "@/lib/auth/respond";
import { clientIp, clearSessionCookieHeaders, rotateRefreshToken, sessionCookieHeaders } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Rotation du jeton de rafraîchissement.
 * Un jeton déjà consommé révoque toute la famille de sessions (détection de vol).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
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
