import { lireCorpsJson } from "@/lib/api/body";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { dbAdmin as db } from "@/db/admin";
import { users } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-log";
import { journal } from "@/lib/observability/journal";
import { RECOVERY_CODES_COUNT } from "@/lib/auth/constants";
import { generateRecoveryCode } from "@/lib/auth/password";
import { mfaRequiredFor } from "@/lib/auth/roles";
import { apiError, jsonResponse } from "@/lib/auth/respond";
import {
  clearLoginFailures,
  clientIp,
  issueSession,
  readMfaTicket,
  resetAccountFailures,
  sessionCookieHeaders,
  windowKeyFor,
} from "@/lib/auth/session";
import { MFA_COOKIE } from "@/lib/auth/constants";
import { verifyTotp } from "@/lib/auth/totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.toUpperCase()).digest("hex");
}

/**
 * Validation du second facteur (TOTP) — étape finale de la connexion.
 * Traite aussi la première activation (secret en attente) et les codes de secours.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as { code?: unknown; remember?: unknown };

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const remember = body.remember === true;
  if (!code) return apiError("invalid_body", "Code requis.", 400);

  const ticket = await readMfaTicket();
  if (!ticket) {
    return apiError(
      "mfa_ticket_expired",
      "Session d'authentification expirée. Reconnectez-vous.",
      401,
    );
  }

  const rows = await db.select().from(users).where(eq(users.id, ticket.sub)).limit(1);
  const user = rows[0];
  if (!user || user.status !== "active") {
    return apiError("invalid_credentials", "Session invalide.", 401);
  }

  const ip = clientIp(request.headers);
  const userAgent = request.headers.get("user-agent");
  const secret = ticket.pendingSecret ?? user.mfaSecret;

  let valid = false;
  let usedRecoveryCode = false;
  let remainingHashes: string[] = user.mfaRecoveryCodes ?? [];

  if (secret) {
    valid = verifyTotp(secret, code) !== null;
  }

  // Codes de secours : 10 caractères hexadécimaux, à usage unique.
  if (!valid && /^[0-9A-F]{10}$/.test(code.toUpperCase())) {
    const hash = hashRecoveryCode(code);
    const index = remainingHashes.indexOf(hash);
    if (index >= 0) {
      valid = true;
      usedRecoveryCode = true;
      remainingHashes = remainingHashes.filter((_, i) => i !== index);
    }
  }

  if (!valid) {
    // ⚠️ P1-06 — un code TOTP refusé est l'événement de sécurité le plus
    //   révélateur : le mot de passe était bon, le second facteur ne l'était
    //   pas. Le journaliser permet de repérer une tentative avant qu'elle ne
    //   réussisse. Le code lui-même n'est jamais consigné.
    journal.warn("auth.mfa_echec", {
      email: user.email,
      ip,
      raison: "code_invalide",
    });
    await logAuditEvent({
      organizationId: user.organizationId,
      userEmail: user.email,
      action: "MFA_FAILURE",
      entityType: "USER",
      entityId: user.id,
      details: { ip },
    });
    return apiError("invalid_mfa_code", "Code invalide ou expiré.", 401);
  }

  // Première activation : persistance du secret et génération des codes de secours.
  const isEnrolment = Boolean(ticket.pendingSecret) && !user.mfaSecret;
  let plainRecoveryCodes: string[] | null = null;

  if (isEnrolment) {
    plainRecoveryCodes = Array.from({ length: RECOVERY_CODES_COUNT }, () => generateRecoveryCode());
    remainingHashes = plainRecoveryCodes.map(hashRecoveryCode);

    await db
      .update(users)
      .set({
        mfaSecret: ticket.pendingSecret,
        mfaEnabledAt: new Date(),
        mfaRecoveryCodes: remainingHashes,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await logAuditEvent({
      organizationId: user.organizationId,
      userEmail: user.email,
      action: "MFA_ENABLED",
      entityType: "USER",
      entityId: user.id,
      details: { ip },
    });
  } else if (usedRecoveryCode) {
    await db
      .update(users)
      .set({ mfaRecoveryCodes: remainingHashes, updatedAt: new Date() })
      .where(eq(users.id, user.id));
  }

  const issued = await issueSession(user, { remember, userAgent, ip, mfaSatisfied: true });
  await resetAccountFailures(user.id);
  await clearLoginFailures(windowKeyFor(ip, user.email));

  journal.info("auth.connexion_reussie", {
    email: user.email,
    ip,
    role: user.role,
    organisation: user.organizationId,
    mfa: true,
    enrollement: isEnrolment,
    codeDeSecours: usedRecoveryCode,
  });

  await logAuditEvent({
    organizationId: user.organizationId,
    userEmail: user.email,
    action: "LOGIN_SUCCESS",
    entityType: "USER",
    entityId: user.id,
    details: { ip, role: user.role, mfa: true, enrolment: isEnrolment, recoveryCode: usedRecoveryCode },
  });

  const response = jsonResponse(
    {
      status: "authenticated",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        mfaRequired: mfaRequiredFor(user.role),
      },
      /** Présents une seule fois, lors de l'activation de la MFA. */
      recoveryCodes: plainRecoveryCodes,
      remainingRecoveryCodes: remainingHashes.length,
    },
    200,
    sessionCookieHeaders(issued, remember),
  );

  const secure = process.env.NODE_ENV === "production";
  response.headers.append(
    "Set-Cookie",
    `${MFA_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  );

  return response;
}
