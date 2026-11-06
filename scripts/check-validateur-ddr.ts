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
const blocStatut = /if \(body\.status !== undefined\) \{[\s\S]*?patch\.status = next;/.exec(routeDossier);
const controleAvantStatut =
  blocStatut !== null && /(valid\w*|verifi\w*|examin\w*|controle\w*)\s*\(/i.test(blocStatut[0]);
ecart(
  "READY_FOR_DECLARATION n'est pas atteignable sans examen du dossier",
  blocStatut === null
    ? "le bloc de transition est introuvable : le contrôle doit être mis à jour, pas contourné"
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
ecart(
  "l'export ne se réclame pas d'un dossier de diligence",
  /dueDiligenceStatements|diligenceId|ddsId/.test(routeExport)
    ? null
    : "l'export valide une parcelle auditée et ignore le dossier : un dossier « prêt » peut coexister avec un export impossible, et l'inverse",
  "soit l'export rattache son résultat au dossier, soit il est écrit que leurs grains diffèrent — et pourquoi c'est acceptable",
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
  /plotsCount\s*:\s*sql|plotsCount\s*:\s*[a-zA-Z]+\s*\?|set\(\{[^}]*plotsCount/.test(sourcesProduit)
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
const schema = readFileSync(join("src", "db", "schema.ts"), "utf-8");
ecart(
  "la période de production est représentable",
  /production_(date|period)|date_production|periode_production/i.test(schema)
    ? null
    : "aucun champ de date ni de période de production dans `src/db/schema.ts` : la condition du 31/12/2020 n'est pas vérifiable",
  "un champ de période de production doit exister sur la parcelle ou sur le dossier (art. 9(1)(f)) — migration à décider",
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
ecart(
  "les briques de verdict sont utilisables depuis le chemin du dossier",
  /niveauRisqueParcelle|verifierOrigineExportable/.test(sourcesProduit)
    ? null
    : "`niveauRisqueParcelle`, `verifierOrigineExportable` et le validateur géométrique existent, mais aucun n'est appelé par la route du dossier",
  "le validateur à écrire doit réutiliser ces fonctions, pas les réimplémenter",
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
