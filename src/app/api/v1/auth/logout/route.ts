import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { logAuditEvent } from "@/lib/audit-log";
import { REFRESH_COOKIE } from "@/lib/auth/constants";
import { clearSessionCookieHeaders, getSession, revokeSessionByToken } from "@/lib/auth/session";
import { jsonResponse } from "@/lib/auth/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Déconnexion : révocation du jeton de rafraîchissement et purge des cookies. */
export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;

  const session = await getSession();
  if (session) {
    await logAuditEvent({
      organizationId: session.user.organizationId,
      userEmail: session.user.email,
      action: "LOGOUT",
      entityType: "USER",
      entityId: session.user.id,
    });
  }

  await revokeSessionByToken(refreshToken);
  return jsonResponse({ status: "logged_out" }, 200, clearSessionCookieHeaders());
}

export const GET = POST;
