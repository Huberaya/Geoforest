/**
 * Non-régression — la procédure d'amorçage refuse les conditions dangereuses.
 *
 * Exécution :
 *     npx tsx --conditions=react-server scripts/check-seed-securite.ts
 *
 * ⚠️ Ce banc **exécute réellement** `scripts/seed-auth.ts` en sous-processus,
 *   dans les situations où il doit échouer **avant** de toucher quoi que ce
 *   soit. Il ne se contente pas de relire le source : une garde écrite mais
 *   jamais atteinte (mauvais ordre, variable mal nommée, `process.exit`
 *   oublié) passerait un contrôle statique et échouerait en vrai.
 *
 * ⚠️ Aucune base n'est contactée : chaque cas échoue avant l'ouverture du pool.
 *   L'environnement du sous-processus est construit à la main, sans héritage,
 *   pour qu'un `.env.local` de la machine ne rende pas un cas vert par accident.
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

/** Environnement minimal : rien n'est hérité, tout est explicite. */
function lancer(environnement: Record<string, string>): { code: number | null; sortie: string } {
  const resultat = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "scripts/seed-auth.ts"],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        // Neutralise un éventuel .env chargé par dotenv.
        DOTENV_CONFIG_PATH: "/dev/null",
        ...environnement,
      } as unknown as NodeJS.ProcessEnv,
      timeout: 120_000,
    },
  );
  return { code: resultat.status, sortie: `${resultat.stdout ?? ""}${resultat.stderr ?? ""}` };
}

const BASE_LOCALE = "postgresql://u:p@127.0.0.1:1/base_inexistante";
const MOT_DE_PASSE_PUBLIE = ["Trace", "Demo2026x"].join("!");
const MOT_DE_PASSE_VALIDE = "UnMotDePasseSuffisammentLong";

function principal(): void {
  console.log("\n\x1b[1mA. Aucune valeur par défaut de mot de passe\x1b[0m");

  const sansMotDePasse = lancer({ NODE_ENV: "development", DATABASE_URL_ADMIN: BASE_LOCALE });
  verifier(
    "sans SEED_DEMO_PASSWORD, le seed refuse de s'exécuter",
    sansMotDePasse.code === 1 && /SEED_DEMO_PASSWORD est absent/.test(sansMotDePasse.sortie),
    sansMotDePasse.sortie.split("\n").find((l) => l.includes("SEED_DEMO_PASSWORD")) ?? "aucun refus",
  );
  verifier(
    "aucun mot de passe n'apparaît dans la sortie",
    !/Mot de passe commun/.test(sansMotDePasse.sortie),
    "aucune fuite",
  );

  console.log("\n\x1b[1mB. Longueur minimale\x1b[0m");
  const court = lancer({ NODE_ENV: "development", SEED_DEMO_PASSWORD: "court", DATABASE_URL_ADMIN: BASE_LOCALE });
  verifier(
    "un mot de passe trop court est refusé",
    court.code === 1 && /au moins 12 caractères/.test(court.sortie),
    court.sortie.split("\n").find((l) => l.includes("12")) ?? "aucun refus",
  );

  console.log("\n\x1b[1mC. Mot de passe publié dans l'historique\x1b[0m");
  const publie = lancer({
    NODE_ENV: "development",
    SEED_DEMO_PASSWORD: MOT_DE_PASSE_PUBLIE,
    DATABASE_URL_ADMIN: BASE_LOCALE,
  });
  verifier(
    "le mot de passe jadis codé en dur est refusé",
    publie.code === 1 && /publié dans l'historique/.test(publie.sortie),
    publie.sortie.split("\n").find((l) => l.includes("publié")) ?? "aucun refus",
  );
  verifier(
    "la valeur refusée n'est pas recopiée dans la sortie",
    !publie.sortie.includes(MOT_DE_PASSE_PUBLIE),
    "non recopiée",
  );

  console.log("\n\x1b[1mD. Garde de production\x1b[0m");
  const production = lancer({
    NODE_ENV: "production",
    SEED_DEMO_PASSWORD: MOT_DE_PASSE_VALIDE,
    DATABASE_URL_ADMIN: BASE_LOCALE,
  });
  verifier(
    "sous NODE_ENV=production, le seed refuse même avec un mot de passe valide",
    production.code === 1 && /NODE_ENV=production/.test(production.sortie),
    production.sortie.split("\n").find((l) => l.includes("production")) ?? "aucun refus",
  );

  console.log("\n\x1b[1mE. Cible distante non déclarée\x1b[0m");
  const distant = lancer({
    NODE_ENV: "development",
    SEED_DEMO_PASSWORD: MOT_DE_PASSE_VALIDE,
    DATABASE_URL_ADMIN: "postgresql://u:p@ep-exemple.eu-central-1.aws.neon.tech/db",
  });
  verifier(
    "une base non locale est refusée sans autorisation explicite",
    distant.code === 1 && /n'est pas locale/.test(distant.sortie),
    distant.sortie.split("\n").find((l) => l.includes("locale")) ?? "aucun refus",
  );
  verifier(
    "l'échappatoire est nommée, pas silencieuse",
    /SEED_AUTORISE_HOTE_DISTANT/.test(distant.sortie),
    "variable citée",
  );

  console.log("\n\x1b[1mF. Analyse statique du source\x1b[0m");
  // Ces contrôles doublent les contrôles dynamiques : ils nomment la forme
  // fautive, de sorte qu'une réintroduction se lise dans le diff.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const source = readFileSync("scripts/seed-auth.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  verifier(
    "aucune valeur de repli sur SEED_DEMO_PASSWORD",
    !/SEED_DEMO_PASSWORD\s*\?\?\s*["'][^"']+["']/.test(code),
    "pas de `?? \"mot de passe\"`",
  );
  // ⚠️ `DEMO_PASSWORD` est une **sous-chaîne** de `SEED_DEMO_PASSWORD` : un
  //   contrôle naïf se déclenche sur le message qui explique la règle. On
  //   neutralise d'abord la variable d'environnement, puis on ne cherche plus
  //   qu'une chose : la variable locale dans une ligne d'affichage.
  const sansVariableEnv = code.split("SEED_DEMO_PASSWORD").join("");
  const lignesAffichage = sansVariableEnv
    .split("\n")
    .filter((ligne) => /console\.(log|info|warn|error)/.test(ligne));
  const fuites = lignesAffichage.filter((ligne) => /DEMO_PASSWORD/.test(ligne));
  verifier(
    "le mot de passe n'est jamais affiché",
    fuites.length === 0,
    fuites.length === 0 ? "aucune ligne d'affichage" : `${fuites.length} ligne(s) en fuite`,
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
