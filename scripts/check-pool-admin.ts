/**
 * Lot B — pool privilégié `/api/metrics` : paresseux, mais pas silencieux.
 *
 * Exécution : npx tsx --conditions=react-server scripts/check-pool-admin.ts
 *
 * ⚠️ Ce que ces contrôles interdisent.
 *
 * 1. **Importer ne doit rien ouvrir.** `next build` évalue les modules de route
 *    pendant « Collecting page data », sans base et sans servir de requête. Un
 *    pool construit à l'import y échouait, et le build cassait sur
 *    `/api/metrics`.
 * 2. **La correction ne doit pas déplacer la dépendance.** La version
 *    précédente construisait, en phase de build, un pool vers
 *    `postgresql://absente:absente@127.0.0.1:1/absente` : la connexion factice
 *    restait construite à l'import.
 * 3. **Une configuration absente doit se voir.** Un pool non configuré ne doit
 *    jamais se présenter comme opérationnel : l'accès lève, en nommant
 *    `DATABASE_URL_ADMIN`.
 * 4. **Le proxy doit être transparent.** `Object.keys`, le spread,
 *    `instanceof`, le prototype et l'identité des méthodes doivent se comporter
 *    comme sur l'instance réelle. Un `Proxy` qui ne piège que `get`/`has`
 *    renvoie `{}` au spread et casse `instanceof` — « aucun appelant ne fait
 *    cela » est une observation datée, pas une garantie.
 *
 * Aucune connexion réelle n'est tentée : le seul appel réseau vise
 * `127.0.0.1:1` (port fermé), pour vérifier **l'échec explicite**.
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

/** URL synthétique : aucun serveur n'écoute sur le port 1. */
const URL_SYNTHETIQUE = "postgresql://synthetique:synthetique@127.0.0.1:1/aucune_base";

function envSansConfig(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.DATABASE_URL_ADMIN;
  delete env.DATABASE_URL;
  return env;
}

// ------------------------------------------------------------- mode enfant
const mode = process.argv[2];

if (mode === "sans-config" || mode === "avec-config") {
  // `process.exitCode` plutôt que `exit()` : le module peut garder des handles.
  const verifier = async (): Promise<void> => {
    const admin = await import("../src/db/admin");

    if (mode === "sans-config") {
      // 1. L'import ne lève pas, même en phase de build.
      check("import sans configuration : aucune exception", true);
      check(
        "import sans configuration : aucun pool construit",
        (globalThis as Record<string, unknown>).__geoforestAdminPool === undefined,
      );

      // 2. L'utilisation lève, en nommant la variable manquante.
      let message = "";
      try {
        void admin.adminPool.query;
      } catch (erreur) {
        message = erreur instanceof Error ? erreur.message : String(erreur);
      }
      check(
        "accès sans configuration : échec explicite nommant DATABASE_URL_ADMIN",
        message.includes("DATABASE_URL_ADMIN"),
        message || "(aucune erreur levée)",
      );

      // 3. Même chose pour la façade Drizzle.
      let messageDb = "";
      try {
        void admin.dbAdmin.select;
      } catch (erreur) {
        messageDb = erreur instanceof Error ? erreur.message : String(erreur);
      }
      check(
        "dbAdmin sans configuration : échec explicite",
        messageDb.includes("DATABASE_URL_ADMIN"),
        messageDb || "(aucune erreur levée)",
      );

      // 4. Le chemin réel du build : importer le module de route lui-même.
      //    C'est lui que Next.js évalue pendant « Collecting page data ».
      let erreurRoute = "";
      try {
        await import("../src/app/api/metrics/route");
      } catch (erreur) {
        erreurRoute = erreur instanceof Error ? erreur.message : String(erreur);
      }
      check(
        "import de /api/metrics sans configuration : aucune exception",
        erreurRoute === "",
        erreurRoute,
      );
      return;
    }

    // ------------------------------------------------------- mode configuré
    const { Pool } = await import("pg");

    check("import avec configuration : aucune exception", true);
    check("aucun pool construit à l'import", (globalThis as Record<string, unknown>).__geoforestAdminPool === undefined);

    const pool = admin.adminPool;

    // Proxy transparent : réflexion.
    check("typeof adminPool.query === 'function'", typeof pool.query === "function");
    check("méthode liée : adminPool.query === adminPool.query", pool.query === pool.query);
    check("adminPool instanceof Pool", pool instanceof Pool);
    check("prototype réel exposé", Object.getPrototypeOf(pool) === Pool.prototype);
    check("constructeur réel", pool.constructor === Pool);
    // `Client` est une propriété **de l'instance** (pas de `Pool` lui-même) :
    // on la compare à celle du pool réel, jamais liée.
    const reel = (globalThis as Record<string, unknown>).__geoforestAdminPool as unknown as Record<string, unknown>;
    check(
      "classes exposées non liées",
      typeof (pool as unknown as Record<string, unknown>).Client === "function" &&
        (pool as unknown as Record<string, unknown>).Client === reel.Client,
    );
    check("'query' in adminPool", "query" in pool);
    check("Object.keys non vide", Object.keys(pool).length > 0, `clés : ${Object.keys(pool).join(", ")}`);
    check("spread non vide", Object.keys({ ...pool }).length === Object.keys(pool).length);
    check(
      "descripteur propre lisible",
      Object.getOwnPropertyDescriptor(pool, "options") !== undefined,
    );
    check("toString hérité du prototype réel", Object.prototype.toString.call(pool).includes("Object"));

    // Écriture / suppression à travers le proxy : déléguées à l'instance.
    (pool as unknown as Record<string, unknown>).__marqueur = 42;
    check("affectation déléguée", (pool as unknown as Record<string, unknown>).__marqueur === 42);
    check("propriété ajoutée visible par réflexion", "__marqueur" in pool);
    delete (pool as unknown as Record<string, unknown>).__marqueur;
    check("suppression déléguée", !("__marqueur" in pool));

    // Façade Drizzle : mêmes exigences.
    check("typeof dbAdmin.select === 'function'", typeof admin.dbAdmin.select === "function");
    check("dbAdmin.select lié", admin.dbAdmin.select === admin.dbAdmin.select);
    check("Object.keys(dbAdmin) non vide", Object.keys(admin.dbAdmin).length > 0);

    // 4. Appel effectif : la configuration est valide syntaxiquement, le
    //    serveur est absent → échec explicite, jamais un succès silencieux.
    let erreurRequete: NodeJS.ErrnoException | null = null;
    try {
      await pool.query("select 1");
    } catch (erreur) {
      erreurRequete = erreur as NodeJS.ErrnoException;
    }
    check("appel effectif : échec explicite (aucun succès silencieux)", erreurRequete !== null);
    check(
      "l'échec est une erreur de connexion identifiée",
      erreurRequete !== null && ["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"].includes(String(erreurRequete.code)),
      erreurRequete ? String(erreurRequete.code) : "aucune erreur",
    );

    // 5. Méthode de prototype liée : `end()` rend une promesse.
    const fin = pool.end();
    check("end() lié et appelable", typeof fin.then === "function");
    await fin;
  };

  verifier()
    .then(() => {
      // Le code de sortie reste 0 : le parent agrège les échecs et décide.
      // Sortir en erreur ici ferait perdre le détail des contrôles.
      console.log(JSON.stringify({ passed, failures }));
    })
    .catch((erreur) => {
      console.log(JSON.stringify({ passed, failures: [`exception non prévue : ${String(erreur)}`] }));
    });
} else {
  // ------------------------------------------------------------- mode parent
  const script = fileURLToPath(import.meta.url);

  function lancer(sousMode: string, env: NodeJS.ProcessEnv): { passed: number; failures: string[] } {
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
    return JSON.parse(derniere) as { passed: number; failures: string[] };
  }

  section("1. Import sans aucune configuration (cas du build)");
  const sansConfig = lancer("sans-config", {
    ...envSansConfig(),
    // Le build doit être couvert explicitement : l'ancienne correction
    // dépendait de cette variable.
    NEXT_PHASE: "phase-production-build",
  });

  section("2. Configuration présente : accès réel et transparence du proxy");
  const avecConfig = lancer("avec-config", { ...envSansConfig(), DATABASE_URL_ADMIN: URL_SYNTHETIQUE });

  passed = sansConfig.passed + avecConfig.passed;
  failures.push(...sansConfig.failures.map((f) => `[sans config] ${f}`));
  failures.push(...avecConfig.failures.map((f) => `[avec config] ${f}`));

  section("3. Synthèse");
  console.log(`${passed} contrôle(s) passé(s), ${failures.length} échec(s).`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`  🔴 ${f}`);
    process.exit(1);
  }
}
