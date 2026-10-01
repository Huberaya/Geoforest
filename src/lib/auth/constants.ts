/**
 * Constantes d'authentification — sans dépendance (compatible Edge Runtime).
 */

export const ACCESS_COOKIE = "gft_access";
export const REFRESH_COOKIE = "gft_refresh";
export const MFA_COOKIE = "gft_mfa";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_DAYS = 7;
export const REMEMBER_ME_TTL_DAYS = 30;

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
export const LOGIN_WINDOW_MINUTES = 15;
/** Plafond par fenêtre (IP + email), appliqué avant même le verrouillage de compte. */
export const LOGIN_WINDOW_MAX_ATTEMPTS = 10;

export const MFA_TICKET_TTL_SECONDS = 5 * 60;
export const RECOVERY_CODES_COUNT = 8;
