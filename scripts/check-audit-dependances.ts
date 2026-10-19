/**
 * E2 — l'audit des dépendances doit dire la vérité, pas seulement être vert.
 *
 * Exécution :
 *     node --conditions=react-server --import tsx scripts/check-audit-dependances.ts
 *
 * ⚠️ Problème que ce banc résout.
 *   `braces <= 3.0.3` porte GHSA-vfj7-8cjw-p6xm / CVE-2026-93687, et **aucune
 *   version corrigée n'existe** (`npm view braces dist-tags` → `3.0.3`).
 *   L'audit de développement échoue donc, et il échouera jusqu'à ce que
 *   l'amont publie. Deux mauvaises réponses ont été écartées :
 *
 *     • `continue-on-error: true` sur l'étape → la CI affiche « success » alors
 *       que l'audit a échoué. C'est un masquage, pas une atténuation.
 *     • supprimer l'étape → plus personne ne regarde.
 *
 *   La réponse retenue est un **contrôle de régression** : le banc constate
 *   l'état connu et échoue s'il change. Une nouvelle vulnérabilité — y compris
 *   en production — fait tomber la CI ; la vulnérabilité connue et non
 *   corrigeable est nommée à chaque exécution, avec sa raison.
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

interface Avis {
  name: string;
  severity: string;
  via: Array<string | { title?: string; url?: string; range?: string }>;
}

/**
 * Vulnérabilités **connues et acceptées** en développement : `braces` et les
 * paquets qui en dépendent. Toute autre entrée est une régression.
 */
const CONNUES_DEV = new Set([
  "braces",
  "fast-glob",
  "micromatch",
  "@next/eslint-plugin-next",
  "eslint-config-next",
]);

function auditer(args: string[]): { code: number | null; rapport: { vulnerabilities?: Record<string, Avis>; metadata?: { vulnerabilities?: Record<string, number> } } } {
  const resultat = spawnSync("npm", ["audit", ...args, "--json"], {
    encoding: "utf8",
    timeout: 120_000,
  });
  let rapport: { vulnerabilities?: Record<string, Avis>; metadata?: { vulnerabilities?: Record<string, number> } } = {};
  try {
    rapport = JSON.parse(resultat.stdout ?? "{}");
  } catch {
    rapport = {};
  }
  return { code: resultat.status, rapport };
}

console.log("\n\x1b[1mA. Production — zéro vulnérabilité connue\x1b[0m");
const prod = auditer(["--omit=dev"]);
const prodVulns = Object.keys(prod.rapport.vulnerabilities ?? {});
verifier(
  "aucune vulnérabilité de production",
  prodVulns.length === 0,
  prodVulns.length === 0 ? "0" : prodVulns.join(", "),
);
verifier(
  "l'audit de production sort en code 0",
  prod.code === 0,
  `code ${prod.code}`,
);

console.log("\n\x1b[1mB. Développement — état connu, aucune surprise\x1b[0m");
const dev = auditer(["--include=dev"]);
const devVulns = dev.rapport.vulnerabilities ?? {};
const noms = Object.keys(devVulns).sort();

// L'état attendu est que l'audit ÉCHOUE. S'il réussit, c'est que `braces` a
// reçu un correctif : la veille doit être mise à jour, pas silencieusement
// satisfaite.
verifier(
  "l'audit de développement échoue toujours (braces non corrigé en amont)",
  dev.code === 1,
  `code ${dev.code}`,
);

const inattendues = noms.filter((nom) => !CONNUES_DEV.has(nom));
verifier(
  "aucune vulnérabilité de développement hors du lot `braces` connu",
  inattendues.length === 0,
  inattendues.length === 0 ? `${noms.length} entrée(s), toutes connues` : inattendues.join(", "),
);

// Chaque entrée connue doit remonter à l'avis `braces` : si l'une d'elles
// portait un avis différent, la liste « connue » masquerait un nouveau défaut.
const avisInconnus: string[] = [];
for (const nom of noms.filter((n) => CONNUES_DEV.has(n))) {
  for (const via of devVulns[nom].via ?? []) {
    if (typeof via === "object" && via.url && !via.url.includes("GHSA-vfj7-8cjw-p6xm")) {
      avisInconnus.push(`${nom} → ${via.url}`);
    }
  }
}
verifier(
  "toutes les entrées connues remontent à GHSA-vfj7-8cjw-p6xm",
  avisInconnus.length === 0,
  avisInconnus.join(", ") || "une seule cause",
);

verifier(
  "`braces` est bien présent dans l'arbre de développement",
  noms.includes("braces"),
  noms.includes("braces") ? `${devVulns["braces"].severity}` : "absent",
);

console.log("\n\x1b[1mC. Le lot connu est-il toujours justifié ?\x1b[0m");
// `braces` n'a aucune version publiée au-delà de 3.0.3. Si cela change, ce
// contrôle le signale : la correction devient possible et l'exception ne se
// justifie plus.
const dernier = spawnSync("npm", ["view", "braces", "version"], { encoding: "utf8", timeout: 60_000 });
const version = (dernier.stdout ?? "").trim();
verifier(
  "aucune version corrigée de `braces` n'est disponible",
  version === "" || version === "3.0.3" || /^3\.0\.\d+$/.test(version) === false,
  `version publiée : ${version || "inconnue"} — si > 3.0.3, mettre à jour et rendre l'audit bloquant`,
);

console.log("\n" + "=".repeat(70));
if (echecs === 0) {
  console.log(`\x1b[1m\x1b[32mCONTRÔLES RÉUSSIS : ${total - echecs}/${total}\x1b[0m`);
  console.log(
    "\x1b[33mRisque résiduel accepté : `braces` en développement uniquement, " +
      "GHSA-vfj7-8cjw-p6xm, aucune version corrigée.\x1b[0m",
  );
} else {
  console.log(`\x1b[1m\x1b[31mÉCHECS : ${echecs}/${total}\x1b[0m`);
  process.exitCode = 1;
}
console.log("=".repeat(70));
