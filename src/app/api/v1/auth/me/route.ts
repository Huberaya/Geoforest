import { NextResponse } from "next/server";

import { MFA_REQUIRED_ROLES, permissionsFor } from "@/lib/auth/roles";
import { apiError, jsonResponse } from "@/lib/auth/respond";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Profil de l'utilisateur courant — sert aussi de sonde de session côté client. */
export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return apiError("unauthenticated", "Authentification requise.", 401);
  }

  return jsonResponse({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      organizationId: session.user.organizationId,
      organizationName: session.user.organizationName,
      mfaSatisfied: session.claims.mfa,
      mfaRequired: MFA_REQUIRED_ROLES.includes(session.user.role as never),
      permissions: permissionsFor(session.user.role),
    },
    expiresAt: session.claims.exp ? new Date(session.claims.exp * 1000).toISOString() : null,
  });
}
