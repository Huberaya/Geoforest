/**
 * Lot A — identité de l'opérateur, côté TypeScript.
 *
 * Exécution : npx tsx --conditions=react-server scripts/check-identite-operateur.ts
 *
 * ⚠️ Ce que ces contrôles empêchent de réintroduire.
 *
 * La route d'audit écrivait, pour tout opérateur absent, un triplet de
 * remplissage (« Opérateur non renseigné » / XX0000000000000 / XX) dans des
 * colonnes `NOT NULL`. L'export reprenait ensuite `row.operatorEori` sans
 * contrôle : un dossier **faussement complet** partait en déclaration.
 *
 * Un seul test ne suffit pas ici : la règle doit tenir sur les trois chemins
 * qui comptent — création, classification, export — et sur les quatre sortes
 * de données réellement rencontrées : identités valides, données nulles,
 * dossiers hérités, données vides (chaîne vide, espaces).
 */
import {
  classerIdentiteOperateur,
  EORI_PLACEHOLDER_HISTORIQUE,
  resoudreIdentiteExport,
} from "../src/lib/eudr/identite-operateur";

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

// --------------------------------------------------------------- 1. Classement
section("1. Trois états, jamais confondus");

const cas: Array<[string, string | null, string | null, string]> = [
  ["identité valide", "Café Import SAS", "FR12345678901234", "declared"],
  ["identité absente (null)", null, null, "missing"],
  ["identité absente (chaîne vide)", "", "", "missing"],
  ["identité absente (espaces)", "   ", "   ", "missing"],
  ["EORI seul, sans nom", null, "FR12345678901234", "missing"],
  ["nom d'un seul caractère", "A", "FR12345678901234", "missing"],
  ["nom sans EORI", "Café Import SAS", null, "missing"],
  ["placeholder hérité", "Opérateur non renseigné", EORI_PLACEHOLDER_HISTORIQUE, "legacy_placeholder"],
  ["placeholder hérité, nom changé", "Autre chose", EORI_PLACEHOLDER_HISTORIQUE, "legacy_placeholder"],
];

for (const [libelle, nom, eori, attendu] of cas) {
  const resultat = classerIdentiteOperateur(nom, eori);
  check(libelle, resultat.etat === attendu, `${resultat.etat} (attendu ${attendu})`);
}

check(
  "seul `declared` est exportable",
  classerIdentiteOperateur("Café Import SAS", "FR12345678901234").exportable === true &&
    classerIdentiteOperateur(null, null).exportable === false &&
    classerIdentiteOperateur("Opérateur non renseigné", EORI_PLACEHOLDER_HISTORIQUE).exportable === false,
);

check(
  "un dossier hérité est reconnu sans être réécrit",
  classerIdentiteOperateur("Opérateur non renseigné", EORI_PLACEHOLDER_HISTORIQUE).etat ===
    "legacy_placeholder" &&
    EORI_PLACEHOLDER_HISTORIQUE === "XX0000000000000",
);

check(
  "la raison d'un refus distingue « absente » de « héritée »",
  classerIdentiteOperateur(null, null).raison !==
    classerIdentiteOperateur(null, EORI_PLACEHOLDER_HISTORIQUE).raison,
);

// ------------------------------------------------------- 2. Placeholder exact
section("2. La valeur de remplissage est unique et connue");

check("constante exportée", EORI_PLACEHOLDER_HISTORIQUE === "XX0000000000000");
check(
  "la casse et les espaces ne créent pas un faux « déclaré »",
  classerIdentiteOperateur("Nom", " xx0000000000000 ").exportable === false,
  classerIdentiteOperateur("Nom", " xx0000000000000 ").etat,
);
check(
  "un EORI réellement préfixé XX n'est pas confondu avec le placeholder",
  classerIdentiteOperateur("Opérateur légitime", "XX12345678901234").etat === "declared",
);


// ------------------------------------------------- 3. Décision d'export
section("3. Décision d'export : refus explicite, aucun repli inventé");

const stockeVide = { name: null, eori: null, country: null, address: null };
const stockeHerite = {
  name: "Opérateur non renseigné",
  eori: EORI_PLACEHOLDER_HISTORIQUE,
  country: "XX",
  address: null,
};
const stockeValide = {
  name: "Café Import SAS",
  eori: "FR12345678901234",
  country: "FR",
  address: "1 rue du Port",
};
const operateurRequete = { name: "Nouvelle SAS", eori: "DE12345678901234" };

const avecVide = resoudreIdentiteExport(stockeVide, undefined);
check(
  "dossier sans identité + aucune identité en requête → refus",
  avecVide.statut === "refus" && avecVide.etat === "missing",
  avecVide.statut,
);

const avecHerite = resoudreIdentiteExport(stockeHerite, null);
check(
  "dossier hérité → refus, état `legacy_placeholder` (pas `missing`)",
  avecHerite.statut === "refus" && avecHerite.etat === "legacy_placeholder",
  avecHerite.statut === "refus" ? avecHerite.etat : avecHerite.statut,
);

const heriteComplete = resoudreIdentiteExport(stockeHerite, operateurRequete);
check(
  "dossier hérité + identité fournie à l'export → export possible",
  heriteComplete.statut === "ok" && heriteComplete.source === "requete",
  heriteComplete.statut,
);

const valideSeul = resoudreIdentiteExport(stockeValide, undefined);
check(
  "dossier renseigné → identité du dossier retenue",
  valideSeul.statut === "ok" && valideSeul.source === "dossier" && valideSeul.operator.eori === "FR12345678901234",
);

const prioriteRequete = resoudreIdentiteExport(stockeValide, operateurRequete);
check(
  "identité de requête prioritaire sur celle du dossier",
  prioriteRequete.statut === "ok" && prioriteRequete.operator.eori === "DE12345678901234",
);

const eoriInvalide = resoudreIdentiteExport(stockeVide, { name: "X", eori: "123" });
check(
  "identité de requête invalide → refus explicite (jamais un statut ok)",
  eoriInvalide.statut === "invalide",
  eoriInvalide.statut,
);

const paysDeduit = resoudreIdentiteExport(stockeVide, { name: "Sans Pays", eori: "se12345678901234" });
check(
  "pays absent → déduit du préfixe EORI, jamais 'FR' par défaut",
  paysDeduit.statut === "ok" && paysDeduit.operator.country === "SE",
  paysDeduit.statut === "ok" ? paysDeduit.operator.country : paysDeduit.statut,
);

// ---------------------------------------------------------------- 4. Synthèse
console.log(`\n${passed} contrôle(s) passé(s), ${failures.length} échec(s).`);
if (failures.length > 0) {
  for (const f of failures) console.error(`  🔴 ${f}`);
  process.exit(1);
}
