import { lireCorpsJson } from "@/lib/api/body";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";

import { dbAdmin as db } from "@/db/admin";
import { users } from "@/db/schema";
import { logAuditEvent } from "@/lib/audit-log";
import { apiError, jsonResponse } from "@/lib/auth/respond";
import { mfaRequiredFor } from "@/lib/auth/roles";
import {
  clientIp,
  issueSession,
  clearLoginFailures,
  mfaTicketCookieHeader,
  registerAccountFailure,
  registerLoginFailure,
  resetAccountFailures,
  sessionCookieHeaders,
  windowKeyFor,
} from "@/lib/auth/session";
import { signMfaTicket } from "@/lib/auth/tokens";
import { journal } from "@/lib/observability/journal";
import { verifyPassword } from "@/lib/auth/password";
import { totpProvisioningUri, generateTotpSecret } from "@/lib/auth/totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hash factice utilisé pour égaliser le temps de réponse lorsque l'utilisateur
 * n'existe pas — évite l'énumération des comptes par chronométrie.
 */
const DUMMY_HASH =
  "scrypt:16384:8:1:weyJft7yZjRrnTvMc25jMw==:pIe3g/8zHs4p8inVDN+KAo0SGvfo9/kbcUVeO6rpf/oyDGgOdHWvYMeZvuelwbqAJx3+HRdSBaQcbiVpOi8A5Q==";

const GENERIC_FAILURE = "Identifiants invalides.";

interface LoginBody {
  email?: unknown;
  password?: unknown;
  remember?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as LoginBody;

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const remember = body.remember === true;
  const ip = clientIp(request.headers);
  const userAgent = request.headers.get("user-agent");
  const windowKey = windowKeyFor(ip, email);

  if (!email || !password) {
    return apiError("invalid_body", "Email et mot de passe requis.", 400);
  }

  // 1. Limitation de débit par fenêtre (IP + email).
  const window = await registerLoginFailure(windowKey);
  if (window.blocked) {
    // ⚠️ P1-06 — un blocage de cadence est un signal, pas un détail : c'est la
    //   trace qui permet de distinguer un utilisateur maladroit d'une attaque
    //   en cours. Sans elle, une campagne de force brute ne laisserait
    //   aucune empreinte exploitable.
    journal.warn("auth.cadence_depassee", {
      email,
      ip,
      reessayerDans: window.retryAfterSeconds,
    });
    const res = apiError(
      "rate_limited",
      "Trop de tentatives de connexion. Réessayez plus tard.",
      429,
    );
    res.headers.set("Retry-After", String(window.retryAfterSeconds));
    return res;
  }

  // 2. Recherche de l'utilisateur.
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const user = rows[0];

  // 3. Vérification du mot de passe (temps constant même si le compte est inconnu).
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !user.passwordHash || !passwordOk) {
    if (user) await registerAccountFailure(user.id);
    // ⚠️ Journal applicatif, en plus de la piste d'audit : la piste d'audit
    //   est dans la base, donc absente précisément quand la base est tombée.
    //   L'identifiant est consigné, jamais le mot de passe — la réduction du
    //   journal (`rediger`) masque par ailleurs toute clé y ressemblant.
    journal.warn("auth.connexion_echec", {
      email,
      ip,
      raison: !user ? "compte_inconnu" : "mot_de_passe_invalide",
      compteExistant: Boolean(user),
    });
    await logAuditEvent({
      organizationId: user?.organizationId ?? null,
      userEmail: email || "inconnu",
      action: "LOGIN_FAILURE",
      entityType: "USER",
      entityId: user?.id ?? "inconnu",
      details: { ip, reason: !user ? "unknown_user" : "bad_password" },
    });
    return apiError("invalid_credentials", GENERIC_FAILURE, 401);
  }

  // 4. Compte désactivé ou verrouillé.
  if (user.status !== "active") {
    journal.warn("auth.compte_inactif", { email, ip, statut: user.status });
    return apiError("account_inactive", "Ce compte n'est pas actif.", 403);
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    journal.warn("auth.compte_verrouille", { email, ip, delaiMinutes: minutes });
    return apiError(
      "account_locked",
      `Compte verrouillé après plusieurs échecs. Réessayez dans ${minutes} minute(s).`,
      423,
    );
  }

  await resetAccountFailures(user.id);
  await clearLoginFailures(windowKey);

  // 5. Double authentification.
  if (mfaRequiredFor(user.role)) {
    if (!user.mfaSecret) {
      // Première connexion : on propose l'enregistrement TOTP.
      const secret = generateTotpSecret();
      const otpauthUri = totpProvisioningUri(secret, user.email);
      const qrSvg = await QRCode.toString(otpauthUri, { type: "svg", margin: 1 });
      const ticket = await signMfaTicket(user.id, 600, { pendingSecret: secret });

      await logAuditEvent({
        organizationId: user.organizationId,
        userEmail: user.email,
        action: "MFA_SETUP_STARTED",
        entityType: "USER",
        entityId: user.id,
        details: { ip },
      });

      return jsonResponse(
        {
          status: "mfa_setup_required",
          user: { id: user.id, email: user.email, name: user.name, role: user.role },
          setup: { secret, otpauthUri, qrSvg },
        },
        200,
        [mfaTicketCookieHeader(ticket)],
      );
    }

    const ticket = await signMfaTicket(user.id, 300);
    return jsonResponse(
      {
        status: "mfa_required",
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      },
      200,
      [mfaTicketCookieHeader(ticket)],
    );
  }

  // 6. Connexion complète (rôles non soumis à la MFA).
  const issued = await issueSession(user, { remember, userAgent, ip });

  journal.info("auth.connexion_reussie", {
    email: user.email,
    ip,
    role: user.role,
    organisation: user.organizationId,
    mfa: false,
  });

  await logAuditEvent({
    organizationId: user.organizationId,
    userEmail: user.email,
    action: "LOGIN_SUCCESS",
    entityType: "USER",
    entityId: user.id,
    details: { ip, role: user.role, mfa: false },
  });

  return jsonResponse(
    {
      status: "authenticated",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        mfaRequired: false,
      },
    },
    200,
    sessionCookieHeaders(issued, remember),
  );
}
