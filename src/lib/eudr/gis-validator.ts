import { SOMMETS_MAX } from "@/lib/api/limits";
import {
  EUDR_IS_COORD_DECIMALS,
  EUDR_MIN_COORD_DECIMALS,
  EUDR_POLYGON_THRESHOLD_HA,
  type GeoJsonInput,
  type GeometryValidationResult,
  type Position,
  type SupportedGeometry,
  type ValidationIssue,
} from "./types";

/** Rayon équatorial WGS84 (m). */
const WGS84_RADIUS = 6378137;
const SUPPORTED = new Set(["Point", "MultiPoint", "Polygon", "MultiPolygon"]);

class ExtractionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface PlotItem {
  geometry: Record<string, unknown>;
  properties: Record<string, unknown>;
  featureIndex: number;
}

// ---------------------------------------------------------------- Extraction
function collectPlotItems(input: GeoJsonInput): PlotItem[] {
  if (!input || typeof input !== "object" || typeof input.type !== "string") {
    throw new ExtractionError("INVALID_GEOJSON", "Objet GeoJSON invalide : champ 'type' manquant");
  }
  const type = input.type;
  if (type === "FeatureCollection") {
    const features = Array.isArray(input.features) ? (input.features as Record<string, unknown>[]) : [];
    const items: PlotItem[] = [];
    features.forEach((f, idx) => {
      if (f && typeof f === "object" && f.geometry && typeof f.geometry === "object") {
        items.push({
          geometry: f.geometry as Record<string, unknown>,
          properties: (f.properties as Record<string, unknown>) ?? {},
          featureIndex: idx,
        });
      }
    });
    if (items.length === 0) throw new ExtractionError("EMPTY_COLLECTION", "FeatureCollection vide");
    return items;
  }
  if (type === "Feature") {
    const geom = input.geometry as Record<string, unknown> | null | undefined;
    if (!geom) throw new ExtractionError("MISSING_GEOMETRY", "Feature sans géométrie");
    return [
      {
        geometry: geom,
        properties: (input.properties as Record<string, unknown>) ?? {},
        featureIndex: 0,
      },
    ];
  }
  if (type === "GeometryCollection") {
    const geoms = Array.isArray(input.geometries) ? (input.geometries as Record<string, unknown>[]) : [];
    if (geoms.length === 0) throw new ExtractionError("EMPTY_COLLECTION", "GeometryCollection vide");
    return geoms.map((g, idx) => ({ geometry: g, properties: {}, featureIndex: idx }));
  }
  return [{ geometry: input as unknown as Record<string, unknown>, properties: {}, featureIndex: 0 }];
}

// ---------------------------------------------------------------- Utilitaires numériques
function isPosition(value: unknown): value is Position {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";
}

function* iterPositions(coords: unknown): Generator<Position> {
  if (!Array.isArray(coords)) return;
  if (isPosition(coords)) {
    yield coords;
    return;
  }
  for (const item of coords) yield* iterPositions(item);
}

export function countDecimals(value: number | string): number {
  const text = String(value);
  if (/e/i.test(text)) {
    const [mantissa, exp] = text.toLowerCase().split("e");
    const frac = mantissa.includes(".") ? mantissa.split(".")[1] : "";
    return Math.max(0, frac.length - Number(exp));
  }
  if (!text.includes(".")) return 0;
  return text.split(".")[1].length;
}

/**
 * Nombre de décimales réellement écrites dans le fichier source.
 *
 * ⚠️ La mesure ne peut PAS se faire sur les valeurs parsées : `JSON.parse`
 * transforme `-5.500000` en `-5.5`, ce qui détruit l'information de précision
 * et provoquait 92 % de faux rejets (P0-05). On lit donc les littéraux du
 * texte d'origine, à l'intérieur des seuls tableaux "coordinates".
 */
export function minDecimalsFromJsonText(text: string): number | null {
  let min: number | null = null;
  let index = text.indexOf('"coordinates"');

  while (index !== -1) {
    const colon = text.indexOf(":", index);
    if (colon === -1) break;

    // Début du tableau de coordonnées
    let start = colon + 1;
    while (start < text.length && /\s/.test(text[start])) start += 1;
    if (text[start] !== "[") break;

    // Fin du tableau (profondeur des crochets)
    let depth = 0;
    let end = start;
    for (; end < text.length; end += 1) {
      const ch = text[end];
      if (ch === "[") depth += 1;
      else if (ch === "]") {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    const slice = text.slice(start, end + 1);
    for (const match of slice.matchAll(/-?\d+(?:\.\d+)?/g)) {
      const literal = match[0];
      const dot = literal.indexOf(".");
      const decimals = dot === -1 ? 0 : literal.length - dot - 1;
      if (min === null || decimals < min) min = decimals;
    }

    index = text.indexOf('"coordinates"', end);
  }

  return min;
}

function countDecimalsFromValues(allPositions: Position[]): number {
  return Math.min(...allPositions.map(([lon, lat]) => Math.min(countDecimals(lon), countDecimals(lat))));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Surface géodésique d'un anneau (m²) — algorithme Chamberlain & Duquette (NASA JPL). */
function ringArea(ring: Position[]): number {
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const lower = ring[i];
    const middle = ring[(i + 1) % n];
    const upper = ring[(i + 2) % n];
    total += (toRad(upper[0]) - toRad(lower[0])) * Math.sin(toRad(middle[1]));
  }
  return (total * WGS84_RADIUS * WGS84_RADIUS) / 2;
}

/** Surface géodésique totale (ha) d'un polygone avec trous éventuels. */
function polygonAreaHa(coords: Position[][]): number {
  if (coords.length === 0) return 0;
  let area = Math.abs(ringArea(coords[0]));
  for (let i = 1; i < coords.length; i++) {
    area -= Math.abs(ringArea(coords[i]));
  }
  return Math.max(0, area) / 10000;
}

export function geodesicAreaHa(geometry: SupportedGeometry | Record<string, unknown>): number {
  const type = geometry.type as string;
  if (type === "Point" || type === "MultiPoint") return 0;
  if (type === "Polygon") {
    return polygonAreaHa(geometry.coordinates as Position[][]);
  }
  if (type === "MultiPolygon") {
    const polys = geometry.coordinates as Position[][][];
    return polys.reduce((acc, p) => acc + polygonAreaHa(p), 0);
  }
  return 0;
}

// ---------------------------------------------------------------- Topologie
function checkRingsClosed(geom: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const type = geom.type as string;
  const rings: Position[][] = [];
  if (type === "Polygon") {
    rings.push(...((geom.coordinates as Position[][]) ?? []));
  } else if (type === "MultiPolygon") {
    for (const poly of (geom.coordinates as Position[][][]) ?? []) {
      rings.push(...poly);
    }
  }
  rings.forEach((ring, idx) => {
    if (!Array.isArray(ring) || ring.length < 4) {
      problems.push(`anneau #${idx + 1} : un polygone fermé requiert au moins 4 positions`);
      return;
    }
    const [first, last] = [ring[0], ring[ring.length - 1]];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      problems.push(`anneau #${idx + 1} : première et dernière position différentes (anneau non fermé)`);
    }
  });
  return problems;
}

function ccw(p1: Position, p2: Position, p3: Position): number {
  return (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const d1 = ccw(c, d, a);
  const d2 = ccw(c, d, b);
  const d3 = ccw(a, b, c);
  const d4 = ccw(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

/**
 * Détecte si un anneau se coupe lui-même.
 *
 * Exportée pour la mesure (P1-08) et pour les tests : le plafond de sommets
 * posé en P1-07 arrête la validation avant cette fonction dès 10 000 sommets,
 * si bien qu'aucune mesure par HTTP ne peut l'atteindre. La mesurer seule est
 * le seul moyen de savoir ce qu'elle coûte réellement.
 */
interface Arete {
  /** Rang de l'arête dans l'anneau — sert à reconnaître les arêtes voisines. */
  i: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

/**
 * Détecte si un anneau se coupe lui-même.
 *
 * ⚠️ P1-08 — ce qui a été mesuré, et pourquoi ce code a été réécrit.
 *
 * L'ancienne version comparait chaque arête à **toutes** les autres :
 * 50 000 sommets demandaient 10,9 secondes de calcul, soit 1,25 milliard de
 * couples. La loi de coût a été vérifiée par la mesure, pas lue dans le code :
 * l'exposant mesuré est de 1,92 à 2,08 — c'est bien du O(n²).
 *
 * Plus grave pour le produit : au plafond de 10 000 sommets imposé par P1-07,
 * cette seule fonction consommait **448 ms**, soit 99 % du validateur, sur le
 * thread unique de Node. Une seule parcelle détaillée monopolisait donc le
 * serveur pendant près d'une demi-seconde, toutes les autres requêtes
 * attendant derrière elle.
 *
 * La méthode retenue est un **balayage par l'abscisse** (sweep and prune) :
 *
 *   1. les arêtes sont triées une fois par borne gauche — O(n log n) ;
 *   2. on progresse vers la droite en ne gardant en mémoire que les arêtes
 *      dont l'intervalle en x recoupe la position courante ;
 *   3. chaque arête n'est comparée qu'à cette liste restreinte, et seulement
 *      après un test de boîtes englobantes en ordonnée, qui ne coûte que deux
 *      comparaisons.
 *
 * Deux arêtes qui se croisent ont nécessairement des intervalles en x
 * sécants : quand la seconde est traitée, la première est donc encore en
 * liste. Aucun croisement ne peut être manqué.
 *
 * ⚠️ Ce que cette réécriture ne fait **pas**, volontairement :
 *
 *   • le prédicat `segmentsIntersect` est conservé trait pour trait. Il ne
 *     détecte que les croisements francs, pas les recouvrements colinéaires
 *     ni les contacts en un sommet. C'est une limite héritée, constatée ici,
 *     qui relève du chantier P1-16 : la corriger dans un chantier de
 *     performance reviendrait à modifier en douce la sémantique de validation
 *     d'un dossier réglementaire.
 *   • le pire cas théorique reste quadratique, pour une géométrie conçue pour
 *     l'être (spirale dont chaque arête traverse toute la largeur). Il est
 *     borné par le plafond de sommets posé en P1-07. Mesuré et consigné.
 */
/**
 * Profondeur de recouvrement estimée sur un axe : combien d'arêtes, au plus,
 * se superposent au même endroit. C'est exactement la taille que prendrait la
 * liste active du balayage — donc la grandeur qui décide de son coût.
 *
 * Estimée sur un échantillon : la mesurer exactement coûterait un tri complet
 * par axe, aussi cher que le balayage lui-même.
 */
function profondeurEstimee(aretes: Arete[], selonX: boolean, tailleEchantillon: number): number {
  const pas = Math.max(1, Math.floor(aretes.length / tailleEchantillon));
  const evenements: Array<[number, number]> = [];
  for (let i = 0; i < aretes.length; i += pas) {
    const a = aretes[i];
    evenements.push([selonX ? a.xmin : a.ymin, 1], [selonX ? a.xmax : a.ymax, -1]);
  }
  // À coordonnée égale, les ouvertures sont traitées avant les fermetures :
  // deux arêtes qui se touchent se recouvrent, et doivent compter.
  evenements.sort((p, q) => p[0] - q[0] || q[1] - p[1]);
  let profondeur = 0;
  let max = 0;
  for (const [, delta] of evenements) {
    profondeur += delta;
    if (profondeur > max) max = profondeur;
  }
  return max;
}

/**
 * Balayage sur un axe.
 *
 * Renvoie :
 *   • `undefined` si l'élagage échoue — la liste active a dépassé la taille
 *     admise, l'axe est manifestement le mauvais. L'appelant recommencera sur
 *     l'autre axe. Le travail perdu est borné par le carré de cette taille.
 *   • une position si un croisement est trouvé ;
 *   • `null` si l'anneau est simple.
 *
 * ⚠️ `limiteActive` ne doit **jamais** servir à interrompre la recherche : un
 *    balayage abandonné faute de place rendrait un faux « anneau simple ». Il
 *    ne déclenche qu'un changement d'axe, et le second passage est toujours
 *    mené jusqu'au bout.
 */
function balayer(
  aretes: Arete[],
  selonX: boolean,
  limiteActive: number,
): Position | null | undefined {
  const n = aretes.length;
  const actives: Arete[] = [];

  for (const s of aretes) {
    const debut = selonX ? s.xmin : s.ymin;

    // Abandon des arêtes qui ne peuvent plus rien croiser. Retrait par échange
    // avec le dernier élément : l'ordre de la liste active n'a aucune
    // importance ici, et `splice` décalerait tout le tableau à chaque arête.
    for (let k = actives.length - 1; k >= 0; k--) {
      const fin = selonX ? actives[k].xmax : actives[k].ymax;
      if (fin < debut) {
        actives[k] = actives[actives.length - 1];
        actives.pop();
      }
    }

    if (actives.length > limiteActive) return undefined;

    for (let k = 0; k < actives.length; k++) {
      const t = actives[k];
      // Deux arêtes voisines dans l'anneau se touchent par construction :
      // ce contact n'est pas un défaut. `n - 1` couvre la paire formée par la
      // première et la dernière arête, qui referment l'anneau.
      const ecart = Math.abs(s.i - t.i);
      if (ecart <= 1 || ecart === n - 1) continue;
      // Boîtes disjointes sur l'axe transverse : le croisement est impossible.
      // Deux comparaisons qui écartent l'essentiel des couples sans jamais
      // toucher au prédicat géométrique.
      if (selonX) {
        if (s.ymax < t.ymin || t.ymax < s.ymin) continue;
      } else {
        if (s.xmax < t.xmin || t.xmax < s.xmin) continue;
      }
      if (segmentsIntersect([s.ax, s.ay], [s.bx, s.by], [t.ax, t.ay], [t.bx, t.by])) {
        // Le message parle d'un « voisinage » : la position indiquée est celle
        // de l'arête de plus petit rang, comme dans l'ancienne version.
        return [Math.min(s.i, t.i) === s.i ? s.ax : t.ax, Math.min(s.i, t.i) === s.i ? s.ay : t.ay];
      }
    }
    actives.push(s);
  }

  return null;
}

export function ringSelfIntersects(ring: Position[]): Position | null {
  const n = ring.length - 1;
  // Un triangle fermé ne peut pas se croiser : trois arêtes, et les seules
  // paires non voisines n'existent pas.
  if (n < 4) return null;

  const aretes: Arete[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    aretes[i] = {
      i,
      ax: a[0],
      ay: a[1],
      bx: b[0],
      by: b[1],
      xmin: Math.min(a[0], b[0]),
      xmax: Math.max(a[0], b[0]),
      ymin: Math.min(a[1], b[1]),
      ymax: Math.max(a[1], b[1]),
    };
  }

  // Choix de l'axe de balayage.
  //
  // Un balayage n'est efficace que si les arêtes se répartissent le long de
  // l'axe. Deux géométries valides l'illustrent, et chacune condamne un axe :
  //
  //   • le **peigne** (parcelleire découpé) : toutes ses arêtes se massent sur
  //     deux ordonnées ⇒ balayage par l'ordonnée inopérant, celui par
  //     l'abscisse parfait ;
  //   • le **serpentin** : toutes ses longues arêtes traversent la largeur et
  //     s'empilent en abscisse ⇒ l'inverse.
  //
  // ⚠️ Deux critères essayés se sont révélés faux, et ils sont consignés parce
  //    qu'ils paraissaient raisonnables :
  //      • « l'axe où les arêtes sont les plus courtes » choisissait
  //        l'axe dégénéré — mesuré : 8 308 ms sur le peigne ;
  //      • « l'axe où les milieux d'arêtes sont le plus dispersés » était
  //        trompé par les segments de liaison du serpentin — mesuré :
  //        12 120 ms.
  //
  // Le critère retenu est la **profondeur de recouvrement**, estimée sur un
  // échantillon : c'est la taille que prendrait la liste active, donc la
  // grandeur qui décide réellement du coût.
  const profX = profondeurEstimee(aretes, true, 1_024);
  const profY = profondeurEstimee(aretes, false, 1_024);
  const selonX = profX <= profY;

  // Filet de sécurité : si l'échantillon s'est trompé et que la liste active
  // explose, on abandonne et on reprend sur l'autre axe. Le travail perdu est
  // borné par le carré de la taille admise, soit quelques dizaines de milliers
  // d'opérations — négligeable.
  const limiteActive = Math.max(256, Math.ceil(Math.sqrt(n)));

  const trieesX = selonX ? aretes.slice().sort((p, q) => p.xmin - q.xmin) : null;
  const premier = balayer(trieesX ?? aretes.slice().sort((p, q) => p.ymin - q.ymin), selonX, limiteActive);
  if (premier !== undefined) return premier;

  // Second passage : mené jusqu'au bout, sans limite — un résultat doit
  // toujours être rendu.
  const second = balayer(
    aretes.slice().sort((p, q) => (selonX ? p.ymin - q.ymin : p.xmin - q.xmin)),
    !selonX,
    Number.POSITIVE_INFINITY,
  );
  return second ?? null;
}

function roundCoords<T>(coords: T, decimals = EUDR_IS_COORD_DECIMALS): T {
  if (Array.isArray(coords)) {
    if (isPosition(coords)) return coords.map((c) => Number(Number(c).toFixed(decimals))) as unknown as T;
    return coords.map((c) => roundCoords(c, decimals)) as unknown as T;
  }
  return coords;
}

// ---------------------------------------------------------------- API
export interface ValidateGeometryOptions {
  /** Surface déclarée par l'opérateur (saisie en base, jamais par le fichier). */
  declaredAreaHa?: number | null;
  /**
   * Texte JSON d'origine, tel que reçu. Indispensable pour mesurer la
   * précision des coordonnées sans la détruire (cf. P0-05). En son absence,
   * la précision est mesurée sur les valeurs parsées, ce qui est inexact :
   * le résultat est alors accompagné de l'avertissement PRECISION_APPROXIMATED.
   */
  rawText?: string | null;
}

/** Min ou max d'une série numérique, sans déploiement d'arguments. */
function extremum(valeurs: number[], sens: "min" | "max"): number {
  let out = sens === "min" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  for (const v of valeurs) {
    if (sens === "min" ? v < out : v > out) out = v;
  }
  return Number.isFinite(out) ? out : 0;
}


export function validateGeometry(geojson: GeoJsonInput, options: ValidateGeometryOptions | number | null = {}): GeometryValidationResult {
  // Compatibilité : second argument numérique = surface déclarée.
  const opts: ValidateGeometryOptions =
    typeof options === "number" || options === null ? { declaredAreaHa: options } : options;
  const declaredAreaHa = opts.declaredAreaHa ?? null;
  const rawText = opts.rawText ?? null;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const result: GeometryValidationResult = {
    valid: false,
    geometry_type: null,
    area_ha: 0,
    vertex_count: 0,
    centroid: null,
    bbox: null,
    precision_ok: true,
    min_decimals_found: null,
    eudr_geometry_rule: "POINT_ALLOWED",
    errors,
    warnings,
    normalized_geometry: null,
  };

  let plotItems: PlotItem[];
  try {
    plotItems = collectPlotItems(geojson);
  } catch (err) {
    const e = err as ExtractionError;
    errors.push({ code: e.code ?? "INVALID_GEOJSON", message: e.message });
    return result;
  }

  const isMultiFeature = plotItems.length > 1 || geojson.type === "FeatureCollection";
  const typesFound = new Set(plotItems.map((p) => p.geometry.type as string));

  for (const t of typesFound) {
    if (!SUPPORTED.has(t)) {
      errors.push({
        code: "UNSUPPORTED_GEOMETRY_TYPE",
        message: `Type '${t}' non supporté. EUDR : Point, MultiPoint, Polygon ou MultiPolygon`,
      });
      return result;
    }
  }

  // P1-16 — trous.
  //
  // Le SI EUDR n'accepte pas les polygones à trous (MultiPolygon à anneaux
  // intérieurs) : un tel fichier est refusé au dépôt. Le produit les acceptait,
  // si bien que le défaut n'apparaissait qu'au moment de l'export, quand la
  // parcelle est écartée du fichier — c'est-à-dire trop tard.
  //
  // ⚠️ Ceci n'est pas une préférence de format. Un anneau intérieur décrit une
  // enclave : une zone de la parcelle qui n'est pas exploitée. La traiter comme
  // une parcelle pleine surestime la surface déclarée, donc fausse l'analyse de
  // déforestation et la déclaration elle-même. Refuser est la seule conduite
  // sûre ; l'opérateur doit découper en deux parcelles distinctes.
  for (const item of plotItems) {
    const g = item.geometry;
    const ringsPerPolygon: number[] =
      g.type === "Polygon"
        ? [(g.coordinates as Position[][]).length]
        : g.type === "MultiPolygon"
          ? (g.coordinates as Position[][][]).map((poly) => poly.length)
          : [];
    const avecTrous = ringsPerPolygon.findIndex((n) => n > 1);
    if (avecTrous >= 0) {
      errors.push({
        code: "POLYGON_WITH_HOLES",
        message:
          `Parcelle #${item.featureIndex + 1} : ` +
          (g.type === "MultiPolygon"
            ? `le polygone #${avecTrous + 1} du MultiPolygon comporte ${ringsPerPolygon[avecTrous]} anneaux. `
            : `le polygone comporte ${ringsPerPolygon[avecTrous]} anneaux. `) +
          `Le SI EUDR refuse les trous (anneaux intérieurs). ` +
          `Découpez la parcelle en autant de parcelles distinctes que de zones, ` +
          `ou supprimez l'enclave si elle n'est pas exploitée.`,
      });
    }
  }
  if (errors.length > 0) return result;

  // Coordonnées & Précision
  const allPositions: Position[] = [];
  for (const item of plotItems) {
    const pos = [...iterPositions(item.geometry.coordinates)];
    if (pos.length === 0) {
      errors.push({
        code: "EMPTY_COORDINATES",
        message: `Parcelle #${item.featureIndex + 1} : aucune coordonnée trouvée`,
      });
      return result;
    }
    // `push(...pos)` est écarté : avec plusieurs dizaines de milliers de
    // positions, l'opérateur de déploiement dépasse la taille d'arguments
    // admise et lève une erreur — un plantage, pas un refus.
    for (const p of pos) allPositions.push(p);

    // P1-07 — plafond de sommets.
    // ⚠️ Mesuré avant correction : 100 000 sommets acceptés en 0,5 s, sans
    // aucun plafond. Une parcelle réelle se compte en dizaines de sommets,
    // rarement en centaines ; un littoral très découpé dépasse exceptionnel-
    // lement le millier. La limite retenue laisse donc une très large marge.
    // L'arrêt est immédiat : inutile de continuer à parcourir une géométrie
    // hostile pour lui trouver encore des défauts.
    if (allPositions.length > SOMMETS_MAX) {
      errors.push({
        code: "TOO_MANY_VERTICES",
        message: `Trop de sommets : plus de ${SOMMETS_MAX.toLocaleString("fr-FR")}. `
          + `Simplifier la géométrie ou découper la parcelle avant import.`,
      });
      return result;
    }
  }

  result.vertex_count = allPositions.length;

  const bad = allPositions.find(
    ([lon, lat]) => !Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90,
  );
  if (bad) {
    errors.push({
      code: "COORDINATES_OUT_OF_RANGE",
      message: `Coordonnée hors WGS84 : [${bad[0]}, ${bad[1]}] (attendu lon ∈ [-180,180], lat ∈ [-90,90], ordre [lon, lat])`,
    });
    return result;
  }

  // Précision mesurée sur le texte source quand il est fourni (exact),
  // sinon sur les valeurs parsées (approximation — signalée).
  let minDecimals = countDecimalsFromValues(allPositions);
  if (rawText) {
    const fromText = minDecimalsFromJsonText(rawText);
    if (fromText !== null) {
      minDecimals = fromText;
    } else {
      warnings.push({
        code: "PRECISION_APPROXIMATED",
        message: "Précision mesurée sur les valeurs parsées : le texte source n'a pas permis de l'établir.",
      });
    }
  } else {
    warnings.push({
      code: "PRECISION_APPROXIMATED",
      message:
        "Texte source absent : la précision est mesurée sur les valeurs parsées et peut être sous-estimée.",
    });
  }

  result.min_decimals_found = minDecimals;
  if (minDecimals < EUDR_MIN_COORD_DECIMALS) {
    result.precision_ok = false;
    errors.push({
      code: "INSUFFICIENT_PRECISION",
      message: `Précision insuffisante : ${minDecimals} décimale(s) détectée(s), EUDR exige au moins ${EUDR_MIN_COORD_DECIMALS} décimales (~11 cm)`,
    });
  }

  // Topologie & Règle des 4 ha par parcelle individuelle
  let totalGeodesicAreaHa = 0;
  let hasPolygonRequired = false;
  const normalizedFeatures: Record<string, unknown>[] = [];

  const numPoints = plotItems.filter((p) => p.geometry.type === "Point" || p.geometry.type === "MultiPoint").length;
  const perPointDeclared =
    declaredAreaHa !== null && declaredAreaHa !== undefined && numPoints > 0
      ? Number(declaredAreaHa) / numPoints
      : null;

  for (const item of plotItems) {
    const g = item.geometry;
    const isPoint = g.type === "Point" || g.type === "MultiPoint";

    // Anneaux fermés
    const ringProblems = checkRingsClosed(g);
    if (ringProblems.length > 0) {
      ringProblems.forEach((p) => errors.push({ code: "RING_NOT_CLOSED", message: `Parcelle #${item.featureIndex + 1} : ${p}` }));
    }

    // Auto-intersection
    if (!isPoint) {
      const polys = g.type === "Polygon" ? [(g.coordinates as Position[][])] : (g.coordinates as Position[][][]);
      for (const poly of polys ?? []) {
        for (const ring of poly) {
          const hit = ringSelfIntersects(ring);
          if (hit) {
            errors.push({
              code: "SELF_INTERSECTION",
              message: `Parcelle #${item.featureIndex + 1} topologie invalide : Self-intersection au voisinage de [${hit[0]}, ${hit[1]}]`,
            });
            return result;
          }
        }
      }
    }

    const plotArea = isPoint ? 0 : geodesicAreaHa(g);
    if (!isPoint && plotArea <= 0) {
      errors.push({ code: "DEGENERATE_POLYGON", message: `Parcelle #${item.featureIndex + 1} : polygone de surface nulle` });
      return result;
    }
    totalGeodesicAreaHa += plotArea;

    // Règle 4 ha par parcelle
    let effectivePlotArea = plotArea;
    if (isPoint) {
      // P0-03 : la surface d'un point est une DONNÉE DÉCLARATIVE. Elle ne peut
      // provenir que de la saisie de l'opérateur (champ "Surface déclarée" du
      // formulaire), jamais d'une propriété du fichier GeoJSON : un fichier est
      // une pièce fournie par un tiers et n'est pas une source de vérité.
      const plotDecArea = perPointDeclared;
      effectivePlotArea = plotDecArea ?? 0;

      if (effectivePlotArea > EUDR_POLYGON_THRESHOLD_HA) {
        hasPolygonRequired = true;
        const nameStr = (item.properties.name as string) ?? `Parcelle #${item.featureIndex + 1}`;
        errors.push({
          code: "POLYGON_REQUIRED",
          message: `${nameStr} : surface ${effectivePlotArea.toFixed(2)} ha ≥ ${EUDR_POLYGON_THRESHOLD_HA} ha. L'EUDR exige un polygone (art. 9(1)(d)), un point n'est pas suffisant.`,
        });
      } else if (declaredAreaHa === null || declaredAreaHa === undefined) {
        warnings.push({
          code: "POINT_WITHOUT_DECLARED_AREA",
          message: `Parcelle #${item.featureIndex + 1} par point sans surface déclarée : supposée < 4 ha`,
        });
      }
    } else if (plotArea > EUDR_POLYGON_THRESHOLD_HA) {
      // Règle applicable aux parcelles de PLUS de 4 ha : la valeur exactement
      // égale à 4 ha n'entre pas dans le champ de l'obligation.
      hasPolygonRequired = true;
    }

    const normG = { type: g.type, coordinates: roundCoords(g.coordinates) };
    const normProps = { ...item.properties, area_ha: Number(effectivePlotArea.toFixed(4)) };
    normalizedFeatures.push({ type: "Feature", properties: normProps, geometry: normG });
  }

  if (errors.some((e) => e.code === "RING_NOT_CLOSED")) {
    return result;
  }

  result.area_ha = Number(totalGeodesicAreaHa.toFixed(4));
  result.eudr_geometry_rule = hasPolygonRequired ? "POLYGON_REQUIRED" : "POINT_ALLOWED";

  const lons = allPositions.map((p) => p[0]);
  const lats = allPositions.map((p) => p[1]);
  result.centroid = [
    Number((lons.reduce((a, b) => a + b, 0) / lons.length).toFixed(6)),
    Number((lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(6)),
  ];
  // Bornes calculées par balayage, sans déploiement : `Math.max(...lons)`
  // échoue au-delà d'environ cent mille arguments, ce qui transformerait une
  // géométrie surdimensionnée en erreur inattendue au lieu d'un refus propre.
  result.bbox = [
    Number(extremum(lons, "min").toFixed(6)),
    Number(extremum(lats, "min").toFixed(6)),
    Number(extremum(lons, "max").toFixed(6)),
    Number(extremum(lats, "max").toFixed(6)),
  ];

  if (!isMultiFeature && plotItems.length === 1) {
    result.geometry_type = plotItems[0].geometry.type as string;
    result.normalized_geometry = normalizedFeatures[0].geometry as SupportedGeometry;
  } else {
    const pointCount = plotItems.filter((p) => p.geometry.type === "Point" || p.geometry.type === "MultiPoint").length;
    const polyCount = plotItems.length - pointCount;
    if (pointCount > 0 && polyCount > 0) {
      result.geometry_type = "FeatureCollection";
      warnings.push({
        code: "COMPOSITE_BATCH",
        message: `Lot composite : ${pointCount} point(s) (< 4 ha) et ${polyCount} polygone(s)`,
      });
    } else if (polyCount > 1) {
      result.geometry_type = "MultiPolygon";
    } else if (pointCount > 1) {
      result.geometry_type = "MultiPoint";
    } else {
      result.geometry_type = "FeatureCollection";
    }

    result.normalized_geometry = {
      type: "FeatureCollection",
      features: normalizedFeatures,
    } as unknown as SupportedGeometry;
  }

  if (totalGeodesicAreaHa > 100_000) {
    warnings.push({
      code: "SUSPICIOUS_AREA",
      message: `Surface totale anormalement grande (${Math.round(totalGeodesicAreaHa).toLocaleString("fr-FR")} ha) : vérifiez l'ordre [lon, lat]`,
    });
  }

  result.valid = errors.length === 0;
  return result;
}
