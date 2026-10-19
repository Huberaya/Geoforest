/**
 * Non-régression P2-14 — le build ne doit dépendre d'aucune base de données.
 *
 * Exécution :
 *     node --conditions=react-server --import tsx scripts/check-demarrage-sans-config.ts
 *
 * ⚠️ Ce que ce banc protège.
 *   `next build` évalue les modules de route pendant « Collecting page data »,
 *   dans un environnement sans `DATABASE_URL`, sans base et sans qu'aucune
 *   requête ne soit servie. Un pool construit au niveau du module y levait
 *   « DATABASE_URL_ADMIN est requis pour les opérations système », et le build
 *   échouait sur `/api/metrics` (importé par `route-supervision` →
 *   `auth/session` → `db/admin`).
 *
 *   Le correctif rend la connexion paresseuse. Ce banc vérifie les deux
 *   moitiés de la propriété, et il faut les deux :
 *     1. importer le module ne demande aucune configuration ;
 *     2. le premier usage refuse toujours de fonctionner sans elle.
 *   Si (2) cessait d'être vrai, le build passerait au vert et le produit
 *   tournerait avec un pool fantôme — exactement le contournement que la
 *   mission interdit.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const racine = process.cwd();
let echecs = 0;
let total = 0;

function verifier(intitule: string, condition: boolean, detail = ""): void {
  total += 1;
  if (condition) {
    console.log(`  ✅ ${intitule}${detail ? ` — ${detail}` : ""}`);
  } else {
    echecs += 1;
    console.error(`  🔴 ${intitule}${detail ? ` — ${detail}` : ""}`);
  }
}

// --------------------------------------------------------------------------
// A. Analyse statique : aucun pool construit au niveau du module.
// --------------------------------------------------------------------------
function voletStatique(): void {
  console.log("\n\x1b[1mA. Analyse statique de src/db/admin.ts\x1b[0m");

  const source = readFileSync(join(racine, "src/db/admin.ts"), "utf8");
  // On analyse le **code**, pas la documentation : le commentaire du correctif
  // cite justement la forme fautive, et la prendre pour du code rendrait ce
  // contrôle impossible à satisfaire.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  verifier(
    "la fabrique refuse toujours explicitement l'absence d'URL",
    /if \(!url\) \{\s*throw new Error\("DATABASE_URL_ADMIN est requis/.test(code),
    "aucune valeur de repli inventée",
  );

  // L'ancienne forme fautive : `export const adminPool = … ?? createAdminPool()`.
  const initialisationHative =
    /export\s+const\s+(adminPool|dbAdmin)\s*(:[^=]+)?=\s*[^;\n]*\b(createAdminPool|drizzle)\s*\(/.test(
      code,
    );
  verifier(
    "aucune initialisation de connexion à l'évaluation du module",
    !initialisationHative,
    initialisationHative ? "forme fautive détectée" : "accès paresseux",
  );

  verifier(
    "les deux exports restent disponibles pour les appelants",
    /export const adminPool/.test(source) && /export const dbAdmin/.test(source),
  );
}

// --------------------------------------------------------------------------
// B/C. Import sans configuration, puis premier usage.
// --------------------------------------------------------------------------
async function voletDynamique(): Promise<typeof import("../src/db/admin")> {
  console.log("\n\x1b[1mB. Import sans configuration\x1b[0m");

  // On efface réellement la configuration : le banc doit prouver que l'import
  // fonctionne dans les conditions du build, pas dans celles du poste de dev.
  delete process.env.DATABASE_URL_ADMIN;
  delete process.env.DATABASE_URL;

  const globalAdmin = globalThis as typeof globalThis & {
    __geoforestAdminPool?: unknown;
    __geoforestAdminDb?: unknown;
  };
  delete globalAdmin.__geoforestAdminPool;
  delete globalAdmin.__geoforestAdminDb;

  let moduleAdmin: typeof import("../src/db/admin") | null = null;
  let erreurImport: unknown = null;
  try {
    moduleAdmin = await import("../src/db/admin");
  } catch (erreur) {
    erreurImport = erreur;
  }

  verifier(
    "l'import de src/db/admin.ts ne lève pas sans DATABASE_URL",
    erreurImport === null,
    erreurImport instanceof Error ? erreurImport.message : "aucune exception",
  );

  verifier(
    "aucun pool n'est instancié par le seul import",
    globalAdmin.__geoforestAdminPool === undefined && globalAdmin.__geoforestAdminDb === undefined,
  );

  console.log("\n\x1b[1mC. Le premier usage reste fail-closed\x1b[0m");

  let messagePool = "";
  try {
    moduleAdmin?.adminPool.query("SELECT 1");
  } catch (erreur) {
    messagePool = erreur instanceof Error ? erreur.message : String(erreur);
  }
  verifier(
    "adminPool.query lève sans configuration",
    messagePool === "DATABASE_URL_ADMIN est requis pour les opérations système.",
    messagePool || "aucune exception ❌",
  );

  // ---------------------------------------------------------------- P3-01
  // La réflexion, elle aussi, doit rester fail-closed : enumerer un pool non
  // configuré doit LEVER, et non renvoyer un objet vide qui laisserait croire
  // que le pool n'a aucune propriété.
  console.log("\n\x1b[1mD. Réflexion sans configuration : elle lève, elle ne ment pas\x1b[0m");

  const MESSAGE = "DATABASE_URL_ADMIN est requis pour les opérations système.";
  const reflexionsSansConfig: Array<[string, () => unknown]> = [
    ["Object.keys(adminPool)", () => Object.keys(moduleAdmin!.adminPool)],
    ["Object.getOwnPropertyNames(adminPool)", () => Object.getOwnPropertyNames(moduleAdmin!.adminPool)],
    ["{ ...adminPool }", () => ({ ...moduleAdmin!.adminPool })],
    ["Object.getPrototypeOf(adminPool)", () => Object.getPrototypeOf(moduleAdmin!.adminPool)],
    ["Object.getOwnPropertyDescriptor(adminPool, 'query')", () =>
      Object.getOwnPropertyDescriptor(moduleAdmin!.adminPool, "query")],
  ];
  for (const [libelle, essai] of reflexionsSansConfig) {
    let message = "";
    try {
      essai();
    } catch (erreur) {
      message = erreur instanceof Error ? erreur.message : String(erreur);
    }
    verifier(
      `${libelle} lève sans configuration au lieu de renvoyer un objet vide`,
      message === MESSAGE,
      message || "aucune exception ❌",
    );
  }

  let messageDb = "";
  try {
    moduleAdmin?.dbAdmin.select();
  } catch (erreur) {
    messageDb = erreur instanceof Error ? erreur.message : String(erreur);
  }
  verifier(
    "dbAdmin.select lève sans configuration",
    messageDb === "DATABASE_URL_ADMIN est requis pour les opérations système.",
    messageDb || "aucune exception ❌",
  );

  return moduleAdmin as typeof import("../src/db/admin");
}

// --------------------------------------------------------------------------
// E. Le chemin configuré reste fonctionnel — sans ouvrir de connexion.
// --------------------------------------------------------------------------
async function voletConfigure(moduleAdmin: typeof import("../src/db/admin")): Promise<void> {
  console.log("\n\x1b[1mE. Chemin configuré\x1b[0m");

  // URL syntaxiquement valide, non routable : `pg` ne se connecte **pas** à la
  // construction du pool, seulement à la première requête. Ce contrôle ne
  // contacte donc aucun serveur et n'exige aucun secret réel.
  process.env.DATABASE_URL_ADMIN =
    "postgresql://utilisateur:motdepasse@127.0.0.1:1/base_inexistante";

  const globalAdmin = globalThis as typeof globalThis & {
    __geoforestAdminPool?: unknown;
    __geoforestAdminDb?: unknown;
  };
  delete globalAdmin.__geoforestAdminPool;
  delete globalAdmin.__geoforestAdminDb;

  let erreur: unknown = null;
  try {
    // L'accès à la propriété construit le pool (paresseux jusqu'ici).
    void moduleAdmin.adminPool.query;
  } catch (e) {
    erreur = e;
  }

  verifier(
    "une URL présente permet de construire le pool — aucune connexion ouverte",
    erreur === null && globalAdmin.__geoforestAdminPool !== undefined,
    erreur instanceof Error ? erreur.message : "pool construit sans réseau",
  );

  // ---------------------------------------------------------------- P3-01
  // Configuré, le proxy doit se comporter comme le Pool qu'il représente.
  const reel = globalAdmin.__geoforestAdminPool as object;
  const reflexions: Array<[string, () => boolean, string]> = [
    [
      "Object.keys(adminPool) n'est pas vide",
      () => Object.keys(moduleAdmin.adminPool).length > 0,
      "un proxy limité à `get` renverrait []",
    ],
    [
      "Object.getOwnPropertyNames(adminPool) égale celui du Pool réel",
      () =>
        JSON.stringify(Object.getOwnPropertyNames(moduleAdmin.adminPool).sort()) ===
        JSON.stringify(Object.getOwnPropertyNames(reel).sort()),
      "les propriétés propres du pool doivent être visibles telles quelles",
    ],
    [
      "l'étalement `{ ...adminPool }` conserve les propriétés",
      () => Object.keys({ ...moduleAdmin.adminPool }).length > 0,
      "un proxy limité à `get` renverrait {}",
    ],
    [
      "la trape `has` voit « query »",
      () => "query" in moduleAdmin.adminPool,
      "trap `has` manquante",
    ],
    [
      "la même méthode garde la même identité",
      () => moduleAdmin.adminPool.query === moduleAdmin.adminPool.query,
      "un `bind` recalculé casserait toute comparaison",
    ],
    [
      "le proxy se présente avec le prototype réel",
      () => Object.getPrototypeOf(moduleAdmin.adminPool) === Object.getPrototypeOf(reel),
      "prototype de Object au lieu de celui du Pool",
    ],
    [
      "le descripteur d'une propriété propre est exposé et configurable",
      () =>
        Object.getOwnPropertyDescriptor(moduleAdmin.adminPool, "options")?.configurable === true,
      "invariant du proxy : la cible est un objet vide, donc `configurable` doit être forcé",
    ],
    [
      "une propriété absente reste absente",
      () => Object.getOwnPropertyDescriptor(moduleAdmin.adminPool, "propriete_inexistante") === undefined,
      "le proxy ne doit pas fabriquer de propriété",
    ],
  ];
  for (const [libelle, essai, detail] of reflexions) {
    let ok = false;
    try {
      ok = essai();
    } catch {
      ok = false;
    }
    verifier(libelle, ok, ok ? "" : detail);
  }

  // Le pool réel doit rester atteignable à travers le proxy.
  const { Pool } = await import("pg");
  verifier(
    "le proxy expose le Pool sous-jacent",
    globalAdmin.__geoforestAdminPool instanceof Pool,
    globalAdmin.__geoforestAdminPool instanceof Pool ? "instance de Pool" : "type inattendu",
  );

  // Nettoyage : on referme le pool sans jamais l'avoir utilisé.
  await (globalAdmin.__geoforestAdminPool as { end: () => Promise<void> }).end();
  delete globalAdmin.__geoforestAdminPool;
  delete process.env.DATABASE_URL_ADMIN;
}

async function principal(): Promise<void> {
  voletStatique();
  const moduleAdmin = await voletDynamique();
  await voletConfigure(moduleAdmin);
}

function bilan(): void {
  console.log("\n" + "=".repeat(70));
  if (echecs === 0) {
    console.log(`\x1b[1;32mCONTRÔLES RÉUSSIS : ${total - echecs}/${total}\x1b[0m`);
  } else {
    console.log(`\x1b[1;31mÉCHECS : ${echecs}/${total}\x1b[0m`);
    process.exitCode = 1;
  }
  console.log("=".repeat(70));
}

// `tsx` compile en CJS : pas d'`await` de premier niveau possible.
principal().then(bilan, (erreur) => {
  console.error(erreur);
  process.exitCode = 1;
});
