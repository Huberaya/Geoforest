/**
 * Jetons d'accès JWT — signés HS256 avec `jose`.
 *
 * ⚠️ Ce module doit rester compatible Edge Runtime : il est importé par le
 * middleware. Il ne doit donc **jamais** importer la base de données, `node:crypto`
 * ni `node:pg`.
 */
import { SignJWT, jwtVerify } from "jose";
import { authSecret } from "./env";

export const ACCESS_COOKIE = "gft_access";
export const REFRESH_COOKIE = "gft_refresh";
export const MFA_COOKIE = "gft_mfa";

export interface AccessClaims {
  /** Identifiant de l'utilisateur. */
  sub: string;
  /** Organisation active — alimentera le cloisonnement (P0-02). */
  org: string | null;
  email: string;
  name: string;
  role: string;
  /** Version du jeton : incrémentée pour révoquer toutes les sessions d'un utilisateur. */
  ver: number;
  /** Vrai si l'authentification forte a été validée pour cette session. */
  mfa: boolean;
  /** Expiration (secondes epoch) — renvoyée par la vérification. */
  exp?: number;
}

function key(): Uint8Array {
  return new TextEncoder().encode(authSecret());
}

export async function signAccessToken(claims: AccessClaims, ttlSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ org: claims.org, email: claims.email, name: claims.name, role: claims.role, ver: claims.ver, mfa: claims.mfa })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + ttlSeconds)
    .setIssuer("geoforest-trace")
    .setAudience("geoforest-trace-app")
    .sign(key());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      issuer: "geoforest-trace",
      audience: "geoforest-trace-app",
      algorithms: ["HS256"],
    });

    if (typeof payload.sub !== "string") return null;

    return {
      sub: payload.sub,
      org: typeof payload.org === "string" ? payload.org : null,
      email: typeof payload.email === "string" ? payload.email : "",
      name: typeof payload.name === "string" ? payload.name : "",
      role: typeof payload.role === "string" ? payload.role : "viewer",
      ver: typeof payload.ver === "number" ? payload.ver : 0,
      mfa: payload.mfa === true,
      exp: typeof payload.exp === "number" ? payload.exp : undefined,
    };
  } catch {
    return null;
  }
}

export interface MfaTicketClaims {
  /** Identifiant de l'utilisateur. */
  sub: string;
  /** Secret TOTP en attente d'activation (présent uniquement pendant l'enregistrement). */
  pendingSecret?: string;
}

/** Jeton court attestant qu'un mot de passe valide a été saisi, en attente de MFA. */
export async function signMfaTicket(
  userId: string,
  ttlSeconds = 300,
  extra: { pendingSecret?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ typ: "mfa", pendingSecret: extra.pendingSecret })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .setIssuer("geoforest-trace")
    .setAudience("geoforest-trace-mfa")
    .sign(key());
}

export async function verifyMfaTicket(token: string): Promise<MfaTicketClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      issuer: "geoforest-trace",
      audience: "geoforest-trace-mfa",
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string") return null;
    return {
      sub: payload.sub,
      pendingSecret: typeof payload.pendingSecret === "string" ? payload.pendingSecret : undefined,
    };
  } catch {
    return null;
  }
}
