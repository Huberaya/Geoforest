/**
 * Non-régression P3-04 — la procédure d'amorçage refuse les conditions dangereuses.
 *
 * Exécution :
 *     node --conditions=react-server --import tsx scripts/check-seed-securite.ts
 *
 * ⚠️ Ce banc **exécute réellement** `scripts/seed-auth.ts` en sous-processus,
 *   dans trois situations où il doit échouer avant de toucher quoi que ce
 *   soit. Il ne se contente pas de relire le source : une garde écrite mais
 *   jamais atteinte (mauvais ordre, variable mal nommée) passerait un contrôle
 *   statique et échouerait en vrai.
 *
 * ⚠️ Aucune base n'est contactée : chaque cas échoue avant l'ouverture du pool.
 */
import { spawnSync } from "node:child_process";

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

/**
 * Lance le seed avec un environnement **minimal** : on ne veut pas qu'un
 * `.env.local` de la machine rende le test vert par accident.
 */
function lancer(environnement: Record<string, string>): { code: number | null; sortie: string } {
  const resultat = spawnSync(
    "node",
    ["--conditions=react-server", "--import", "tsx", "scripts/seed-auth.ts"],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        // Aucun fichier .env n'est chargé par le script lui-même : il lit
        // `.env.local` via dotenv, que l'on neutralise en le pointant ailleurs.
        DOTENV_CONFIG_PATH: "/dev/null",
        ...environnement,
      } as unknown as NodeJS.ProcessEnv,
      timeout: 60_000,
    },
  );
  return {
    code: resultat.status,
    sortie: `${resultat.stdout ?? ""}${resultat.stderr ?? ""}`,
  };
}

function principal(): void {
  console.log("\n\x1b[1mA. Aucune valeur par défaut de mot de passe\x1b[0m");

  // Sans SEED_DEMO_PASSWORD : refus explicite.
  const sansMotDePasse = lancer({ NODE_ENV: "development" });
  verifier(
    "sans SEED_DEMO_PASSWORD, le seed refuse de s'exécuter",
    sansMotDePasse.code !== 0 && /SEED_DEMO_PASSWORD est requis/.test(sansMotDePasse.sortie),
    sansMotDePasse.sortie.split("\n").find((l) => l.includes("SEED_DEMO_PASSWORD")) ?? "aucun refus",
  );
  verifier(
    "aucun mot de passe n'apparaît dans la sortie",
    !/Mot de passe commun/.test(sansMotDePasse.sortie),
    "aucune fuite",
  );

  console.log("\n\x1b[1mB. Longueur minimale\x1b[0m");
  const court = lancer({ NODE_ENV: "development", SEED_DEMO_PASSWORD: "court" });
  verifier(
    "un mot de passe trop court est refusé",
    court.code !== 0 && /au moins 12 caractères/.test(court.sortie),
    court.sortie.split("\n").find((l) => l.includes("12")) ?? "aucun refus",
  );
  verifier(
    "le mot de passe fourni n'est pas recopié dans la sortie",
    !court.sortie.includes("court"),
    "non recopié",
  );

  console.log("\n\x1b[1mC. Garde de production\x1b[0m");
  const production = lancer({
    NODE_ENV: "production",
    SEED_DEMO_PASSWORD: "UnMotDePasseSuffisammentLong",
    DATABASE_URL_ADMIN: "postgresql://u:p@127.0.0.1:1/base_inexistante",
  });
  verifier(
    "sous NODE_ENV=production, le seed refuse même avec un mot de passe valide",
    production.code !== 0 && /refuse de s'exécuter avec NODE_ENV=production/.test(production.sortie),
    production.sortie.split("\n").find((l) => l.includes("production")) ?? "aucun refus",
  );

  console.log("\n\x1b[1mD. Analyse statique du source\x1b[0m");
  // Ces deux contrôles doublent les contrôles dynamiques : ils nomment la forme
  // fautive, de sorte qu'une réintroduction se lise dans le code.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const source = readFileSync("scripts/seed-auth.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  verifier(
    "aucune valeur de repli sur SEED_DEMO_PASSWORD",
    !/SEED_DEMO_PASSWORD\s*\?\?\s*["'][^"']+["']/.test(code),
    "pas de `?? \"mot de passe\"`",
  );
  verifier(
    "le mot de passe n'est pas interpolé dans un console.log",
    !/console\.log\([^)]*DEMO_PASSWORD[^)]*\)/.test(code) ||
      /DEMO_PASSWORD\.length/.test(code),
    "seule la longueur est journalisée",
  );

  console.log("\n" + "=".repeat(70));
  if (echecs === 0) {
    console.log(`\x1b[1m\x1b[32mCONTRÔLES RÉUSSIS : ${total - echecs}/${total}\x1b[0m`);
  } else {
    console.log(`\x1b[1m\x1b[31mÉCHECS : ${echecs}/${total}\x1b[0m`);
    process.exitCode = 1;
  }
  console.log("=".repeat(70));
}

principal();
