/**
 * Configuration d'authentification — fail-closed.
 *
 * Aucune valeur par défaut : si AUTH_SECRET est absent, l'application refuse de
 * démarrer plutôt que de signer des jetons avec une clé prévisible.
 */

const DEV_PLACEHOLDER = "dev-only-insecure-secret-change-me";

export function readSecret(): string {
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

/**
 * ⚠️ Le cache n'est honoré que si la variable d'environnement n'a PAS changé.
 *
 *   Il était auparavant définitif (`cached ??= readSecret()`). Conséquence
 *   mesurée : après une rotation d'`AUTH_SECRET`, le processus continuait de
 *   signer et de vérifier avec l'ANCIENNE valeur jusqu'à son redémarrage.
 *   L'effet dépendait donc du cycle de vie du processus, et non de la rotation.
 *
 *   Le vrai risque n'est pas la rotation — on redémarre en la faisant — mais la
 *   rotation ratée : une valeur posée sur un seul environnement, une variable
 *   mal orthographiée, un déploiement partiel. Dans ces cas, un processus qui
 *   garde l'ancienne valeur ne le signale nulle part, et l'on croit la rotation
 *   faite.
 *
 *   Comparer la valeur d'environnement coûte une lecture de `process.env` par
 *   appel de vérification de jeton. C'est négligeable, et cela rend la rotation
 *   effective dès que la variable change.
 */
let cached: { secret: string; source: string | undefined } | null = null;

export function authSecret(): string {
  const courant = process.env.AUTH_SECRET;
  if (cached === null || cached.source !== courant) {
    cached = { secret: readSecret(), source: courant };
  }
  return cached.secret;
}

/** Réservé aux contrôles : vide le cache pour éprouver un changement de valeur. */
export function __resetPourTest(): void {
  cached = null;
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
