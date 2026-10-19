/**
 * E4.1 — la limitation de débit vit dans la mémoire du processus.
 *
 * Exécution :
 *     node --conditions=react-server --import tsx scripts/check-limitation-memoire.ts
 *
 * ⚠️ Ce banc ne « corrige » rien : il **démontre** une limite assumée, pour
 *   qu'elle cesse d'être une phrase dans un commentaire. Un redémarrage du
 *   processus remet le quota à zéro ; plusieurs instances comptent chacune
 *   pour elles-mêmes. Toute personne qui lit ce résultat sait ce que la
 *   limitation protège — un client trop pressé — et ce qu'elle ne protège pas.
 */
import { readFileSync } from "node:fs";

import { reinitialiserCadence, verifierCadence } from "../src/lib/rate-limit";

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

const MAX = 5;
const FENETRE = 60_000;

console.log("\n\x1b[1mA. Le quota s'applique dans un même processus\x1b[0m");
reinitialiserCadence();
let refuse = 0;
for (let i = 0; i < MAX + 3; i += 1) {
  if (!verifierCadence("essai:1.2.3.4", MAX, FENETRE).autorise) refuse += 1;
}
verifier(
  `au-delà de ${MAX} requêtes, la limitation refuse`,
  refuse === 3,
  `${refuse} refus sur 3 attendus`,
);

console.log("\n\x1b[1mB. Un redémarrage rend le quota intégralement\x1b[0m");
// `reinitialiserCadence()` vide la Map : c'est exactement l'effet d'un
// redémarrage de processus, sans avoir à tuer le processus courant.
reinitialiserCadence();
const apresRedemarrage = verifierCadence("essai:1.2.3.4", MAX, FENETRE);
verifier(
  "après réinitialisation, la même clé est de nouveau autorisée",
  apresRedemarrage.autorise === true,
  `restantes=${apresRedemarrage.restantes}`,
);
verifier(
  "le compteur est bien reparti de zéro",
  apresRedemarrage.restantes === MAX - 1,
  `${apresRedemarrage.restantes} restantes au lieu de ${MAX - 1}`,
);

console.log("\n\x1b[1mC. Deux « instances » ne partagent rien\x1b[0m");
// Deux clés distinctes simulent deux processus : chacune a son propre quota.
reinitialiserCadence();
const instanceA = verifierCadence("instance-a:1.2.3.4", 2, FENETRE);
const instanceB = verifierCadence("instance-b:1.2.3.4", 2, FENETRE);
verifier(
  "chaque instance applique son propre quota au même client",
  instanceA.autorise && instanceB.autorise,
  "le quota effectif est multiplié par le nombre d'instances",
);

console.log("\n\x1b[1mD. Aucun magasin partagé n'est branché\x1b[0m");
const source = readFileSync("src/lib/rate-limit.ts", "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
verifier(
  "la limitation n'utilise aucune dépendance de stockage partagé",
  !/\b(redis|ioredis|upstash|pg|drizzle)\b/i.test(code),
  "aucun Redis, aucune table : mémoire du processus seule",
);
verifier(
  "la limite est déclarée dans le code, pas seulement dans un commentaire",
  /const compartiments = new Map</.test(code),
  "Map de module",
);

console.log("\n" + "=".repeat(70));
if (echecs === 0) {
  console.log(`\x1b[1m\x1b[32mCONTRÔLES RÉUSSIS : ${total - echecs}/${total}\x1b[0m`);
} else {
  console.log(`\x1b[1m\x1b[31mÉCHECS : ${echecs}/${total}\x1b[0m`);
  process.exitCode = 1;
}
console.log("=".repeat(70));
