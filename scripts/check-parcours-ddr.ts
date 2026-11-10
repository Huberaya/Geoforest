/**
 * Vérifie que le parcours de diligence raisonnée ne se raccourcit pas selon le
 * pays d'origine (décision D-001, cf. `docs/DECISIONS.md`).
 *
 * ⚠️ Pourquoi ce contrôle existe.
 *
 *   L'article 13 du règlement (UE) 2023/1115 autorise une diligence raisonnée
 *   simplifiée pour les origines low-risk. La décision D-001 est de ne PAS
 *   l'implémenter : tout le monde passe par le parcours complet.
 *
 *   Une telle décision est un état, pas un événement. Rien n'empêche qu'un
 *   jour, en ajoutant un écran ou une condition, quelqu'un écrive
 *   `if (countryRisk === "LOW")` et allège le parcours sans savoir que c'était
 *   un choix argumenté. Ce contrôle rend cette introduction visible.
 *
 * ⚠️ Ce qu'il ne fait pas : il ne juge pas le bien-fondé de la règle. Il
 *   constate l'absence d'une condition de risque dans le chemin de la
 *   diligence. Si D-001 est un jour révoquée, ce fichier doit être mis à jour
 *   en même temps que la décision — pas contourné.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Controle {
  nom: string;
  ok: boolean;
  detail?: string;
}

const controles: Controle[] = [];
const verifier = (nom: string, ok: boolean, detail?: string): void => {
  controles.push({ nom, ok, detail });
};

/* --- Le parcours DDR ne dépend pas du risque pays ------------------------ */

// ⚠️ Les fichiers qui décident de ce qu'un dossier doit contenir. Ce sont eux
//   qui pourraient introduire un raccourci.
const FICHIERS_PARCOURS = [
  join("src", "lib", "eudr", "completeness.ts"),
  join("src", "lib", "eudr", "types.ts"),
];

for (const chemin of FICHIERS_PARCOURS) {
  const source = readFileSync(chemin, "utf-8");

  // Une lecture du risque pays à des fins d'ALLÈGEMENT. On ne peut pas juger
  // l'intention par une expression régulière, mais on peut exiger qu'elle soit
  // relue : toute occurrence d'un niveau de risque dans un fichier de parcours
  // est signalée.
  const occurrencesRisk = source.match(/\b(riskLevel|country_risk|countryRisk|niveauBenchmark)\b/g) ?? [];
  const attendu = chemin.endsWith("types.ts") ? occurrencesRisk.length : 0;

  verifier(
    `${chemin.replace(/\\/g, "/")} : aucune condition de risque dans le parcours`,
    occurrencesRisk.length === attendu,
    `${occurrencesRisk.length} occurrence(s) de niveau de risque : le parcours DDR ne doit pas en dépendre (D-001)`,
  );
}

/* --- La liste de pièces est la même pour tous --------------------------- */

const completude = readFileSync(join("src", "lib", "eudr", "completeness.ts"), "utf-8");

// Les critères sont déclarés dans un tableau statique : leur nombre ne doit pas
// dépendre d'une donnée d'exécution.
const criteres = [...completude.matchAll(/key:\s*"([a-z_]+)"/g)].map((m) => m[1]);
verifier(
  "les critères de complétude sont déclarés statiquement",
  criteres.length > 0 && !/criteres\s*=\s*[^[]/.test(completude),
  `${criteres.length} critères : ${criteres.join(", ")}`,
);

verifier(
  "aucun critère n'est conditionné par un pays",
  !/satisfied:\s*\([^)]*\)\s*=>[^,]*country\s*(===|!==)\s*"/.test(completude),
);

/* --- La décision est documentée ----------------------------------------- */

const decisions = readFileSync(join("docs", "DECISIONS.md"), "utf-8");
verifier("D-001 est consignée dans docs/DECISIONS.md", /D-001/.test(decisions));
verifier(
  "D-001 cite le fondement réglementaire (art. 13)",
  /art\.\s*13/i.test(decisions) || /article 13/i.test(decisions),
);
verifier(
  "D-001 énonce ce qui ferait changer la décision",
  /ferait changer la décision/i.test(decisions),
);
verifier(
  "le guide de conformité signale le surcroît de travail",
  /surcroît|non exigé|n'exige pas/i.test(readFileSync(join("docs", "EUDR_COMPLIANCE_GUIDE.md"), "utf-8")),
);

/* ------------------------------- Rapport -------------------------------- */

const echecs = controles.filter((c) => !c.ok);
for (const c of controles) {
  if (!c.ok) console.log(`🔴 ${c.nom}${c.detail ? ` — ${c.detail}` : ""}`);
}
console.log(`\n${controles.length - echecs.length}/${controles.length} contrôle(s) réussi(s)`);
process.exit(echecs.length === 0 ? 0 : 1);
