/**
 * Contrôle de cohérence entre la documentation et le code.
 *
 * ⚠️ Pourquoi ce script existe.
 *
 *   `docs/TEST_REPORT.md` a affirmé pendant des semaines « 29/29 tests pytest »,
 *   « 25 routes applicatives » et « CSP applicative ». Les trois étaient faux.
 *   Aucun outil ne l'a signalé : une documentation ne casse pas de build.
 *
 *   Réécrire les documents ne suffit pas — ils redeviendront faux au premier
 *   ajout de route, au premier test ajouté, à la première page créée. Ce script
 *   transforme quelques affirmations chiffrées en **contraintes vérifiables**,
 *   et échoue quand elles divergent.
 *
 * ⚠️ Ce qu'il ne peut pas faire : vérifier qu'une phrase est vraie. Il vérifie
 *   des **nombres et des noms**, pas des intentions. Le reste relève de la
 *   relecture humaine.
 *
 * Usage : npm run check:docs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PAYS_RISQUE_ELEVE, PAYS_RISQUE_FAIBLE } from "../src/lib/eudr/benchmark-pays";

interface Controle {
  nom: string;
  ok: boolean;
  detail: string;
}

const controles: Controle[] = [];

function verifier(nom: string, ok: boolean, detail: string): void {
  controles.push({ nom, ok, detail });
  console.log(`${ok ? "✅" : "🔴"} ${nom}`);
  if (!ok) console.log(`   ${detail}`);
}

function compter(racine: string, nomFichier: string): number {
  let total = 0;
  const parcourir = (dossier: string): void => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name);
      if (entree.isDirectory()) parcourir(chemin);
      else if (entree.name === nomFichier) total += 1;
    }
  };
  if (existsSync(racine)) parcourir(racine);
  return total;
}

function lire(chemin: string): string {
  try {
    return readFileSync(chemin, "utf-8");
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------------------- */

const pages = compter("src/app", "page.tsx");
const routesApi = compter("src/app/api", "route.ts");
const rapport = lire("docs/TEST_REPORT.md");

verifier(
  "docs/TEST_REPORT.md existe",
  rapport.length > 0,
  "document absent : plus rien ne documente l'état réel des tests",
);

// Le rapport annonce un décompte de routes. Il doit correspondre au code, à la
// tolérance près des routes internes que Next ajoute (`_not-found`).
// ⚠️ La formule accepte un mot intercalé (« routes sources ») : le build
//   produit une route de plus que les sources (`_not-found`), et le rapport
//   doit pouvoir dire les deux sans que le contrôle s'y perde.
const annonce = /(\d+)\s+routes?\b[^(]*\(\s*(\d+)\s+API\s*\+\s*(\d+)\s+pages?/i.exec(rapport);
verifier(
  "le décompte de routes du rapport correspond au code",
  annonce !== null &&
    Number(annonce[2]) === routesApi &&
    Number(annonce[3]) === pages,
  annonce
    ? `rapport : ${annonce[2]} API + ${annonce[3]} pages ; code : ${routesApi} API + ${pages} pages`
    : `aucun décompte trouvé dans le rapport (code : ${routesApi} API + ${pages} pages)`,
);

// Les 3 tests géospatiaux du backend portent sur des routes inexistantes.
// Le rapport doit le dire ; s'il ne le dit plus, c'est que la situation a
// changé sans que la documentation suive.
verifier(
  "le rapport mentionne les 3 tests backend ignorés",
  /3\s+(tests?\s+)?ignor|41\s+réussis,\s*3\s+ignor/i.test(rapport),
  "le rapport ne signale plus les 3 tests ignorés",
);

// ⚠️ Le rapport ne doit pas se présenter comme une « Production Release » tant
//   que l'application déployée n'a pas été vérifiée. C'était l'erreur d'origine.
verifier(
  "le rapport ne s'intitule pas « Production Release »",
  !/v1\.0\.0\s*\(Production Release\)/i.test(rapport),
  "intitulé « Production Release » : l'application déployée n'a jamais été vérifiée",
);

/* --- Sources satellites : une seule est implémentée ---------------------- */

const satellite = lire("src/lib/eudr/satellite-checker.ts");
const architecture = lire("docs/ARCHITECTURE.md");
const guide = lire("docs/EUDR_COMPLIANCE_GUIDE.md");

const sentinelCode = /sentinel/i.test(satellite);
const worldcoverCode = /worldcover|world_cover/i.test(satellite);

// ⚠️ Contrôle volontairement grossier : il ne juge pas la formulation, il
//   exige qu'une source absente du code soit **signalée comme absente** dans
//   les deux documents. C'est la formulation exacte qui était fausse avant :
//   Sentinel-2 et WorldCover figuraient dans le diagramme d'architecture.
if (!sentinelCode || !worldcoverCode) {
  const absentsDuCode = [
    !sentinelCode ? "Sentinel-2" : null,
    !worldcoverCode ? "WorldCover" : null,
  ].filter(Boolean) as string[];

  for (const source of absentsDuCode) {
    const signalee =
      new RegExp(`${source}[^\\n]*(absent|non impl|ABSENT)`, "i").test(architecture) ||
      new RegExp(`${source}[^\\n]*(absent|non impl|ABSENT)`, "i").test(guide);
    verifier(
      `${source} : absent du code, signalé comme tel dans la documentation`,
      signalee,
      `« ${source} » n'est pas implémenté dans src/lib/eudr/, mais aucun document ne le dit`,
    );
  }
}

/* --- En-têtes de sécurité : valeurs réelles ------------------------------ */

const proxy = lire("src/proxy.ts");

verifier(
  "la CSP est décrite comme Report-Only si elle l'est",
  !/Content-Security-Policy-Report-Only/.test(proxy) ||
    /Report-Only/.test(architecture),
  "src/proxy.ts pose une CSP en Report-Only, mais ARCHITECTURE.md ne le mentionne pas",
);

verifier(
  "HSTS : « preload » n'est annoncé que s'il est posé",
  /preload/.test(proxy) || !/includeSubDomains;\s*preload/.test(architecture),
  "ARCHITECTURE.md annonce un HSTS preload que src/proxy.ts ne pose pas",
);

/* --- Chiffres du dispositif pays cités dans les documents ---------------- */
/*
 * ⚠️ Depuis C6, le guide affirme des nombres précis : 140 pays LOW, 4 HIGH,
 *   52 cas de banc, 19 contrôles de référentiel, 16 de frontières. Ces nombres
 *   sont exactement le genre d'affirmation qui se périme en silence — le défaut
 *   d'origine de TEST_REPORT.md. On les recompte ici.
 */
const guidePays = lire(join("docs", "EUDR_COMPLIANCE_GUIDE.md"));
// ⚠️ Compté en important le module, pas en comptant des lignes de texte : un
//   comptage par expression régulière a rendu 144 pour les deux listes, ce qui
//   aurait validé n'importe quel chiffre annoncé.
const nbLow = Object.keys(PAYS_RISQUE_FAIBLE).length;
const nbHigh = Object.keys(PAYS_RISQUE_ELEVE).length;

verifier(
  "le guide annonce les effectifs réels de l'annexe",
  guidePays.includes(`${nbLow} LOW`) && guidePays.includes(`${nbHigh} HIGH`),
  `référentiel : ${nbLow} LOW, ${nbHigh} HIGH — le guide doit annoncer les mêmes`,
);

// ⚠️ Le guide ne doit plus décrire le dispositif par rectangles comme actuel.
verifier(
  "le guide ne présente plus la résolution par rectangle comme active",
  !/Le pays est résolu par \*\*rectangle englobant\*\*/.test(guidePays),
  "le guide décrit encore les rectangles englobants comme dispositif en vigueur",
);

// La rectification de C3 doit rester consignée : retirer une erreur en silence
// la rend invisible à qui relira l'historique.
verifier(
  "la rectification de l'affirmation sur les pays tiers est conservée",
  /Rectification d'une affirmation antérieure/.test(guidePays),
  "la correction de l'erreur « ni faible ni standard par construction » a disparu",
);

/* --- Provenance : décrire le dispositif réellement utilisé --------------- */

const checker = lire(join("src", "lib", "eudr", "satellite-checker.ts"));
verifier(
  "la provenance ne cite pas un dispositif de résolution disparu",
  !/resolution_pays:\s*"boîte englobante"/.test(checker),
  "la provenance persistée annonce encore « boîte englobante » : elle décrirait un dispositif qui n'existe plus",
);

/* --- Aucun document ne cite un résultat de test en dur ------------------ */
/*
 * ⚠️ `DEPLOYMENT_VERCEL.md` affirmait « Pytest 29/29 » alors que la suite en
 *   compte 41. C'est le même défaut que TEST_REPORT.md : un chiffre recopié
 *   dans un document censé décrire le déploiement, et faux depuis longtemps.
 *   Un compte de tests n'a pas sa place dans une procédure : il périme seul.
 */
const docsAvecComptesDeTests = readdirSync("docs")
  .filter((f) => f.endsWith(".md") && f !== "TEST_REPORT.md")
  .map((f) => ({ fichier: f, contenu: lire(join("docs", f)) }))
  .filter(({ contenu }) => /(Pytest|pytest)[^.]*\d+\s*\/\s*\d+/.test(contenu));

verifier(
  "aucun document hors TEST_REPORT ne cite un compte de tests en dur",
  docsAvecComptesDeTests.length === 0,
  docsAvecComptesDeTests.map((d) => d.fichier).join(", "),
);

/* --- Dates réglementaires ------------------------------------------------ */

// ⚠️ Les échéances EUDR ont été reportées deux fois. Une documentation qui
//   annonce encore 2025 est périmée, et une échéance fausse est un risque
//   commercial autant que juridique.
verifier(
  "le guide de conformité cite l'échéance en vigueur (30/12/2026)",
  /30\/12\/2026/.test(guide),
  "docs/EUDR_COMPLIANCE_GUIDE.md ne cite pas l'échéance du 30/12/2026",
);

verifier(
  "le guide ne présente pas 2025 comme échéance d'application",
  !/application\s+(au|le)\s+30\/12\/2025/i.test(guide),
  "échéance 2025 encore présentée comme applicable : elle a été reportée",
);

/* -------------------------------------------------------------------------- */

const echecs = controles.filter((c) => !c.ok);
console.log(`\n${controles.length - echecs.length}/${controles.length} contrôle(s) réussi(s)`);
process.exit(echecs.length === 0 ? 0 : 1);
