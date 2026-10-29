/**
 * Pool **tenant** (`src/db/index.ts`) — paresseux, explicite, sans identité fictive.
 *
 * Exécution : npx tsx --conditions=react-server scripts/check-pool-tenant.ts
 *
 * ⚠️ Ce que ces contrôles interdisent.
 *
 * La version précédente construisait le pool au niveau du module avec, en cas
 * de `DATABASE_URL` absente, la chaîne `postgresql://absente:absente@127.0.0.1:1/absente`.
 * Ce n'était pas inerte : le pilote la recevait, et toute requête partait vers
 * `127.0.0.1:1`. L'erreur rendue était `ECONNREFUSED 127.0.0.1:1` — un symptôme
 * réseau qui **ne nomme pas** la variable manquante.
 *
 * Les contrôles ci-dessous verrouillent :
 *   1. importer ne construit aucun pool, et ne lit pas la configuration ;
 *   2. sans `DATABASE_URL`, le premier usage lève en nommant `DATABASE_URL` —
 *      et aucune erreur réseau vers `127.0.0.1:1` ne peut apparaître ;
 *   3. en production, l'import échoue toujours immédiatement (fail-closed) :
 *      un serveur mal configuré ne doit pas démarrer ;
 *   4. en phase de build, l'import reste possible (sinon `next build` casse) ;
 *   5. avec une configuration fournie, le proxy reste transparent et l'échec
 *      d'une requête est réel, jamais silencieux.
 *
 * Aucune connexion réelle n'est tentée : la seule cible est `127.0.0.1:1`
 * (port fermé), pour vérifier que l'échec est explicite.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n##### ${title} #####`);
}

const URL_SYNTHETIQUE = "postgresql://synthetique:synthetique@127.0.0.1:1/aucune_base";

function envSansConfig(base: NodeJS.ProcessEnv = { ...process.env }): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.DATABASE_URL;
  delete env.DATABASE_URL_ADMIN;
  return env;
}

// ------------------------------------------------------------- mode enfant
const mode = process.argv[2];

if (mode) {
  const verifier = async (): Promise<void> => {
    if (mode === "production-sans-config") {
      // Le serveur doit refuser de démarrer : la protection existante est
      // conservée, elle n'est pas remplacée par un échec au premier usage.
      let message = "";
      try {
        await import("../src/db/index");
      } catch (erreur) {
        message = erreur instanceof Error ? erreur.message : String(erreur);
      }
      console.log(
        JSON.stringify({
          passed: 0,
          failures: [],
          mesure: { importProduction: message },
        }),
      );
      return;
    }

    const tenant = await import("../src/db/index");

    if (mode === "sans-config" || mode === "build-sans-config") {
      check("import sans configuration : aucune exception", true);
      check(
        "import sans configuration : aucun pool construit",
        (globalThis as Record<string, unknown>).__arenaNextJsPostgresqlPool === undefined,
      );

      let messagePool = "";
      try {
        void tenant.pool.query;
      } catch (erreur) {
        messagePool = erreur instanceof Error ? erreur.message : String(erreur);
      }
      check(
        "pool sans configuration : échec explicite nommant DATABASE_URL",
        messagePool.includes("DATABASE_URL"),
        messagePool || "(aucune erreur levée)",
      );
      check(
        "aucune identité fictive dans le message (ni « absente », ni 127.0.0.1:1)",
        !messagePool.includes("absente") && !messagePool.includes("127.0.0.1:1"),
        messagePool,
      );

      let messageDb = "";
      try {
        void tenant.db.transaction;
      } catch (erreur) {
        messageDb = erreur instanceof Error ? erreur.message : String(erreur);
      }
      check(
        "db sans configuration : échec explicite nommant DATABASE_URL",
        messageDb.includes("DATABASE_URL"),
        messageDb || "(aucune erreur levée)",
      );

      // Le module qui consomme réellement le pool (toutes les routes gardées
      // passent par `withTenant`) doit rester importable sans configuration :
      // sinon la collecte des pages du build casserait.
      let erreurTenant = "";
      try {
        await import("../src/lib/tenant");
      } catch (erreur) {
        erreurTenant = erreur instanceof Error ? erreur.message : String(erreur);
      }
      check("import de `withTenant` sans configuration : aucune exception", erreurTenant === "", erreurTenant);

      console.log(JSON.stringify({ passed, failures }));
      return;
    }

    // ------------------------------------------------------ mode configuré
    const { Pool } = await import("pg");
    const { sql } = await import("drizzle-orm");

    check("import avec configuration : aucune exception", true);
    check(
      "aucun pool construit à l'import",
      (globalThis as Record<string, unknown>).__arenaNextJsPostgresqlPool === undefined,
    );

    const pool = tenant.pool;
    check("typeof pool.query === 'function'", typeof pool.query === "function");
    check("méthode liée : pool.query === pool.query", pool.query === pool.query);
    check("pool instanceof Pool", pool instanceof Pool);
    check("constructeur réel", pool.constructor === Pool);
    check("prototype réel exposé", Object.getPrototypeOf(pool) === Pool.prototype);
    check("Object.keys non vide", Object.keys(pool).length > 0, `clés : ${Object.keys(pool).join(", ")}`);
    check("spread non vide", Object.keys({ ...pool }).length === Object.keys(pool).length);
    check("'query' in pool", "query" in pool);

    const db = tenant.db;
    check("typeof db.transaction === 'function'", typeof db.transaction === "function");
    check("db.transaction lié", db.transaction === db.transaction);
    check("Object.keys(db) non vide", Object.keys(db).length > 0);

    // Appel effectif : la configuration est réellement utilisée, et l'échec
    // est explicite. Aucun succès silencieux n'est possible.
    let erreurPool: NodeJS.ErrnoException | null = null;
    try {
      await pool.query("select 1");
    } catch (erreur) {
      erreurPool = erreur as NodeJS.ErrnoException;
    }
    check(
      "appel effectif du pool : échec explicite (ECONNREFUSED attendu)",
      erreurPool !== null && erreurPool.code === "ECONNREFUSED",
      erreurPool ? String(erreurPool.code) : "aucune erreur",
    );

    // ⚠️ Drizzle enveloppe l'erreur du pilote : `code` est sur `cause`, et
    //   le message de surface est « Failed query: select 1 ». Le vérifier
    //   explicitement évite deux erreurs symétriques : croire à un succès
    //   silencieux, ou conclure à une régression du pool alors que seule la
    //   forme de l'erreur a changé.
    let erreurDb: (NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException }) | null = null;
    try {
      await db.execute(sql`select 1`);
    } catch (erreur) {
      erreurDb = erreur as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
    }
    check(
      "appel effectif via Drizzle (`db.execute`) : échec explicite",
      erreurDb !== null && (erreurDb.code === "ECONNREFUSED" || erreurDb.cause?.code === "ECONNREFUSED"),
      erreurDb ? String(erreurDb.code ?? erreurDb.cause?.code) : "aucune erreur",
    );

    await pool.end();
    console.log(JSON.stringify({ passed, failures }));
  };

  verifier().catch((erreur) => {
    console.log(JSON.stringify({ passed, failures: [`exception non prévue : ${String(erreur)}`] }));
  });
} else {
  // ------------------------------------------------------------- mode parent
  const script = fileURLToPath(import.meta.url);

  function lancer(
    sousMode: string,
    env: NodeJS.ProcessEnv,
  ): { passed: number; failures: string[]; mesure?: { importProduction: string } } {
    const sortie = execFileSync(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", script, sousMode],
      { env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    // `trimEnd()` et non `trim()` : `trim()` mangeait l'indentation de la
    // PREMIÈRE ligne, qui disparaissait alors du filtre ci-dessous. Le décompte
    // restait juste (il vient du JSON enfant), mais la liste affichée était
    // incomplète — exactement ce qui rend un décompte invérifiable.
    console.log(sortie.trimEnd().split("\n").filter((l) => l.startsWith("  ")).join("\n"));
    const derniere = sortie.trim().split("\n").pop() ?? "{}";
    return JSON.parse(derniere);
  }

  section("1. Sans configuration (développement) : import inerte, usage explicite");
  const sansConfig = lancer("sans-config", {
    ...envSansConfig(),
    NODE_ENV: "development",
  });

  section("2. Phase de build sans configuration : l'import reste possible");
  const build = lancer("build-sans-config", {
    ...envSansConfig(),
    NODE_ENV: "production",
    NEXT_PHASE: "phase-production-build",
  });

  section("3. Production sans configuration : refus au démarrage (fail-closed)");
  const production = lancer("production-sans-config", {
    ...envSansConfig(),
    NODE_ENV: "production",
  });
  const messageProduction = production.mesure?.importProduction ?? "";
  console.log(`  · message observé : ${messageProduction || "(aucune exception)"}`);
  // Les contrôles sont comptés côté parent : le mode enfant ne peut pas
  // vérifier une exception qu'il doit lui-même capturer pour la rapporter.
  if (messageProduction.includes("DATABASE_URL")) {
    passed += 1;
    console.log("  ✅ import en production sans DATABASE_URL : refus explicite");
  } else {
    failures.push("import en production sans DATABASE_URL : aucune exception");
    console.log("  🔴 import en production sans DATABASE_URL : aucune exception");
  }

  section("4. Configuration fournie : proxy transparent et échec réel");
  const config = lancer("avec-config", {
    ...envSansConfig(),
    NODE_ENV: "development",
    DATABASE_URL: URL_SYNTHETIQUE,
  });

  passed += sansConfig.passed + build.passed + config.passed;
  failures.push(...sansConfig.failures.map((f) => `[sans config] ${f}`));
  failures.push(...build.failures.map((f) => `[build] ${f}`));
  failures.push(...config.failures.map((f) => `[avec config] ${f}`));

  section("5. Synthèse");
  console.log(`${passed} contrôle(s) passé(s), ${failures.length} échec(s).`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`  🔴 ${f}`);
    process.exit(1);
  }
}
