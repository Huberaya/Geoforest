import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { dbAdmin as db } from "@/db/admin";
import { loginAttempts, organizations, sessions, users } from "@/db/schema";
import type { Permission } from "./roles";
import { can, mfaRequiredFor } from "./roles";
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  LOCKOUT_MINUTES,
  LOGIN_WINDOW_MAX_ATTEMPTS,
  LOGIN_WINDOW_MINUTES,
  MAX_FAILED_LOGINS,
  MFA_COOKIE,
  MFA_TICKET_TTL_SECONDS,
  REFRESH_COOKIE,
  REFRESH_TOKEN_TTL_DAYS,
  REMEMBER_ME_TTL_DAYS,
} from "./constants";
import { signAccessToken, signMfaTicket, verifyAccessToken, verifyMfaTicket } from "./tokens";
import type { AccessClaims, MfaTicketClaims } from "./tokens";

export type { MfaTicketClaims };

export type { AccessClaims };

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string | null;
  organizationName: string | null;
  mfa: boolean;
  tokenVersion: number;
}

export interface Session {
  user: AuthenticatedUser;
  claims: AccessClaims;
}

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* -------------------------------------------------------------------------- */
/* Lecture de session                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Lit la session courante. Vérifie la signature du jeton, l'existence de
 * l'utilisateur, son statut, un éventuel verrouillage et la version de jeton
 * (ce qui rend la révocation immédiate).
 *
 * ⚠️ Une requête en base par appel : volontaire, pour que la révocation soit
 * effective sans délai. Un cache mémoire pourra être ajouté si le volume
 * l'exige — jamais au détriment de la révocation.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      organizationId: users.organizationId,
      organizationName: organizations.name,
      tokenVersion: users.tokenVersion,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .leftJoin(organizations, eq(organizations.id, users.organizationId))
    .where(eq(users.id, claims.sub))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.status !== "active") return null;
  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) return null;
  if (row.tokenVersion !== claims.ver) return null;

  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      organizationId: row.organizationId,
      organizationName: row.organizationName ?? null,
      mfa: claims.mfa,
      tokenVersion: row.tokenVersion,
    },
    claims,
  };
}

/** Exige une session valide. À utiliser dans chaque route protégée. */
export async function requireAuth(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw new AuthError(401, "unauthenticated", "Authentification requise.");
  }
  return session;
}

/**
 * Exige une session valide **et** une permission. Les rôles soumis à la MFA
 * (admin, responsable conformité) doivent en plus présenter une session
 * validée par le second facteur.
 */
export async function requirePermission(permission: Permission): Promise<Session> {
  const session = await requireAuth();

  if (mfaRequiredFor(session.user.role) && !session.claims.mfa) {
    throw new AuthError(403, "mfa_required", "Double authentification requise pour cette action.");
  }

  if (!can(session.user.role, permission)) {
    throw new AuthError(403, "forbidden", "Permissions insuffisantes pour cette action.");
  }

  return session;
}

/* -------------------------------------------------------------------------- */
/* Émission de session                                                         */
/* -------------------------------------------------------------------------- */

export interface IssueSessionOptions {
  remember?: boolean;
  userAgent?: string | null;
  ip?: string | null;
  /** Famille de sessions à conserver lors d'une rotation. */
  familyId?: string;
  /**
   * Second facteur validé. Par défaut : vrai pour les rôles non soumis à la
   * MFA ; doit être passé explicitement à `true` après validation du code TOTP.
   */
  mfaSatisfied?: boolean;
}

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  refreshExpiresAt: Date;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueSession(
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    organizationId: string | null;
    tokenVersion: number;
  },
  options: IssueSessionOptions = {},
): Promise<IssuedSession> {
  const sessionId = randomUUID();
  const familyId = options.familyId ?? randomUUID();
  const refreshToken = randomUUID() + randomUUID();
  const ttlDays = options.remember ? REMEMBER_ME_TTL_DAYS : REFRESH_TOKEN_TTL_DAYS;
  const refreshExpiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);

  const accessToken = await signAccessToken(
    {
      sub: user.id,
      org: user.organizationId,
      email: user.email,
      name: user.name,
      role: user.role,
      ver: user.tokenVersion,
      mfa: options.mfaSatisfied ?? !mfaRequiredFor(user.role),
    },
    ACCESS_TOKEN_TTL_SECONDS,
  );

  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    refreshTokenHash: hashToken(refreshToken),
    familyId,
    expiresAt: refreshExpiresAt,
    userAgent: options.userAgent ?? null,
    ip: options.ip ?? null,
  });

  return { sessionId, accessToken, refreshToken, expiresAt, refreshExpiresAt };
}

function cookieAttrs(): string {
  return process.env.NODE_ENV === "production" ? "HttpOnly; SameSite=Lax; Secure" : "HttpOnly; SameSite=Lax";
}

export function sessionCookieHeaders(issued: IssuedSession, remember = false): string[] {
  const attrs = cookieAttrs();
  return [
    `${ACCESS_COOKIE}=${issued.accessToken}; Max-Age=${ACCESS_TOKEN_TTL_SECONDS}; Path=/; ${attrs}`,
    `${REFRESH_COOKIE}=${issued.refreshToken}; Max-Age=${
      (remember ? REMEMBER_ME_TTL_DAYS : REFRESH_TOKEN_TTL_DAYS) * 86_400
    }; Path=/api/v1/auth; ${attrs}`,
  ];
}

export function clearSessionCookieHeaders(): string[] {
  const attrs = cookieAttrs();
  return [
    `${ACCESS_COOKIE}=; Max-Age=0; Path=/; ${attrs}`,
    `${REFRESH_COOKIE}=; Max-Age=0; Path=/api/v1/auth; ${attrs}`,
    `${MFA_COOKIE}=; Max-Age=0; Path=/; ${attrs}`,
  ];
}

export function mfaTicketCookieHeader(ticket: string): string {
  const attrs = cookieAttrs();
  return `${MFA_COOKIE}=${ticket}; Max-Age=${MFA_TICKET_TTL_SECONDS}; Path=/; ${attrs}`;
}

export async function readMfaTicket(): Promise<MfaTicketClaims | null> {
  const jar = await cookies();
  const ticket = jar.get(MFA_COOKIE)?.value;
  if (!ticket) return null;
  return verifyMfaTicket(ticket);
}

export { signMfaTicket };

/* -------------------------------------------------------------------------- */
/* Rafraîchissement et révocation                                              */
/* -------------------------------------------------------------------------- */

export interface RotateResult {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    organizationId: string | null;
    tokenVersion: number;
  };
  issued: IssuedSession;
  remember: boolean;
}

/**
 * Rotation du jeton de rafraîchissement. Toute réutilisation d'un jeton déjà
 * consommé (signe de vol) révoque **toute la famille** de sessions.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<RotateResult | null> {
  const hash = hashToken(refreshToken);

  const rows = await db.select().from(sessions).where(eq(sessions.refreshTokenHash, hash)).limit(1);
  const current = rows[0];
  if (!current) return null;

  if (current.revokedAt) {
    // Jeton déjà consommé ⇒ vol probable : on révoque toute la famille.
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.familyId, current.familyId), isNull(sessions.revokedAt)));
    return null;
  }
  if (current.expiresAt.getTime() < Date.now()) return null;

  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      organizationId: users.organizationId,
      status: users.status,
      tokenVersion: users.tokenVersion,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(eq(users.id, current.userId))
    .limit(1);

  const user = userRows[0];
  if (!user || user.status !== "active") return null;
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return null;

  const remember = current.expiresAt.getTime() - Date.now() > REFRESH_TOKEN_TTL_DAYS * 86_400_000;
  const issued = await issueSession(user, {
    remember,
    userAgent: meta.userAgent ?? current.userAgent,
    ip: meta.ip ?? current.ip,
    familyId: current.familyId,
  });

  await db
    .update(sessions)
    .set({ revokedAt: new Date(), replacedBy: issued.sessionId, lastUsedAt: new Date() })
    .where(eq(sessions.id, current.id));

  return { user, issued, remember };
}

export async function revokeSessionByToken(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.refreshTokenHash, hashToken(refreshToken)));
}

/** Révocation globale : incrémente `token_version` et clôt toutes les sessions. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/* -------------------------------------------------------------------------- */
/* Verrouillage et limitation de débit                                         */
/* -------------------------------------------------------------------------- */

export function windowKeyFor(ip: string | null, email: string): string {
  return `${ip ?? "unknown"}|${email.trim().toLowerCase()}`;
}

/** Fenêtre glissante persistante : au-delà du plafond, on refuse sans toucher au compte. */
export async function registerLoginFailure(
  windowKey: string,
): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
  const now = new Date();
  const windowStart = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000);

  const rows = await db
    .select()
    .from(loginAttempts)
    .where(and(eq(loginAttempts.windowKey, windowKey), gt(loginAttempts.lastAttemptAt, windowStart)))
    .limit(1);

  const existing = rows[0];

  if (!existing) {
    await db
      .insert(loginAttempts)
      .values({ windowKey, attempts: 1, firstAttemptAt: now, lastAttemptAt: now });
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const attempts = existing.attempts + 1;
  await db
    .update(loginAttempts)
    .set({ attempts, lastAttemptAt: now })
    .where(eq(loginAttempts.id, existing.id));

  if (attempts < LOGIN_WINDOW_MAX_ATTEMPTS) return { blocked: false, retryAfterSeconds: 0 };

  const retryAt = existing.firstAttemptAt.getTime() + LOGIN_WINDOW_MINUTES * 60_000;
  return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)) };
}

/**
 * Remise à zéro du compteur d'échecs d'une fenêtre, après une réussite.
 *
 * ⚠️ P1-10b — cette fonction supprimait la ligne (`delete`). Or le rôle
 *   applicatif s'est vu retirer `DELETE` sur **toutes** les tables, sans
 *   exception : sous ce rôle, l'instruction était refusée et la **connexion
 *   échouait** — une panne qui n'apparaît qu'en production, puisque le
 *   développement local se connecte en superutilisateur.
 *
 * La remise à zéro passe donc par une mise à jour. La ligne subsiste, ce qui
 * est un renseignement de plus : la date de la dernière réussite. Le ménage
 * des fenêtres abandonnées — des échecs jamais suivis d'une réussite — relève
 * de `scripts/purge-retention.ts`, seul habilité à supprimer.
 */
export async function clearLoginFailures(windowKey: string): Promise<void> {
  const maintenant = new Date();
  await db
    .update(loginAttempts)
    .set({ attempts: 0, firstAttemptAt: maintenant, lastAttemptAt: maintenant })
    .where(eq(loginAttempts.windowKey, windowKey));
}

/** Verrouillage du compte après MAX_FAILED_LOGINS échecs consécutifs. */
export async function registerAccountFailure(userId: string): Promise<void> {
  const rows = await db
    .select({ failedLogins: users.failedLogins })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const failed = (rows[0]?.failedLogins ?? 0) + 1;
  const lock = failed >= MAX_FAILED_LOGINS;

  await db
    .update(users)
    .set({
      failedLogins: failed,
      lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function resetAccountFailures(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return headers.get("x-real-ip");
}
