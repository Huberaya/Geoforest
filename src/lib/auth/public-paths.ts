/**
 * Chemins d'authentification réellement publics.
 *
 * ⚠️ Une liste **exacte**, et non un préfixe `/api/v1/auth/`.
 *
 *   Le préfixe était commode et faux : il déclarait publiques toutes les routes
 *   ajoutées sous `/api/v1/auth/`, y compris `me` et `password`, qui ne le sont
 *   pas. Chacune se défendait heureusement elle-même (`guard()` ou
 *   `getSession()`), mais la sûreté reposait alors sur chaque route plutôt que
 *   sur le proxy. Une route ajoutée demain sans garde serait passée sans
 *   qu'aucun test ne le signale.
 *
 *   Seules les quatre étapes qui précèdent l'existence d'une session sont
 *   publiques : se connecter, valider le second facteur, renouveler un jeton
 *   (qui porte sa propre preuve), et se déconnecter (idempotent, sans effet si
 *   le jeton est absent).
 *
 * Module sans dépendance : il est importé par `proxy.ts` (runtime Node) et par
 * les tests.
 */
export const CHEMINS_AUTH_PUBLICS: ReadonlySet<string> = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/mfa",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
]);

export function estCheminAuthPublic(pathname: string): boolean {
  return CHEMINS_AUTH_PUBLICS.has(pathname);
}
