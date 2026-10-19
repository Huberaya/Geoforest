import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { CHEMINS_AUTH_PUBLICS } from "../../src/lib/auth/public-paths";

/**
 * Inventaire **structurel** des routes API : aucune ne doit être servie sans
 * contrôle d'accès.
 *
 * ⚠️ Pourquoi ce test existe, en plus des tests HTTP.
 *
 *   Les tests HTTP exercent une trentaine de scénarios ; ils ne disent rien
 *   d'une route ajoutée demain. Ce test parcourt le système de fichiers et
 *   exige que **chaque** `route.ts` soit, soit explicitement public, soit
 *   protégé par un contrôle visible dans le fichier. Une nouvelle route sans
 *   garde fait échouer la suite immédiatement, avant même d'avoir été appelée.
 *
 *   C'est exactement le défaut corrigé en V1 : le proxy déclarait publiques
 *   toutes les routes sous `/api/v1/auth/`. Une liste exacte et ce test
 *   rendent la récidive improbable.
 */
const RACINE = fileURLToPath(new URL("../../", import.meta.url));
const DOSSIER_API = join(RACINE, "src", "app", "api");

/**
 * Routes sans session utilisateur, et pourquoi. Toute autre route doit porter
 * un contrôle : `guard()` (autorisation + tenant) ou `getSession()` (profil).
 */
const PUBLIQUES: Record<string, string> = {
  "/api/health": "sonde de santé : aucune donnée métier",
  "/api/ready": "sonde de disponibilité : aucun détail interne",
  "/api/metrics": "jeton de supervision dédié, vérifié en temps constant",
  "/api/observability/alertes": "jeton de supervision dédié, vérifié en temps constant",
  "/api/v1/auth/login": "première étape : aucun session encore",
  "/api/v1/auth/mfa": "second facteur : jeton d'enrôlement porteur de sa preuve",
  "/api/v1/auth/refresh": "renouvellement : le jeton de rafraîchissement est sa preuve",
  "/api/v1/auth/logout": "déconnexion idempotente, sans effet si le jeton est absent",
};

function cheminsDeRoutes(dossier: string): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...cheminsDeRoutes(chemin));
    else if (entree === "route.ts") trouves.push(chemin);
  }
  return trouves;
}

/** `/api/v1/documents/[id]/download/route.ts` → `/api/v1/documents/[id]/download` */
function cheminHttp(fichier: string): string {
  const relatif = relative(DOSSIER_API, fichier).split("\\").join("/");
  return `/api/${relatif.replace(/\/route\.ts$/, "").replace(/route\.ts$/, "")}`;
}

const ROUTES = cheminsDeRoutes(DOSSIER_API).map((fichier) => ({
  fichier,
  chemin: cheminHttp(fichier),
  source: readFileSync(fichier, "utf8"),
}));

test("toutes les routes API sont inventoriées", () => {
  // Garde-fou : une exploration qui ne trouve rien ferait passer le test
  // suivant pour de mauvaises raisons.
  assert.ok(ROUTES.length >= 35, `seulement ${ROUTES.length} routes trouvées`);
});

test("chaque route est publique de façon déclarée, ou protégée par une garde", () => {
  const nonProtegees: string[] = [];
  for (const route of ROUTES) {
    if (PUBLIQUES[route.chemin]) continue;
    const gardee =
      /\bguard\s*[<(]/.test(route.source) || /\bgetSession\s*\(/.test(route.source);
    if (!gardee) nonProtegees.push(route.chemin);
  }
  assert.deepEqual(
    nonProtegees,
    [],
    `routes sans contrôle d'accès visible : ${nonProtegees.join(", ")}`,
  );
});

test("la liste publique du test correspond exactement à celle du proxy", () => {
  for (const chemin of Object.keys(PUBLIQUES)) {
    if (!chemin.startsWith("/api/v1/auth/")) continue;
    assert.ok(
      CHEMINS_AUTH_PUBLICS.has(chemin),
      `${chemin} est déclaré public par ce test mais pas par public-paths.ts`,
    );
  }
  // L'inverse : une route d'authentification déclarée publique par le proxy
  // doit être connue ici, sinon elle échapperait à l'inventaire.
  for (const chemin of CHEMINS_AUTH_PUBLICS) {
    assert.ok(chemin in PUBLIQUES, `${chemin} est public pour le proxy mais absent de ce test`);
  }
});

test("les routes publiques ne lisent aucune donnée métier sans contrôle", () => {
  // ⚠️ `/auth/login` lit `gf_users` : c'est l'authentification elle-même, et
  //   c'est le seul accès qu'une route publique peut justifier. Les tables
  //   métier, elles, ne doivent apparaître dans aucune route publique.
  const donneesMetier =
    /\bfrom\(\s*(documents|documentVersions|suppliers|plots|shipments|products|dueDiligenceStatements|complianceTasks|parcelAudits|auditLogs)\s*\)/;
  for (const route of ROUTES) {
    if (!PUBLIQUES[route.chemin]) continue;
    assert.ok(
      !donneesMetier.test(route.source),
      `${route.chemin} est public mais interroge une table métier`,
    );
  }
});

test("les routes sensibles vérifient la permission avant de lire le corps", () => {
  // `guard(permission)` exige la permission avant toute lecture de corps : on
  // le vérifie sur les écritures, là où le corps compte.
  const ecritures = ROUTES.filter((r) => /export const (POST|PUT|PATCH|DELETE)\b/.test(r.source));
  assert.ok(ecritures.length >= 10, `seulement ${ecritures.length} routes d'écriture`);
  const sansGarde = ecritures
    .filter((r) => !PUBLIQUES[r.chemin] && !/\bguard\s*[<(]/.test(r.source))
    .map((r) => r.chemin);
  assert.deepEqual(sansGarde, []);
});
