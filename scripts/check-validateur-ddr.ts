/**
 * Prouve, écart par écart, qu'un dossier de diligence raisonnée n'est validé
 * par **rien** aujourd'hui.
 *
 * ⚠️ Pourquoi ce contrôle est ROUGE, et pourquoi c'est le résultat attendu.
 *
 *   La route `PATCH /api/v1/due-diligence/[id]` accepte `status` et
 *   `completenessScore` dans le même corps. Aucune condition ne précède
 *   `patch.status = next` hormis la table `TRANSITIONS`. Un dossier créé par
 *   `POST` — donc `plotsCount: 0`, `completenessScore: 0`, aucun fournisseur,
 *   aucune tâche — peut donc passer `READY_FOR_DECLARATION` en un clic, et
 *   recevoir `completenessScore: 100` dans la même requête.
 *
 *   Écrire la correction d'abord aurait produit un contrôle qui épouse la
 *   correction : vert par construction, sans avoir jamais rien prouvé. Ici,
 *   l'ordre est inversé — le contrôle est écrit contre le défaut, il échoue
 *   tant que le défaut existe, et il passera quand le dossier sera réellement
 *   examiné.
 *
 * ⚠️ Ce que ce contrôle N'EST PAS : une barrière de CI.
 *
 *   Il ne doit pas être branché dans `.github/workflows/ci.yml` avant la
 *   correction. Une barrière rouge en permanence ne protège rien : elle bloque
 *   toutes les fusions et pousse à contourner le dispositif. Il s'exécute à la
 *   demande, comme preuve jointe au diagnostic C7.
 *
 * Usage : npm run check:validateur-ddr
 * Sortie : 0 si le dossier est réellement validé (aujourd'hui impossible),
 *          1 si un écart subsiste (état actuel).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { niveauRisqueParcelle, constatDepuisAnalyse } from "../src/lib/eudr/risque-parcelle";
import { examinerDossier, type DossierAExaminer } from "../src/lib/eudr/validateur-dossier";
import { verifierOrigineExportable } from "../src/lib/eudr/origine-exportable";
import type { RiskLevel } from "../src/lib/eudr/types";

interface Controle {
  nom: string;
  /** Écart constaté, en clair. `null` quand la condition est tenue. */
  ecart: string | null;
  /** Ce que la correction devra satisfaire. */
  attendu: string;
}

const controles: Controle[] = [];

function ecart(nom: string, constate: string | null, attendu: string): void {
  controles.push({ nom, ecart: constate, attendu });
}

/* ------------------------------------------------------------------------- *
 * 1. Ce que la route accepte du client
 * ------------------------------------------------------------------------- */

const routeDossier = readFileSync(
  join("src", "app", "api", "v1", "due-diligence", "[id]", "route.ts"),
  "utf-8",
);

/**
 * ⚠️ Contrôle STRUCTUREL, pas lexical.
 *
 *   Chercher `completenessScore` dans le fichier serait toujours vert : le
 *   champ figure aussi dans les réponses `GET` et `PATCH`, où il est légitime.
 *   Ce qui est fautif, c'est qu'il soit **écrit depuis le corps de la
 *   requête**. On isole donc le bloc `if (body.completenessScore !== undefined)`
 *   et on exige qu'il n'assigne plus rien.
 */
const blocScoreRecu = /if \(body\.completenessScore !== undefined\) \{[\s\S]*?\n  \}/.exec(routeDossier);
const scoreEcritDepuisLeClient = blocScoreRecu !== null && /patch\.completenessScore\s*=/.test(blocScoreRecu[0]);
ecart(
  "le score de complétude n'est pas reçu du client",
  scoreEcritDepuisLeClient
    ? "`patch.completenessScore = Math.round(score)` : le client fixe lui-même la complétude de son dossier"
    : null,
  "le score doit être calculé à partir des données du dossier, comme `supplierCompleteness()` le fait pour les fournisseurs",
);

/**
 * ⚠️ Le cœur du défaut.
 *
 *   On accepte un `READY_FOR_DECLARATION` **sans aucune vérification** dès lors
 *   que la table `TRANSITIONS` l'autorise. Il faut donc prouver qu'aucun appel
 *   à un validateur ne précède l'affectation, et non simplement constater
 *   l'absence du mot « validateur ».
 *
 *   Formulation retenue : entre l'entrée dans `if (body.status !== undefined)`
 *   et `patch.status = next`, aucune fonction de contrôle n'est appelée.
 */
// ⚠️ Deuxième correction de ce contrôle, et la raison.
//
//   Chercher `examiner(` entre `if (body.status …` et `patch.status = next`
//   restait VERT après avoir remplacé la condition par `if (false)` : le texte
//   de l'appel était toujours là, simplement inatteignable. C'est le même piège
//   que la branche `if False:` du backend, rencontré une seconde fois.
//
//   On exige donc la condition EXACTE, sans rien de plus — `if (next ===
//   "READY_FOR_DECLARATION") {` et pas `… && false) {` — et, à l'intérieur, un
//   refus en 409. Une condition élargie ou désactivée fait donc rougir.
const blocStatut = /if \(next === "READY_FOR_DECLARATION"\) \{([\s\S]*?)\n    \}/.exec(routeDossier);
const controleAvantStatut =
  blocStatut !== null && /examiner\s*\(/.test(blocStatut[1]) && /status:\s*409/.test(blocStatut[1]);
ecart(
  "READY_FOR_DECLARATION n'est pas atteignable sans examen du dossier",
  blocStatut === null
    ? "aucune condition littérale `if (next === \"READY_FOR_DECLARATION\")` : la transition est soit absente, soit élargie"
    : !controleAvantStatut
      ? "`TRANSITIONS` est le seul filtre : un dossier vide passe « prêt à déclarer »"
      : null,
  "la transition vers READY_FOR_DECLARATION doit appeler un validateur et renvoyer 409 en énumérant les manques",
);

/* ------------------------------------------------------------------------- *
 * 2. Ce que la route transmet à l'export
 * ------------------------------------------------------------------------- */

/**
 * ⚠️ L'export TRACES raisonne par parcelle auditée, le dossier par produit.
 *   Ce n'est pas forcément une faute — mais tant que ce n'est pas explicité,
 *   chacun des deux écrans laisse croire que l'autre a validé.
 */
const routeExport = readFileSync(join("src", "app", "api", "v1", "export", "traces", "route.ts"), "utf-8");
//
// ⚠️ Ce que ce contrôle exigeait, et qui était la mauvaise exigence.
//
//   Première version : « l'export doit citer le dossier, ou expliquer ».
//   Or rattacher l'export à un dossier n'est pas correct — un produit agrège
//   plusieurs parcelles, et choisir « la » parcelle preuve serait arbitraire.
//   Le bon critère n'est pas l'existence d'un lien, c'est que la limite soit
//   ÉCRITE : deux constats indépendants qui n'en disent rien laissent croire
//   que l'un vaut preuve de l'autre.
ecart(
  "la différence de grain entre export et dossier est écrite",
  /dueDiligenceStatements|diligenceId|ddsId/.test(routeExport) ||
    /unit[ée] de d[ée]claration/i.test(routeExport)
    ? null
    : "l'export valide une parcelle auditée et ne dit rien du dossier : un dossier « prêt » peut coexister avec un export impossible sans que rien ne le signale",
  "l'export doit énoncer que le dossier et l'export sont deux constats INDÉPENDANTS, et pourquoi le grain diffère (D-005)",
);

/* ------------------------------------------------------------------------- *
 * 3. Les données du dossier sont-elles calculées, ou reçues ?
 * ------------------------------------------------------------------------- */

/**
 * ⚠️ `plotsCount` et `totalAreaHa` ne sont écrits par aucun code du produit :
 *   ils restent à 0. Un dossier peut donc être « prêt » en déclarant zéro
 *   parcelle et zéro hectare.
 */
const sourcesProduit = [
  readFileSync(join("src", "app", "api", "v1", "due-diligence", "route.ts"), "utf-8"),
  routeDossier,
].join("\n");
ecart(
  "le nombre de parcelles et la surface du dossier sont calculés, pas hérités de zéro",
  /plotsCount\s*:\s*sql|patch\.plotsCount\s*=|set\(\{[^}]*plotsCount/.test(sourcesProduit)
    ? null
    : "`plotsCount` et `totalAreaHa` ne sont écrits nulle part : ils valent 0 pour tout dossier, quel que soit son contenu",
  "les deux champs doivent être dérivés des parcelles rattachées, jamais laissés à leur valeur par défaut",
);

/* ------------------------------------------------------------------------- *
 * 4. La condition la plus structurante du règlement est-elle représentable ?
 * ------------------------------------------------------------------------- */

/**
 * ⚠️ Article 9(1)(f) : la date ou la période de production, par produit.
 *   Sans elle, la date butoir du 31/12/2020 ne peut pas être vérifiée — or
 *   c'est la condition qui décide de la conformité d'une parcelle.
 */
// ⚠️ Première version de ce contrôle : elle cherchait un champ *nommé* comme une
//   période de production. C'était une fausse exigence — le SCHÉMA la portait
//   déjà sous un autre nom, et le validateur la lisait.
//
//   `parcel_audits.harvest_date` EST la date de production : l'audit exige un
//   format ISO et refuse le futur (`audit/parcel/route.ts:120-123`), et c'est
//   elle qui entre dans l'analyse satellite. Ce qui manquait n'était ni la
//   donnée ni le champ, mais son EXPLOITATION par le dossier : le validateur ne
//   la lisait pas.
//
//   Le contrôle porte donc désormais sur ce qui compte — la donnée est-elle
//   transportée jusqu'à l'examen — et non sur le nom d'une colonne.
const schema = readFileSync(join("src", "db", "schema.ts"), "utf-8");
const validateur = readFileSync(join("src", "lib", "eudr", "validateur-dossier.ts"), "utf-8");
ecart(
  "la période de production est représentable et examinée",
  /harvest_date/i.test(schema)
    ? /PERIODE_PRODUCTION_ABSENTE/.test(validateur) && /harvestDate/.test(validateur)
      ? null
      : "`harvest_date` existe en base mais le validateur ne la lit pas : la condition du 31/12/2020 n'est pas vérifiable"
    : "aucune date de production dans `src/db/schema.ts` : la condition du 31/12/2020 n'est pas vérifiable",
  "le validateur doit refuser un dossier dont une parcelle n'a pas de date de production (art. 9(1)(f))",
);

/* ------------------------------------------------------------------------- *
 * 5. Les briques de verdict existent-elles, et disent-elles la même chose ?
 * ------------------------------------------------------------------------- *
 *
 *   On n'invente pas de règle ici : on constate que les fonctions qui
 *   portent déjà un verdict réglementaire ne sont appelées nulle part depuis le
 *   chemin du dossier. Les exécuter prouve qu'elles sont utilisables, ce qui
 *   rend la correction possible sans réécrire la logique.
 */

const niveauSimule = niveauRisqueParcelle(constatDepuisAnalyse("simulated", true), "LOW" as RiskLevel);
ecart(
  "une simulation ne produit aucun niveau de risque de parcelle",
  niveauSimule === null ? null : `une simulation a produit « ${niveauSimule} »`,
  "une analyse de démonstration ne doit jamais alimenter un dossier de diligence (P0-04)",
);

const niveauSansAnalyse = niveauRisqueParcelle(constatDepuisAnalyse("unavailable", null), "LOW" as RiskLevel);
ecart(
  "une analyse indisponible ne produit aucun niveau de risque de parcelle",
  niveauSansAnalyse === null ? null : `une analyse absente a produit « ${niveauSansAnalyse} »`,
  "l'absence de mesure ne doit jamais se lire comme une absence de risque",
);

const origineSansPays = verifierOrigineExportable("HORS_COUVERTURE", "XX");
ecart(
  "une origine non résolue bloque l'export",
  origineSansPays.exportable === false ? null : "une origine « XX » a été déclarée exportable",
  "on n'exporte pas ce qu'on ne sait pas nommer",
);

/**
 * ⚠️ Ces trois briques sont vertes. C'est précisément ce qui rend la correction
 *   peu coûteuse : la logique de verdict existe et fonctionne, elle n'est
 *   simplement branchée sur rien. Le contrôle le dit, pour que la correction
 *   ne consiste pas à la réécrire.
 */
//
// ⚠️ Le premier jet cherchait ces appels dans la ROUTE. C'était l'endroit où le
//   défaut se manifestait, pas l'endroit où il se corrige : le validateur est un
//   module pur, et c'est lui qui doit réutiliser les verdicts existants plutôt
//   que les réimplémenter. On cherche donc l'appel là où il doit être.
ecart(
  "le validateur réutilise les briques de verdict existantes",
  /verifierOrigineExportable\s*\(/.test(validateur) && /examinerDossier/.test(sourcesProduit)
    ? null
    : "`verifierOrigineExportable` n'est pas appelé par le validateur, ou le validateur n'est pas appelé par la route",
  "le même verdict réglementaire ne doit pas exister en deux exemplaires : les deux finiraient par diverger",
);

/* ------------------------------------------------------------------------- *
 * 6. Le validateur REFUSE un dossier vide — exécuté, pas lu
 * ------------------------------------------------------------------------- *
 *
 *   ⚠️ Les contrôles ci-dessus lisent du code. Ceux-ci EXÉCUTENT le validateur
 *   sur des dossiers construits pour être refusés. Un contrôle qui n'exécute
 *   rien finit par vérifier que le code ressemble à une correction.
 */

const AUJOURDHUI = "2026-11-06";

function dossierMinimal(surcharge: Partial<DossierAExaminer> = {}): DossierAExaminer {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    status: "UNDER_REVIEW",
    supplierId: "00000000-0000-0000-0000-000000000002",
    productId: null,
    commodity: "cocoa",
    parcelles: [],
    taches: [],
    ...surcharge,
  };
}

/** Une parcelle complète et conforme, pour isoler le manque qu'on veut prouver. */
function parcelleValide() {
  return {
    id: "00000000-0000-0000-0000-000000000003",
    name: "Parcelle A",
    status: "COMPLIANT",
    countryCode: "CI",
    countryStatut: "RESOLU",
    areaHa: 2.5,
    derniereAnalyse: {
      analysisSource: "gfw-live",
      analysisProbative: true,
      status: "COMPLIANT",
      harvestDate: "2026-03-15",
    },
    documents: [
      { id: "d1", category: "LAND_TENURE", status: "VALID", expiryDate: null },
      { id: "d2", category: "HARVEST_PERMIT", status: "VALID", expiryDate: "2027-01-01" },
    ],
  };
}

// 1. Le dossier vide est refusé, et le refus nomme la cause.
const vide = examinerDossier(dossierMinimal(), AUJOURDHUI);
ecart(
  "un dossier vide n'est pas déclaré complet",
  vide.complet === false && vide.manques.some((m) => m.code === "SANS_PARCELLE")
    ? null
    : `le dossier vide est déclaré complet=${vide.complet} avec ${vide.manques.length} manque(s)`,
  "aucune parcelle ⇒ jamais « prêt à déclarer »",
);
ecart(
  "le score d'un dossier vide reste bas",
  vide.score < 50 ? null : `score ${vide.score} sur un dossier sans aucune parcelle`,
  "un dossier non validable ne peut pas afficher une complétude élevée",
);

// 2. Une simulation de démonstration bloque le dossier.
const simule = examinerDossier(
  dossierMinimal({
    parcelles: [
      {
        ...parcelleValide(),
        derniereAnalyse: { ...parcelleValide().derniereAnalyse, analysisSource: "simulated", analysisProbative: false },
      },
    ],
  }),
  AUJOURDHUI,
);
ecart(
  "une analyse simulée empêche la déclaration",
  simule.complet === false && simule.manques.some((m) => m.code === "ANALYSE_NON_PROBANTE")
    ? null
    : "un dossier fondé sur une simulation a été déclaré complet",
  "P0-04 : une démonstration ne peut pas alimenter une déclaration",
);

// 3. Une date de production absente bloque le dossier.
const sansDate = examinerDossier(
  dossierMinimal({
    parcelles: [{ ...parcelleValide(), derniereAnalyse: { ...parcelleValide().derniereAnalyse, harvestDate: null } }],
  }),
  AUJOURDHUI,
);
ecart(
  "une date de production absente empêche la déclaration",
  sansDate.complet === false && sansDate.manques.some((m) => m.code === "PERIODE_PRODUCTION_ABSENTE")
    ? null
    : "un dossier sans date de production a été déclaré complet",
  "art. 9(1)(f) : sans date de production, la condition du 31/12/2020 n'est pas vérifiable",
);

// 4. Une mesure d'atténuation ouverte bloque le dossier.
const tacheOuverte = examinerDossier(
  dossierMinimal({ parcelles: [parcelleValide()], taches: [{ id: "t1", status: "TO_HANDLE", severity: "HIGH" }] }),
  AUJOURDHUI,
);
ecart(
  "une mesure d'atténuation ouverte empêche la déclaration",
  tacheOuverte.complet === false && tacheOuverte.manques.some((m) => m.code === "ATTENUATION_INCOMPLETE")
    ? null
    : "un dossier avec une mesure ouverte a été déclaré complet",
  "une déclaration ne couvre pas un risque identifié et non traité",
);

// 5. Une origine non résolue bloque le dossier.
const origineInconnue = examinerDossier(
  dossierMinimal({ parcelles: [{ ...parcelleValide(), countryCode: "XX", countryStatut: "HORS_COUVERTURE" }] }),
  AUJOURDHUI,
);
ecart(
  "une origine non établie empêche la déclaration",
  origineInconnue.complet === false && origineInconnue.manques.some((m) => m.code === "ORIGINE_NON_ETABLIE")
    ? null
    : "un dossier d'origine inconnue a été déclaré complet",
  "on ne déclare pas ce qu'on ne sait pas nommer",
);

// 6. ET, symétriquement : un dossier complet EST accepté.
//
// ⚠️ Sans ce cas, le validateur pourrait refuser TOUT et passer les cinq
//   précédents. Un validateur qui refuse toujours n'est pas un validateur :
//   c'est un mur — exactement ce que D-004 reproche aux barrières rouges.
const complet = examinerDossier(dossierMinimal({ parcelles: [parcelleValide()] }), AUJOURDHUI);
ecart(
  "un dossier complet est accepté (le validateur n'est pas un mur)",
  complet.complet === true
    ? null
    : `un dossier conforme est refusé : ${complet.manques.map((m) => m.code).join(", ")}`,
  "un dossier étayé doit pouvoir être déclaré prêt, sinon le dispositif est inutilisable",
);

/* --------------------------------- Rapport ------------------------------- */

const enEcart = controles.filter((c) => c.ecart !== null);

console.log("Validateur de dossier DDR — état constaté\n");
for (const c of controles) {
  if (c.ecart === null) {
    console.log(`  ✅ ${c.nom}`);
  } else {
    console.log(`  🔴 ${c.nom}`);
    console.log(`     constaté : ${c.ecart}`);
    console.log(`     attendu  : ${c.attendu}`);
  }
}

console.log(`\n${controles.length - enEcart.length}/${controles.length} condition(s) tenue(s)`);
if (enEcart.length > 0) {
  console.log(
    "\n🔴 Le dossier de diligence raisonnée n'est validé par rien : un statut\n" +
      "   « prêt à déclarer » y est une affirmation de l'utilisateur, pas un\n" +
      "   constat du produit.",
  );
}
process.exit(enEcart.length === 0 ? 0 : 1);
