/**
 * Détection de chevauchement entre deux parcelles — sans PostGIS.
 *
 * ⚠️ Pourquoi ce module existe (C8).
 *
 *   Deux parcelles saisies avec le même tracé étaient acceptées sans un mot. Le
 *   produit additionnait alors deux fois la même surface, et rien ne le
 *   signalait : ni la saisie, ni l'analyse, ni le dossier de diligence.
 *   Contrairement à une géométrie invalide, un doublon n'a aucun symptôme
 *   visible — il ressemble à deux parcelles normales.
 *
 * ⚠️ La distinction qui décide de l'utilité du module : CONTACT ≠ RECOUVREMENT.
 *
 *   Deux exploitations voisines partagent une clôture. Leurs polygones se
 *   touchent sur un segment, parfois sur toute une arête, et c'est parfaitement
 *   normal. Un contrôle qui confond contact et recouvrement produit des alertes
 *   sur des dossiers sains ; au bout de trois, plus personne ne lit les
 *   alertes. C'est pour cette raison que le module rend trois états et non un
 *   booléen.
 *
 * ⚠️ Ce que ce module ne prétend PAS faire.
 *
 *   Il **détecte**, il ne mesure pas. Calculer la surface exacte de
 *   l'intersection de deux polygones quelconques demande un algorithme de
 *   découpage (Weiler-Atherton ou équivalent) dont les cas dégénérés — arêtes
 *   colinéaires, sommets sur une arête, polygones troués — sont une source
 *   classique de résultats faux. Un chiffre faux en hectares serait plus
 *   dangereux qu'une absence de chiffre : il entrerait dans une déclaration.
 *   Le module dit donc « ces deux parcelles se recouvrent », avec le nom des
 *   deux et la nature du recoupement. La surface, elle, reste à établir.
 *
 *   Il **ne voit que l'organisation courante** : la RLS filtre les autres, et
 *   deux exploitations clientes différentes peuvent se recouvrir sans que le
 *   produit le sache. Cette limite est écrite dans la documentation, pas
 *   seulement ici.
 */
import type { Position } from "./types";

/** Résultat de la comparaison de deux géométries. */
export type VerdictChevauchement =
  /** Les deux parcelles n'ont aucun point en commun. */
  | "AUCUN"
  /**
   * Elles se touchent sans se recouvrir : une limite partagée, un sommet
   * commun, une arête commune. Cas NORMAL entre parcelles voisines.
   */
  | "CONTACT"
  /** L'une recouvre une partie de l'autre : la surface est comptée deux fois. */
  | "RECOUVREMENT";

/** Cadre englobant : `[lonMin, latMin, lonMax, latMax]`. */
export type Bbox = [number, number, number, number];

/**
 * Tolérance angulaire, en degrés.
 *
 * ⚠️ 1e-9 ° représente environ 0,1 mm au sol. Ce n'est pas une tolérance de
 *   saisie : c'est le seuil sous lequel deux flottants issus du même calcul
 *   doivent être considérés comme égaux. Les coordonnées EUDR sont attendues à
 *   6 décimales (≈ 0,11 m) : en dessous, on ne compare plus des parcelles, on
 *   compare des erreurs d'arrondi.
 */
const EPS = 1e-9;

/* -------------------------------------------------------------- extraction */

/**
 * Polygones d'une géométrie GeoJSON : une entrée par polygone, chaque entrée
 * contenant ses anneaux (extérieur en position 0, trous ensuite).
 *
 * ⚠️ La structure est imbriquée, et ce n'est pas cosmétique.
 *
 *   Ma première version rendait une liste plate d'anneaux. Conséquence mesurée
 *   par `check:chevauchement` : sur un `MultiPolygon`, `anneauxDe(g)[0]` ne
 *   prenait que le premier polygone, et un recouvrement portant sur le second
 *   n'était **jamais vu**. Le contrôle a produit un faux négatif sur un cas
 *   franc — c'est exactement pour cela qu'il exécute au lieu de lire.
 */
export function polygonesDe(geometrie: unknown): Position[][][] {
  const polygones: Position[][][] = [];
  const visiter = (g: unknown): void => {
    if (!g || typeof g !== "object") return;
    const obj = g as Record<string, unknown>;
    switch (obj.type) {
      case "FeatureCollection":
        for (const f of (obj.features as unknown[]) ?? []) visiter(f);
        return;
      case "Feature":
        visiter(obj.geometry);
        return;
      case "Polygon": {
        const anneaux = ((obj.coordinates as unknown[]) ?? []) as Position[][];
        if (anneaux.length > 0) polygones.push(anneaux.filter((a) => Array.isArray(a) && a.length >= 3));
        return;
      }
      case "MultiPolygon":
        for (const poly of (obj.coordinates as unknown[]) ?? []) {
          const anneaux = (poly as unknown[]) as Position[][];
          if (Array.isArray(anneaux) && anneaux.length > 0) {
            polygones.push(anneaux.filter((a) => Array.isArray(a) && a.length >= 3));
          }
        }
        return;
      default:
        // Point, MultiPoint, ou type inconnu : aucune surface à recouvrir. Un
        // point ne peut pas chevaucher une parcelle au sens de la surface ; il
        // peut tomber dedans, ce qui n'est pas un recouvrement de surface.
        return;
    }
  };
  visiter(geometrie);
  return polygones.filter((p) => p.length > 0);
}

/** Tous les anneaux, tous polygones confondus — pour le cadre englobant. */
export function anneauxDe(geometrie: unknown): Position[][] {
  return polygonesDe(geometrie).flat();
}

/** Cadre englobant d'une liste de positions. `null` si elle est vide. */
export function bboxDePositions(positions: Position[]): Bbox | null {
  if (positions.length === 0) return null;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of positions) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  if (!Number.isFinite(x0)) return null;
  return [x0, y0, x1, y1];
}

/** Cadre englobant d'une géométrie GeoJSON. */
export function bboxDeGeometrie(geometrie: unknown): Bbox | null {
  return bboxDePositions(anneauxDe(geometrie).flat());
}

/**
 * Les deux cadres se recouvrent-ils (contact compris) ?
 *
 * ⚠️ Pré-filtre AVANT tout calcul de segments. Deux parcelles dont les cadres
 *   sont disjoints ne peuvent pas se recouvrir, et l'immense majorité des
 *   paires est dans ce cas. Sans ce filtre, comparer N parcelles coûterait
 *   N² × (sommets de A) × (sommets de B) — avec `SOMMETS_MAX = 10 000`, cela
 *   ne se termine pas.
 */
export function bboxSeRecouvrent(a: Bbox, b: Bbox): boolean {
  return !(a[2] < b[0] - EPS || b[2] < a[0] - EPS || a[3] < b[1] - EPS || b[3] < a[1] - EPS);
}

/* ------------------------------------------------------------------ primitives */

/** Signe de l'orientation du triplet (p, q, r) : >0 horaire, <0 anti, 0 aligné. */
function orientation(p: Position, q: Position, r: Position): number {
  const v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (Math.abs(v) < EPS) return 0;
  return v > 0 ? 1 : -1;
}

/** `q` est-il sur le segment [p, r] ? Suppose p, q, r alignés. */
function surSegment(p: Position, q: Position, r: Position): boolean {
  return (
    q[0] >= Math.min(p[0], r[0]) - EPS &&
    q[0] <= Math.max(p[0], r[0]) + EPS &&
    q[1] >= Math.min(p[1], r[1]) - EPS &&
    q[1] <= Math.max(p[1], r[1]) + EPS
  );
}

/**
 * Deux segments se croisent-ils en un point **intérieur aux deux** ?
 *
 * ⚠️ C'est ce test, et non « se touchent-ils », qui distingue un recouvrement
 *   d'un contact. Un croisement en T (extrémité d'un segment sur l'autre) est
 *   un contact : les surfaces ne se chevauchent pas, elles se bordent.
 */
function croisementInterieur(a1: Position, a2: Position, b1: Position, b2: Position): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  // Croisement strict : chaque segment sépare les extrémités de l'autre.
  if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4) return true;
  return false;
}

/** Deux segments ont-ils au moins un point commun (contact compris) ? */
function segmentsSeTouchent(a1: Position, a2: Position, b1: Position, b2: Position): boolean {
  if (croisementInterieur(a1, a2, b1, b2)) return true;
  if (orientation(a1, a2, b1) === 0 && surSegment(a1, b1, a2)) return true;
  if (orientation(a1, a2, b2) === 0 && surSegment(a1, b2, a2)) return true;
  if (orientation(b1, b2, a1) === 0 && surSegment(b1, a1, b2)) return true;
  if (orientation(b1, b2, a2) === 0 && surSegment(b1, a2, b2)) return true;
  return false;
}

/**
 * Le point est-il **strictement** à l'intérieur de l'anneau ?
 *
 * ⚠️ Lancé de rayon (« ray casting »), et un point situé exactement sur une
 *   arête est déclaré DEHORS. Ce choix n'est pas arbitraire : un sommet posé
 *   sur l'arête de l'autre parcelle est un contact, pas un recouvrement. Le
 *   traiter comme intérieur produirait une alerte sur deux parcelles qui se
 *   bordent.
 */
export function pointStrictementInterieur(point: Position, anneau: Position[]): boolean {
  let dedans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const pi = anneau[i];
    const pj = anneau[j];
    // Sur l'arête : dehors, par convention (voir supra).
    if (orientation(pj, pi, point) === 0 && surSegment(pj, point, pi)) return false;
    const coupe =
      pi[1] > point[1] !== pj[1] > point[1] &&
      point[0] < ((pj[0] - pi[0]) * (point[1] - pi[1])) / (pj[1] - pi[1]) + pi[0];
    if (coupe) dedans = !dedans;
  }
  return dedans;
}

/* ------------------------------------------------------------------- verdict */

/**
 * Compare deux géométries et rend le verdict.
 *
 * Ordre des tests, et pourquoi il compte :
 *   1. cadres disjoints → AUCUN (le cas de très loin le plus fréquent) ;
 *   2. un croisement intérieur ou un sommet strictement dedans → RECOUVREMENT ;
 *   3. sinon, si les tracés se touchent → CONTACT ;
 *   4. sinon → AUCUN.
 *
 * Le test 2 passe avant le 3 : deux parcelles à la fois chevauchantes et
 * bordantes doivent être signalées comme recouvrement, pas comme simple
 * contact.
 */
export function comparerParcelles(geometrieA: unknown, geometrieB: unknown): VerdictChevauchement {
  const polygonesA = polygonesDe(geometrieA);
  const polygonesB = polygonesDe(geometrieB);
  if (polygonesA.length === 0 || polygonesB.length === 0) return "AUCUN";

  const bboxA = bboxDePositions(polygonesA.flat(2));
  const bboxB = bboxDePositions(polygonesB.flat(2));
  if (!bboxA || !bboxB) return "AUCUN";
  if (!bboxSeRecouvrent(bboxA, bboxB)) return "AUCUN";

  // --- 2. recouvrement ----------------------------------------------------
  //
  // ⚠️ Chaque polygone est comparé à chaque polygone, et un point n'est
  //   « dans » un polygone que s'il est dans l'anneau extérieur ET hors de tous
  //   ses trous. Un trou est une exclusion de surface : un îlot posé dans
  //   l'enclave d'une parcelle ne la recouvre pas.
  for (const a of polygonesA) {
    for (const b of polygonesB) {
      const exterieurA = a[0];
      const exterieurB = b[0];

      // Croisement strict d'arêtes : les deux surfaces s'entrelacent.
      if (exterieursSeCroisent(exterieurA, exterieurB)) return "RECOUVREMENT";

      // L'un contient l'autre : aucun croisement, mais recouvrement de surface.
      // ⚠️ Le test se fait sur les SOMMETS des deux côtés. Un seul côté suffit
      //   dans le cas d'une inclusion franche, mais pas lorsque les sommets de
      //   l'un tombent sur les arêtes de l'autre : vérifier les deux évite d'en
      //   manquer un selon l'ordre des arguments.
      if (exterieurA.some((p) => pointDansPolygone(p, b))) return "RECOUVREMENT";
      if (exterieurB.some((p) => pointDansPolygone(p, a))) return "RECOUVREMENT";
    }
  }

  // --- 3. contact ---------------------------------------------------------
  for (const a of polygonesA) {
    for (const b of polygonesB) {
      if (exterieursSeTouchent(a[0], b[0])) return "CONTACT";
    }
  }

  return "AUCUN";
}

/** Vrai si une arête de `a` croise STRICTEMENT une arête de `b`. */
function exterieursSeCroisent(a: Position[], b: Position[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (croisementInterieur(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

/** Vrai si une arête de `a` touche une arête de `b` (contact compris). */
function exterieursSeTouchent(a: Position[], b: Position[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsSeTouchent(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

/**
 * Le point est-il dans la SURFACE d'un polygone (extérieur moins les trous) ?
 *
 * ⚠️ La soustraction des trous est ce qui distingue une enclave d'un
 *   recouvrement. Sans elle, un îlot posé dans le trou d'une parcelle serait
 *   signalé comme la recouvrant.
 */
export function pointDansPolygone(point: Position, polygone: Position[][]): boolean {
  if (polygone.length === 0) return false;
  if (!pointStrictementInterieur(point, polygone[0])) return false;
  return !polygone.slice(1).some((trou) => pointStrictementInterieur(point, trou));
}

/** Libellé affichable, sans jargon. */
export function libelleVerdict(verdict: VerdictChevauchement): string {
  return {
    AUCUN: "Aucun recoupement",
    CONTACT: "Limite partagée (contact sans recouvrement)",
    RECOUVREMENT: "Recouvrement : la surface est comptée deux fois",
  }[verdict];
}
