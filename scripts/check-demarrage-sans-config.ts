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
async function voletDynamique(): Promise<void> {
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
}

async function principal(): Promise<void> {
  voletStatique();
  await voletDynamique();
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
