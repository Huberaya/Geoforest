/**
 * Vérifie que la détection de chevauchement de parcelles fait ce qu'elle dit.
 *
 * ⚠️ Ce contrôle EXÉCUTE la détection sur des géométries construites.
 *
 *   Lire qu'une fonction s'appelle `comparerParcelles` ne prouve rien. Ce qui
 *   doit être prouvé, c'est qu'elle distingue trois cas qu'un booléen
 *   confondrait :
 *     · deux parcelles disjointes            → AUCUN
 *     · deux parcelles qui partagent un bord → CONTACT   (le cas NORMAL)
 *     · deux parcelles qui se recouvrent     → RECOUVREMENT (le défaut)
 *
 *   Le cas CONTACT est le plus important du lot. Un contrôle qui le classerait
 *   en RECOUVREMENT produirait une alerte sur chaque parcelle voisine ; au bout
 *   de trois, plus personne ne lirait l'alerte, et le contrôle serait pire que
 *   rien — il aurait coûté du travail pour installer du bruit.
 *
 * ⚠️ Et un cas de non-régression qui n'est pas évident : deux parcelles dont
 *   l'une est ENTIÈREMENT CONTENUE dans l'autre n'ont aucun croisement d'arêtes.
 *   Un test fondé uniquement sur les intersections de segments les déclarerait
 *   disjointes. C'est le piège classique de ce genre d'algorithme.
 *
 * Usage : npm run check:chevauchement
 * Sortie : 0 si tout est conforme, 1 sinon.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  bboxDeGeometrie,
  bboxSeRecouvrent,
  comparerParcelles,
  pointStrictementInterieur,
} from "../src/lib/eudr/chevauchement";

interface Controle {
  nom: string;
  ok: boolean;
  detail?: string;
}

const controles: Controle[] = [];
const verifier = (nom: string, ok: boolean, detail?: string): void => {
  controles.push({ nom, ok, detail });
};

/* ------------------------------------------------------- fabriques de tracés */

/** Rectangle fermé, ordre antihoraire, 6 décimales comme l'exige l'EUDR. */
function rectangle(lonMin: number, latMin: number, lonMax: number, latMax: number) {
  const r = (v: number): number => Number(v.toFixed(6));
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [r(lonMin), r(latMin)],
        [r(lonMax), r(latMin)],
        [r(lonMax), r(latMax)],
        [r(lonMin), r(latMax)],
        [r(lonMin), r(latMin)],
      ],
    ],
  };
}

function polygoneTroue(exterieur: number[], trou: number[]) {
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [exterieur[0], exterieur[1]],
        [exterieur[2], exterieur[1]],
        [exterieur[2], exterieur[3]],
        [exterieur[0], exterieur[3]],
        [exterieur[0], exterieur[1]],
      ],
      [
        [trou[0], trou[1]],
        [trou[2], trou[1]],
        [trou[2], trou[3]],
        [trou[0], trou[3]],
        [trou[0], trou[1]],
      ],
    ],
  };
}

function multiPolygone(a: number[], b: number[]) {
  const rect = (c: number[]) => [
    [
      [c[0], c[1]],
      [c[2], c[1]],
      [c[2], c[3]],
      [c[0], c[3]],
      [c[0], c[1]],
    ],
  ];
  return { type: "MultiPolygon" as const, coordinates: [rect(a), rect(b)] };
}

/* ---------------------------------------------- 1. les trois cas fondamentaux */

const A = rectangle(-5.0, 5.0, -4.99, 5.01);
const B = rectangle(-4.5, 5.0, -4.49, 5.01); // disjoint
const C = rectangle(-4.99, 5.0, -4.98, 5.01); // partage l'arête est de A
// ⚠️ D est volontairement DÉCALÉ en latitude par rapport à A.
//
//   Ma première version donnait à A et D exactement les mêmes bornes
//   verticales (5.0 → 5.01). Leurs arêtes horizontales étaient donc
//   COLINEAIRES, et `croisementInterieur` — qui exige un croisement strict —
//   ne les voyait pas. Le module répondait CONTACT sur un recouvrement franc.
//   C'est un vrai faux négatif, trouvé par ce contrôle et non par lecture.
const D = rectangle(-4.995, 5.002, -4.985, 5.012); // recouvre A sur une bande

verifier(
  "deux parcelles disjointes → AUCUN",
  comparerParcelles(A, B) === "AUCUN",
  `obtenu : ${comparerParcelles(A, B)}`,
);

verifier(
  "deux parcelles qui partagent une limite → CONTACT, pas RECOUVREMENT",
  comparerParcelles(A, C) === "CONTACT",
  `obtenu : ${comparerParcelles(A, C)} — un contact classé en recouvrement produirait une alerte sur chaque parcelle voisine`,
);

verifier(
  "deux parcelles qui se recouvrent → RECOUVREMENT",
  comparerParcelles(A, D) === "RECOUVREMENT",
  `obtenu : ${comparerParcelles(A, D)}`,
);

verifier(
  "le verdict est symétrique",
  comparerParcelles(A, D) === comparerParcelles(D, A) && comparerParcelles(A, C) === comparerParcelles(C, A),
  "l'ordre des arguments change le verdict : le résultat dépendrait de l'ordre de lecture en base",
);

/* ------------------------------- 2. le piège de l'inclusion sans croisement */

const grande = rectangle(0, 0, 1, 1);
const petite = rectangle(0.4, 0.4, 0.6, 0.6); // entièrement dedans, aucune arête ne se croise

verifier(
  "une parcelle entièrement incluse → RECOUVREMENT",
  comparerParcelles(grande, petite) === "RECOUVREMENT",
  `obtenu : ${comparerParcelles(grande, petite)} — aucune arête ne se croise : un test limité aux intersections de segments raterait ce cas`,
);

/* --------------------------------------------- 3. contact en un seul sommet */

const coin = rectangle(-4.99, 5.01, -4.98, 5.02); // touche A par un seul sommet
verifier(
  "deux parcelles qui se touchent en un sommet → CONTACT",
  comparerParcelles(A, coin) === "CONTACT",
  `obtenu : ${comparerParcelles(A, coin)}`,
);

/* ------------------------------------------- 4. géométries non surfaciques */

verifier(
  "un point ne se recouvre avec rien",
  comparerParcelles({ type: "Point", coordinates: [-4.995, 5.005] }, A) === "AUCUN",
  "un point n'a pas de surface : le compter comme recouvrement serait un faux positif systématique",
);

verifier(
  "une géométrie vide ne produit pas de verdict",
  comparerParcelles({ type: "Polygon", coordinates: [] }, A) === "AUCUN",
);

/* ------------------------------------------------------- 5. multi et trous */

verifier(
  "un MultiPolygon est comparé sur toutes ses parties (recouvrement en 2e position)",
  comparerParcelles(multiPolygone([-6, 5, -5.9, 5.1], [-4.995, 5.002, -4.985, 5.012]), A) === "RECOUVREMENT",
  "seule la seconde partie recouvre A : un test limité à la première raterait le recouvrement",
);

verifier(
  "un MultiPolygon est comparé sur toutes ses parties (recouvrement en 1re position)",
  comparerParcelles(multiPolygone([-4.995, 5.002, -4.985, 5.012], [-6, 5, -5.9, 5.1]), A) === "RECOUVREMENT",
  "seule la première partie recouvre A : un test limité à la seconde raterait le recouvrement",
);

// ⚠️ Un trou est une EXCLUSION de surface : un îlot posé entièrement dans le
//   trou d'une parcelle ne la recouvre pas.
//
//   Ce cas a d'abord été consigné comme « écart connu », le module répondant
//   RECOUVREMENT. Puis le contrôle du MultiPolygon a révélé que les polygones
//   étaient aplatis ; en corrigeant, la soustraction des trous est venue avec.
//   Le contrôle exige donc maintenant le verdict CORRECT — c'est la version
//   écrite après la correction, pas celle qui l'épousait avant.
verifier(
  "un îlot dans une enclave ne recouvre pas la parcelle qui l'entoure",
  comparerParcelles(polygoneTroue([0, 0, 2, 2], [0.5, 0.5, 1.5, 1.5]), rectangle(0.8, 0.8, 1.2, 1.2)) === "AUCUN",
  "un trou est une exclusion de surface : le compter comme recouvrement signalerait une enclave",
);

/* -------------------------------------------------------- 6. pré-filtre bbox */

const bboxA = bboxDeGeometrie(A);
const bboxB = bboxDeGeometrie(B);
verifier(
  "le pré-filtre écarte deux cadres disjoints",
  bboxA !== null && bboxB !== null && bboxSeRecouvrent(bboxA, bboxB) === false,
  "sans ce filtre, comparer N parcelles coûterait N² paires de polygones",
);

verifier(
  "le cadre englobant est calculé à 6 décimales",
  bboxA !== null && bboxA.every((v) => Math.abs(v * 1e6 - Math.round(v * 1e6)) < 1e-6),
);

/* ------------------------------------- 7. intériorité stricte (convention) */

verifier(
  "un sommet posé sur une arête n'est pas « strictement intérieur »",
  pointStrictementInterieur([0.5, 0], grande.coordinates[0] as never) === false,
  "c'est cette convention qui fait d'un contact un CONTACT et non un RECOUVREMENT",
);

verifier(
  "un point au centre est strictement intérieur",
  pointStrictementInterieur([0.5, 0.5], grande.coordinates[0] as never) === true,
);

/* ------------------------------ 8. le contrôle est-il branché quelque part ? */

const routePlots = readFileSync(join("src", "app", "api", "v1", "plots", "route.ts"), "utf-8");
verifier(
  "la création de parcelle appelle la détection",
  /comparerParcelles\s*\(/.test(routePlots),
  "le module existerait sans être utilisé : c'est le défaut corrigé en C7",
);

verifier(
  "la création de parcelle enregistre le cadre englobant",
  /bboxMinLon\s*:/.test(routePlots),
  "sans borne stockée, le pré-filtre SQL écarterait toutes les parcelles",
);

verifier(
  "un recoupement est journalisé, pas seulement renvoyé dans la réponse",
  /recoupements\s*:/.test(routePlots) && /details:\s*\{[\s\S]*recoupements/.test(routePlots),
  "un avertissement qui n'existe que dans un corps HTTP est perdu dès que l'écran ne l'affiche pas",
);

verifier(
  "un CONTACT n'est pas remonté comme un recoupement",
  /verdict === "RECOUVREMENT"/.test(routePlots),
  "remonter aussi le contact produirait une alerte sur chaque parcelle voisine",
);

/* ------------------ 9. le signalement atteint-il l'utilisateur ? ---------- */

// ⚠️ Un recoupement constaté, journalisé et renvoyé par l'API ne sert à RIEN si
//   l'écran le jette. C'est exactement le défaut corrigé en C7 avec le
//   `completenessScore` : le serveur disait vrai, le client n'en montrait rien.
//   Le vérifier ici n'est pas de la cosmétique — c'est la seule étape où le
//   signal rencontre un être humain.
const apiClient = readFileSync(join("src", "lib", "api.ts"), "utf-8");
const ecranParcelles = readFileSync(join("src", "app", "(app)", "plots", "page.tsx"), "utf-8");

// ⚠️ Ma première version cherchait `recoupements?:` n'importe où dans le
//   fichier, et restait VERTE quand je remettais `as Plot` sur le `return` :
//   la déclaration de type subsistait, le cast la vidait. Un contrôle qui
//   cherche un mot dans un fichier vérifie que le mot est écrit, pas que la
//   valeur survit. Il exige donc maintenant le cast lui-même.
verifier(
  "le client d'API conserve le recoupement au lieu de le réduire à une parcelle",
  /return\s*\(await response\.json\(\)\)\s*as Plot & \{ recoupements\?: Recoupement\[\] \}/.test(apiClient),
  "typer la réponse en `Plot` suffit à faire disparaître le signalement à la compilation",
);

verifier(
  "l'écran des parcelles affiche le recoupement",
  /recoupements\.length\s*>\s*0/.test(ecranParcelles),
  "le serveur aurait constaté, journalisé, renvoyé — et l'écran n'en montrerait rien",
);

verifier(
  "l'avertissement n'est pas rangé parmi les erreurs",
  /setRecoupements\(/.test(ecranParcelles) && !/setError\([^)]*recoupement/i.test(ecranParcelles),
  "la parcelle est créée : l'afficher en erreur ferait ressaisir, donc produirait le doublon qu'on signale",
);

verifier(
  "l'avertissement survit à la fermeture du formulaire",
  /setRecoupements\(creee\.recoupements/.test(ecranParcelles),
  "un message qui disparaît avec le formulaire ne laisse aucune trace visible",
);

/* --------------------------------------- 10. la limite est écrite quelque part */

verifier(
  "la limite de visibilité inter-organisations est documentée",
  /organisation|organisations/i.test(
    readFileSync(join("docs", "EUDR_COMPLIANCE_GUIDE.md"), "utf-8"),
  ),
  "deux exploitations clientes peuvent se recouvrir sans que le produit le sache : ce doit être écrit",
);

verifier(
  "le remplissage des cadres existants est outillé",
  /backfill-bbox/.test(readFileSync(join("package.json"), "utf-8")),
  "sans remplissage, les parcelles antérieures à C8 échappent à la détection",
);

/* ------------------------------------------------ Rapport ------------------ */

const echecs = controles.filter((c) => !c.ok);
for (const c of controles) {
  if (c.ok) console.log(`  ✅ ${c.nom}`);
  else console.log(`  🔴 ${c.nom}${c.detail ? ` — ${c.detail}` : ""}`);
}
console.log(`\n${controles.length - echecs.length}/${controles.length} contrôle(s) réussi(s)`);
process.exit(echecs.length === 0 ? 0 : 1);
