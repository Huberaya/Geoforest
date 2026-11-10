import { lireCorpsJson } from "@/lib/api/body";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { dbAdmin as db } from "@/db/admin";
import { users } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-log";
import { clesCadence, consommerFenetre } from "@/lib/auth/cadence-partagee";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "@/lib/auth/password";
import { apiError, jsonResponse } from "@/lib/auth/respond";
import { guard } from "@/lib/auth/guard";
import { clientIp, issueSession, revokeAllSessions, sessionCookieHeaders } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Changement de mot de passe : 10 par quart d'heure et par compte. */
const CHANGEMENT_MOT_DE_PASSE_MAX = 10;
const CHANGEMENT_MOT_DE_PASSE_FENETRE_SECONDES = 15 * 60;

interface PasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

/**
 * Changement de mot de passe. Révoque toutes les autres sessions de
 * l'utilisateur (incrément de `token_version`) et réémet la session courante.
 */
export const POST = guard()(async (request: NextRequest, _ctx, { session, tx }) => {
  // ⚠️ La vérification du mot de passe actuel est une comparaison de secret :
  //   elle se limite en **partagé**, par utilisateur. Sans cela, une instance
  //   supplémentaire multipliait le nombre d'essais disponibles, et un
  //   redémarrage remettait le compteur à zéro.
  // ⚠️ Le compteur est écrit dans la transaction du guard, donc sur la
  //   connexion applicative : ouvrir une seconde connexion depuis la
  //   transaction en cours suffirait à immobiliser un serveur qui ne sert
  //   qu'une connexion à la fois (banc d'essai), et n'apporte rien en
  //   production. `gf_login_attempts` est accessible au rôle applicatif.
  const fenetre = await consommerFenetre(tx, {
    cle: clesCadence.motDePasse(session.user.id),
    max: CHANGEMENT_MOT_DE_PASSE_MAX,
    fenetreSecondes: CHANGEMENT_MOT_DE_PASSE_FENETRE_SECONDES,
  });
  if (!fenetre.autorise) {
    const refus = apiError(
      "rate_limited",
      "Trop de changements de mot de passe. Réessayez plus tard.",
      429,
    );
    refus.headers.set("Retry-After", String(fenetre.reessayerDans));
    return refus;
  }

  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as PasswordBody;

  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!current || !next) {
    return apiError("invalid_body", "Mot de passe actuel et nouveau mot de passe requis.", 400);
  }

  const rows = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  const user = rows[0];
  if (!user?.passwordHash) {
    return apiError("no_password_set", "Ce compte n'a pas de mot de passe défini.", 409);
  }

  const ok = await verifyPassword(current, user.passwordHash);
  if (!ok) {
    return apiError("invalid_credentials", "Mot de passe actuel incorrect.", 401);
  }

  const policy = checkPasswordPolicy(next, user.email);
  if (!policy.ok) {
    return apiError(
      "weak_password",
      `Mot de passe non conforme : ${policy.reasons.join(", ")}.`,
      422,
      { reasons: policy.reasons },
    );
  }

  if (await verifyPassword(next, user.passwordHash)) {
    return apiError("same_password", "Le nouveau mot de passe doit être différent.", 422);
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next), passwordUpdatedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  // Révoque les sessions existantes, puis réémet celle-ci.
  await revokeAllSessions(user.id);
  // `tokenVersion` est incrémenté par revokeAllSessions : on le répercute ici.
  const issued = await issueSession(
    { ...user, tokenVersion: user.tokenVersion + 1 },
    { remember: false, userAgent: request.headers.get("user-agent"), ip: clientIp(request.headers) },
  );

  await logAuditEvent({
    organizationId: user.organizationId,
    userEmail: user.email,
    action: "PASSWORD_CHANGED",
    entityType: "USER",
    entityId: user.id,
    details: { ip: clientIp(request.headers) },
  });

  return jsonResponse({ status: "password_changed" }, 200, sessionCookieHeaders(issued, false));
});
