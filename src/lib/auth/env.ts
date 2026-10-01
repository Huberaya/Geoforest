/**
 * Configuration d'authentification — fail-closed.
 *
 * Aucune valeur par défaut : si AUTH_SECRET est absent, l'application refuse de
 * démarrer plutôt que de signer des jetons avec une clé prévisible.
 */

const DEV_PLACEHOLDER = "dev-only-insecure-secret-change-me";

function readSecret(): string {
  const secret = process.env.AUTH_SECRET;

  if (!secret || secret.trim().length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_SECRET est absent ou trop court (≥ 32 caractères requis). " +
          "Refus de démarrer l'application en production sans secret de signature.",
      );
    }
    return DEV_PLACEHOLDER;
  }

  if (secret === DEV_PLACEHOLDER && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET contient la valeur de développement. Refus de démarrer.");
  }

  return secret;
}

let cached: string | null = null;

export function authSecret(): string {
  cached ??= readSecret();
  return cached;
}

/** Vrai si l'application tourne avec le secret de développement (jamais en production). */
export function isDevSecret(): boolean {
  return authSecret() === DEV_PLACEHOLDER;
}

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_DAYS = 7;
export const REMEMBER_ME_TTL_DAYS = 30;

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_WINDOW_MAX_ATTEMPTS = 10; // par IP + email, avant même le verrouillage de compte
