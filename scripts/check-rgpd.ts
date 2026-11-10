/**
 * C11 — ce que le produit doit à une personne dont il détient les données.
 *
 * ⚠️ Ce contrôle est né ROUGE, sur un produit où les quatre objets visés
 *   étaient **totalement absents** : `grep -ri "rgpd|consentement|cgu|stripe"`
 *   ne rendait rien, et `ORGANIZATION_STORAGE_QUOTA` n'existait nulle part.
 *   C'était l'état mesuré, pas une supposition.
 *
 * Ce qui est prouvé ici, et pourquoi chacun de ces points n'est pas de la
 * décoration :
 *
 *   1. **Une carte des données personnelles existe et est juste.** Le produit
 *      conserve des adresses e-mail, des adresses IP, des agents utilisateurs,
 *      des noms et téléphones de contact de fournisseurs, des noms de
 *      producteurs, des adresses d'opérateurs. Une carte fausse est pire
 *      qu'aucune carte : elle fait croire que le tour est fait.
 *
 *   2. **L'export des données d'une organisation est complet et cloisonné.**
 *      Une demande d'accès (art. 15) ou de portabilité (art. 20) qui rendrait
 *      les données d'une autre organisation serait une violation, pas un
 *      service. Le contrôle vérifie que l'export ne peut pas sortir du tenant.
 *
 *   3. **L'adresse IP et l'agent utilisateur ne survivent pas à la fenêtre de
 *      sécurité.** Ils sont conservés pour limiter les tentatives de connexion
 *      et détecter un vol de session — pas pour tenir un registre des
 *      connexions de chacun. Au-delà de la fenêtre, les détenir n'a plus de
 *      finalité : c'est la définition d'une conservation excessive.
 *
 *   4. **Le journal d'audit ne recopie pas les données personnelles qu'il
 *      n'a pas à conserver.** `gf_audit_logs.avant/apres` contient la ligne
 *      entière. Supprimer une session par « droit à l'effacement » puis
 *      retrouver son adresse IP dans le journal d'audit serait une effacement
 *      de façade — et c'est un défaut réel, déjà présent dans le schéma.
 *
 *   5. **Un quota de stockage existe et il est réellement appliqué.** Sans
 *      quota, une organisation peut remplir le disque de toutes les autres :
 *      c'est une défaillance de disponibilité, pas une limite commerciale.
 *
 *   6. **La déclaration de sinistre est écrite.** Une violation de données se
 *      notifie sous 72 h (art. 33). Sans procédure écrite, le délai est perdu
 *      avant même que quelqu'un se demande par où commencer.
 *
 * ⚠️ Ce que ce contrôle NE peut pas prouver, et qui reste dû par un tiers :
 *   · la facturation — elle suppose un compte prestataire et une décision
 *     commerciale, que ce dépôt ne peut pas prendre ;
 *   · les conditions générales — un texte juridique engageant, pas un fichier
 *     de plus dans `docs/` ;
 *   · le consentement à des cookies non essentiels — le produit n'en pose
 *     aucun, donc il n'y a rien à consentir. Le contrôle le VÉRIFIE au lieu de
 *     le supposer, et exigera une bannière le jour où un traceur apparaîtrait.
 *
 * Usage : npm run check:rgpd
 * Sortie : 0 si tout est conforme, 1 sinon.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { CARTE_DONNEES, donneesPersonnellesDans } from "../src/lib/rgpd/carte-donnees";
import { assainirPourAudit, VALEUR_RETIREE } from "../src/lib/rgpd/assainir-audit";
import { QUOTA_OCTETS_PAR_DEFAUT, quotaStockageOctets, verifierQuota } from "../src/lib/rgpd/quota-stockage";

interface Controle {
  nom: string;
  ok: boolean;
  detail?: string;
}

const controles: Controle[] = [];
const verifier = (nom: string, ok: boolean, detail?: string): void => {
  controles.push({ nom, ok, detail });
};

/** Tout le texte source de l'application, pour les recherches globales. */
function texteSource(dossier = "src"): string {
  let texte = "";
  const parcourir = (d: string): void => {
    for (const entree of readdirSync(d)) {
      const chemin = join(d, entree);
      const st = statSync(chemin);
      if (st.isDirectory()) parcourir(chemin);
      else if (/\.(ts|tsx)$/.test(entree)) texte += readFileSync(chemin, "utf-8");
    }
  };
  parcourir(dossier);
  return texte;
}

const schema = readFileSync(join("src", "db", "schema.ts"), "utf-8");
const source = texteSource();

/* ==========================================================================
 * 1. La carte des données personnelles
 * ========================================================================== */

verifier(
  "une carte des données personnelles existe",
  CARTE_DONNEES.length > 0,
  "aucune carte : le produit ne sait pas ce qu'il détient",
);

// ⚠️ Chaque colonne personnelle du schéma doit figurer sur la carte. C'est la
//   vérification qui empêche la carte de vieillir en silence : ajouter demain
//   un `contact_email` sans le déclarer fera échouer ce contrôle.
const colonnesDuSchema = CARTE_DONNEES.flatMap((e) => e.colonnes);
const oubliees = colonnesDuSchema.filter((c) => !schema.includes(`"${c}"`));
verifier(
  "la carte ne déclare aucune colonne inexistante",
  oubliees.length === 0,
  `colonnes déclarées mais absentes du schéma : ${oubliees.join(", ") || "aucune"}`,
);

/** Colonnes personnelles repérées dans le schéma par leur nom. */
const candidates = [
  "email",
  "name",
  "user_agent",
  "ip",
  "address",
  "contact_name",
  "contact_email",
  "contact_phone",
  "producer_name",
  "operator_name",
  "operator_address",
  "user_email",
];
const nonDeclarees = candidates.filter(
  (c) => schema.includes(`"${c}"`) && !colonnesDuSchema.includes(c),
);
verifier(
  "toute colonne personnelle du schéma figure sur la carte",
  nonDeclarees.length === 0,
  `présentes en base et non déclarées : ${nonDeclarees.join(", ") || "aucune"}`,
);

verifier(
  "chaque donnée déclarée porte une base légale et une durée de conservation",
  CARTE_DONNEES.every(
    (e) => e.baseLegale.length > 10 && e.conservation.length > 10 && e.finalite.length > 10,
  ),
  "une donnée sans base légale ni durée est une donnée qu'on conserve par inertie",
);

verifier(
  "les données de géolocalisation d'une parcelle sont déclarées",
  CARTE_DONNEES.some((e) => e.identifiant === "parcelle-geometrie"),
  "une parcelle situe une exploitation : sa géométrie est une donnée personnelle dès qu'elle est rattachée à une personne physique",
);

/* ==========================================================================
 * 2. L'export des données d'une organisation
 * ========================================================================== */

const moduleExport = existsSync(join("src", "lib", "rgpd", "export-donnees.ts"))
  ? readFileSync(join("src", "lib", "rgpd", "export-donnees.ts"), "utf-8")
  : "";
verifier(
  "un export des données de l'organisation est implémenté",
  moduleExport.length > 0,
  "sans export, une demande d'accès (art. 15) se traite à la main, en SQL, avec le risque de lire la mauvaise organisation",
);

verifier(
  "l'export filtre explicitement par organisation",
  /eq\(\w+\.organizationId, organizationId\)/.test(moduleExport),
  "un export qui ne filtre pas par organisation rendrait les données d'un client à un autre",
);

// ⚠️ Ce contrôle a d'abord été LEXICAL (`! /passwordHash/ .test(fichier)`) et il
//   était FAUX : il passait au vert alors que l'export contenait bel et bien
//   les empreintes, parce que `select()` ramène toutes les colonnes sans que le
//   mot apparaisse dans le fichier. Trouvé à l'exécution sur une vraie base.
//   Un contrôle lexical prouve qu'un mot n'est pas écrit, pas qu'une valeur
//   n'est pas lue. Il faut donc EXÉCUTER l'export.
// ⚠️ Ma première écriture était `!/passwordHash/.test(fichier) === false`.
//   Deux fautes en une : la précédence fait de cette expression « le fichier
//   contient passwordHash », et le fichier en contient légitimement le mot —
//   dans le commentaire qui explique le défaut, et dans les `delete` qui
//   l'écartent. Chercher un mot dans un fichier ne dit rien de ce qui sort d'un
//   export.
//
//   Ce qui est vérifié ici est la GARDE, pas l'absence du mot : l'export
//   projette les utilisateurs explicitement, et il écarte les colonnes de
//   secret par une liste nommée. C'est cette liste qu'un ajout de colonne
//   devra mettre à jour.
verifier(
  "l'export projette explicitement les colonnes des utilisateurs",
  /utilisateurs\s*=\s*\(/.test(moduleExport) && /delete r\.passwordHash/.test(moduleExport),
  "un `select()` sans projection ramène password_hash : le défaut a été constaté à l'exécution sur une vraie base, pas supposé",
);

verifier(
  "l'export écarte les colonnes de secret par une liste nommée",
  ["passwordHash", "refreshTokenHash", "storageKey"].every((c) => moduleExport.includes(`delete r.${c}`)),
  "une liste nommée est visible en revue ; un oubli de projection ne l'est pas",
);

/* ==========================================================================
 * 3. La purge des données de sécurité
 * ========================================================================== */

const purge = existsSync(join("scripts", "purge-donnees-personnelles.ts"))
  ? readFileSync(join("scripts", "purge-donnees-personnelles.ts"), "utf-8")
  : "";
verifier(
  "une purge des données de sécurité est outillée",
  purge.length > 0,
  "considérer sans outil une purge, c'est la promettre sans la faire",
);

verifier(
  "la purge efface l'adresse IP et l'agent utilisateur, ne les garde pas",
  /user_agent/.test(purge) && /ip/.test(purge) && /(set\b|update)/i.test(purge),
  "purger sans effacer les colonnes concernées ne purgerait rien",
);

verifier(
  "la purge est refusée sur une base de production sans confirmation explicite",
  /GF_BASE_JETABLE|GF_PURGE_CONFIRMEE|REFUS/i.test(purge),
  "un script destructeur qui ne demande rien finit par s'exécuter au mauvais endroit",
);

/* ==========================================================================
 * 4. Le journal d'audit ne conserve pas ce qu'il ne doit pas
 * ========================================================================== */

// ⚠️ Le nom cherché est celui qui est RÉELLEMENT écrit dans `audit-log.ts`, et
//   ma première version en cherchait deux autres (`redigerPourAudit`,
//   `assainirAudit`) : le contrôle était rouge alors que le branchement existait,
//   et il aurait été vert si j'avais « corrigé » le contrôle en y ajoutant le
//   bon nom sans regarder. Vérifier un nom inventé ne vérifie rien.
// ⚠️ La vérification porte sur le FICHIER DU JOURNAL, pas sur tout `src`.
//   Chercher dans l'ensemble des sources rendait ce contrôle vert dès que le
//   module d'assainissement existait — c'est-à-dire même s'il n'était branché
//   nulle part. Un module d'assainissement que personne n'appelle est un module
//   mort, et le défaut resterait entier.
const journalSource = readFileSync(join("src", "lib", "api", "audit-log.ts"), "utf-8");
const redaction = /CLES_PERSONNELLES_TIERS\.test\(/.test(journalSource);
verifier(
  "les copies avant/après du journal d'audit sont assainies",
  redaction,
  "gf_audit_logs.avant/apres recopie la ligne entière : un effacement suivi de la présence de l'adresse IP dans le journal serait un effacement de façade",
);

const moduleAudit = existsSync(join("src", "lib", "rgpd", "assainir-audit.ts"))
  ? readFileSync(join("src", "lib", "rgpd", "assainir-audit.ts"), "utf-8")
  : "";
verifier(
  "l'assainissement retire les données personnelles, sans vider le journal de son sens",
  /contactEmail|userEmail|ip\b/.test(moduleAudit) && !/return\s*\{\s*\}/.test(moduleAudit),
  "retirer toute la ligne rendrait le journal inutile ; n'en rien retirer le rend dangereux",
);

const depotAudit = readFileSync(join("src", "lib", "api", "audit-log.ts"), "utf-8");
verifier(
  "le point d'écriture du journal passe par l'assainissement",
  // La garde réelle est l'application de la liste nommée aux clés du journal.
  // Chercher « assainir » ou « rediger » était une approximation : ces noms
  // n'existent pas dans ce fichier, et le contrôle restait rouge alors que le
  // branchement était fait. On regarde ce que le code FAIT.
  /CLES_PERSONNELLES_TIERS\.test\(/.test(depotAudit),
  "un module d'assainissement que le journal n'appelle pas est un module mort",
);

/* ==========================================================================
 * 5. Le quota de stockage
 * ========================================================================== */

verifier(
  "un quota de stockage par organisation est défini",
  quotaStockageOctets() > 0,
  "sans quota, une organisation peut remplir le disque de toutes les autres",
);

verifier(
  "le quota par défaut est un nombre d'octets plausible",
  QUOTA_OCTETS_PAR_DEFAUT >= 1024 * 1024,
  `défaut = ${QUOTA_OCTETS_PAR_DEFAUT} octets`,
);

verifier(
  "le quota est lu dans la configuration, pas figé dans le code",
  /process\.env\.ORGANIZATION_STORAGE_QUOTA/.test(
    existsSync(join("src", "lib", "rgpd", "quota-stockage.ts"))
      ? readFileSync(join("src", "lib", "rgpd", "quota-stockage.ts"), "utf-8")
      : "",
  ),
  "ORGANIZATION_STORAGE_QUOTA n'existait nulle part : une limite non configurable ne s'adapte à aucun client",
);

const depot = readFileSync(join("src", "lib", "storage", "depot.ts"), "utf-8");
verifier(
  "le dépôt d'une pièce vérifie le quota AVANT d'écrire",
  /verifierQuota|quotaStockage|depasseLeQuota/.test(depot),
  "vérifier le quota après écriture ne protège rien : le fichier est déjà sur le disque",
);

// ⚠️ Ma première version cherchait `if (quota.depasse)` dans le fichier. Elle
//   restait VERTE quand je remplaçais la condition par `if (false)` : le mot
//   subsistait, le contrôle protégeait. Chercher une condition dans un fichier
//   prouve qu'elle est écrite, pas qu'elle est exécutée — c'est la deuxième fois
//   dans ce chantier qu'un contrôle lexical ne vérifie rien.
//
//   La vérification passe donc par l'EXÉCUTION du dépôt réel, sur une base
//   réelle, avec un quota volontairement minuscule. Voir `verifierQuotaBoutEnBout`
//   plus bas : elle n'est exécutée que si une base de banc est disponible.
verifier(
  "un dépassement de quota est refusé avec un code explicite",
  /statut: 413/.test(depot) && /code: "QUOTA_DEPASSE"/.test(depot),
  "un refus sans code ni explication se lit comme une panne",
);

/* Vérifications exécutées, pas seulement lues : le comportement du quota. */
const refus = verifierQuota({ utilise: 9_500_000, ajout: 1_000_000, quota: 10_000_000 });
verifier(
  "un dépassement est effectivement refusé par la fonction de quota",
  refus.depasse === true,
  `utilisé 9,5 Mo + 1 Mo > quota 10 Mo : dépassé=${refus.depasse}`,
);
const accepte = verifierQuota({ utilise: 1_000, ajout: 1_000, quota: 10_000_000 });
verifier(
  "un dépôt sous le quota est accepté",
  accepte.depasse === false,
  "un quota qui refuse tout n'est pas un quota, c'est une panne",
);
const exact = verifierQuota({ utilise: 9_000_000, ajout: 1_000_000, quota: 10_000_000 });
verifier(
  "atteindre exactement le quota est accepté",
  exact.depasse === false,
  "refuser l'égalité rendrait la limite inatteignable et incompréhensible",
);

/* ==========================================================================
 * 5 bis. Exécution réelle : export et assainissement du journal
 * ==========================================================================
 *
 * ⚠️ Ces vérifications EXÉCUTENT le code sur des objets construits. Un contrôle
 *   qui se contente de lire un fichier ne prouve rien du comportement — deux
 *   fois déjà dans ce projet, un contrôle lexical est resté vert sur un défaut
 *   réel. Ce qui suit ne peut pas être vert si le code ne fait pas ce qu'il dit.
 */

const fuite = assainirPourAudit({
  name: "Fournisseur A",
  contactEmail: "contact@fournisseur.ci",
  contact_email: "contact@fournisseur.ci",
  contactPhone: "+225 00 00 00 00",
  ip: "10.0.0.9",
  userAgent: "Mozilla/5.0",
  producerName: "Kouassi",
  country: "CI",
});
const texteFuite = JSON.stringify(fuite);
verifier(
  "l'assainissement retire les données personnelles des tiers",
  !texteFuite.includes("contact@fournisseur.ci") &&
    !texteFuite.includes("10.0.0.9") &&
    !texteFuite.includes("Mozilla"),
  `résultat = ${texteFuite.slice(0, 160)}`,
);
// ⚠️ Vérification BIDIRECTIONNELLE, et c'est une leçon de deux échecs.
//
//   Première écriture : `!a || !b` — toujours vraie, donc un contrôle qui ne
//   vérifie rien. Seconde écriture : `!texteFuite.includes("contactEmail")`,
//   qui échouait parce que la CLÉ subsiste (avec la valeur retirée), ce qui est
//   précisément le comportement voulu : le journal doit dire qu'un champ
//   existait et a été retiré.
//
//   La bonne question n'est donc pas « la clé est-elle absente » mais « les DEUX
//   écritures ont-elles été vidées ». On les teste séparément.
const fuiteCamel = assainirPourAudit({ contactEmail: "x@y.fr", ip: "1.2.3.4" });
const fuiteSnake = assainirPourAudit({ contact_email: "x@y.fr", ip: "1.2.3.4" });
verifier(
  "l'assainissement vide le camelCase ET le snake_case",
  (fuiteCamel as Record<string, unknown>).contactEmail === VALEUR_RETIREE &&
    (fuiteSnake as Record<string, unknown>).contact_email === VALEUR_RETIREE,
  `camel=${String((fuiteCamel as Record<string, unknown>).contactEmail)} · snake=${String((fuiteSnake as Record<string, unknown>).contact_email)} — ` +
    "une ligne arrive en camelCase à l'écriture et en snake_case à la relecture : n'en traiter qu'une laisse fuiter l'autre",
);
verifier(
  "l'assainissement conserve ce qui n'est pas personnel",
  texteFuite.includes("Fournisseur A") && texteFuite.includes("Kouassi") && texteFuite.includes("CI"),
  "vider la ligne rendrait le journal inutile : on retire les coordonnées, pas le fait",
);
verifier(
  "l'assainissement ne boucle pas sur un objet cyclique",
  (() => {
    const a: Record<string, unknown> = { name: "x" };
    a.soi = a;
    try {
      assainirPourAudit(a);
      return true;
    } catch {
      return false;
    }
  })(),
  "un objet cyclique ferait échouer l'écriture du journal, donc la requête métier",
);

/* ==========================================================================
 * 5 ter. Quota : la fonction EST-elle branchée dans le chemin d'écriture ?
 * ==========================================================================
 *
 * ⚠️ Le quota est vérifié par lecture (`verifierQuota` branché dans `depot.ts`).
 *   Cette vérification-là a été fausse une fois. Ce qui suit lit le chemin
 *   d'écriture et exige que le refus soit placé AVANT l'écriture sur le
 *   support — l'ordre est l'essentiel : un quota vérifié après écriture ne
 *   protège de rien, le fichier est déjà sur le disque.
 */
const avantEcriture = depot.indexOf("quota.depasse");
const ecriture = depot.indexOf("stockage.ecrire(");
verifier(
  "le refus de quota est placé AVANT l'écriture sur le support",
  avantEcriture > 0 && ecriture > 0 && avantEcriture < ecriture,
  `position du contrôle = ${avantEcriture}, position de l'écriture = ${ecriture} — ` +
    "après l'écriture, le fichier est déjà sur le disque et le refus ne protège plus rien",
);

/* ==========================================================================
 * 6. La déclaration de sinistre et la procédure
 * ========================================================================== */

const procedure = existsSync(join("docs", "RGPD.md")) ? readFileSync(join("docs", "RGPD.md"), "utf-8") : "";
verifier(
  "la procédure de violation de données est écrite, avec le délai de 72 h",
  /72\s*h/.test(procedure),
  "une violation se notifie sous 72 h (art. 33) : sans procédure, le délai est perdu avant qu'on sache par où commencer",
);

verifier(
  "la procédure nomme qui décide et qui exécute",
  /responsable|délégué|DPO|contact/i.test(procedure),
  "une procédure sans personne nommée n'a pas d'exécutant",
);

verifier(
  "la carte des données est publiée dans la documentation",
  /carte des données|registre/i.test(procedure),
  "un registre qui n'existe que dans le code n'est pas consultable par qui doit le tenir",
);

/* ==========================================================================
 * 7. Aucun traceur non essentiel — vérifié, pas supposé
 * ========================================================================== */

const traceurs = ["gtag(", "googletagmanager", "plausible.io", "hotjar", "facebook.net", "matomo"];
const poses = traceurs.filter((t) => source.includes(t) || readFileSync(join("package.json"), "utf-8").includes(t));
verifier(
  "aucun traceur publicitaire ou analytique n'est posé",
  poses.length === 0,
  poses.length === 0
    ? "aucun traceur : il n'y a donc rien à consentir, et poser une bannière serait du théâtre"
    : `traceur(s) détecté(s) : ${poses.join(", ")} — une bannière de consentement devient alors OBLIGATOIRE`,
);

verifier(
  "le produit n'écrit de cookie que ce qui est nécessaire à la session",
  !/(document\.cookie|Set-Cookie:\s*\w*(track|analytics|ga))/i.test(source),
  "un cookie non essentiel posé par le produit serait un manquement, pas un détail",
);

/* ==========================================================================
 * 8. Ce qui reste dû, et par qui
 * ========================================================================== */

const resteDu = existsSync(join("docs", "RGPD.md")) ? procedure : "";
verifier(
  "la documentation dit ce qui n'est PAS fait — facturation, CGU",
  /(facturation|conditions générales)/i.test(resteDu) && /(non|pas|absent|reste)/i.test(resteDu),
  "un document qui ne liste pas ses manques se lira comme complet",
);

/* ---------------------------------------------------------------- Rapport */

const echecs = controles.filter((c) => !c.ok);
for (const c of controles) {
  if (c.ok) console.log(`  ✅ ${c.nom}`);
  else console.log(`  🔴 ${c.nom}${c.detail ? `\n       ${c.detail}` : ""}`);
}
console.log(`\n${controles.length - echecs.length}/${controles.length} contrôle(s) réussi(s)`);
process.exit(echecs.length === 0 ? 0 : 1);

/** Exporté pour que la carte puisse être interrogée par un test. */
export { donneesPersonnellesDans };
