/**
 * Attribution d'un pays à un point — P2-16.
 *
 * ⚠️ Pourquoi ce module remplace les boîtes englobantes.
 *   La résolution précédente testait l'appartenance à des **rectangles**. Or un
 *   rectangle n'est pas un pays : la boîte « Union européenne » s'étendait de
 *   −10,5° à 31,6° de longitude et de 35° à 71° de latitude, ce qui recouvre la
 *   Tunisie, l'Algérie, le Maroc, la Serbie, le Monténégro, la Turquie et
 *   l'Ukraine. Tunis, Alger, Tanger et Belgrade étaient donc attribués à
 *   l'Union européenne, et Kiev à la Russie. Ces attributions n'étaient pas
 *   approximatives : elles étaient fausses, et présentées comme des pays.
 *
 *   La résolution se fait désormais sur les **frontières réelles** du jeu
 *   Natural Earth 1:50m, versionné dans `data/frontieres/` (cf. le
 *   `PROVENANCE.md` de ce dossier pour la source, la version et les limites).
 *
 * ⚠️ Ce que ce module ne fait pas.
 *   Il ne choisit pas un pays « le plus probable ». Si le point n'est dans
 *   aucun polygone — haute mer, zone non couverte, entité sans code ISO — le
 *   résultat est `XX` (« non déterminé ») et l'ambiguïté est consignée. Un
 *   point contesté entre deux pays riverains peut tomber dans deux polygones :
 *   les deux candidats sont alors exposés, sans arbitrage.
 */
import topologie from "../../../data/frontieres/countries-50m.json";
import correspondance from "../../../data/frontieres/iso-numerique-alpha2.json";

/** Code pays ISO 3166-1 alpha-2, ou `XX` si le point n'est attribuable à aucun. */
export type CodePays = string;

export interface ResolutionPays {
  iso2: CodePays;
  name: string;
  /** Vrai si plusieurs polygones contiennent le point (frontière contestée). */
  ambiguous: boolean;
  /** Tous les pays candidats, triés. Vide si aucun. */
  candidates: string[];
  /** Méthode employée : traçable dans la provenance de l'audit. */
  method: "natural-earth-50m";
}

/** Résolution d'un point qui n'appartient à aucun polygone connu. */
const NON_DETERMINE: ResolutionPays = {
  iso2: "XX",
  name: "Non déterminé",
  ambiguous: false,
  candidates: [],
  method: "natural-earth-50m",
};

type Anneau = number[][];

interface PaysDecode {
  iso2: CodePays;
  name: string;
  /** Polygones, chacun étant une liste d'anneaux (extérieur + trous). */
  polygones: Anneau[][];
  /** Boîte englobante précalculée : élimination rapide avant le point-dans-polygone. */
  bbox: [number, number, number, number];
}

interface TopoGeometry {
  type: string;
  id?: string;
  arcs?: number | number[] | number[][] | number[][][];
  properties?: { name?: string };
}

interface Topologie {
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: { countries: { geometries: TopoGeometry[] } };
}

const t = topologie as unknown as Topologie;
const codes = (correspondance as { codes: Record<string, string> }).codes;

/**
 * Décode un arc TopoJSON en coordonnées géographiques.
 *
 * Les arcs sont stockés en entiers relatifs (delta-encodés) puis mis à
 * l'échelle. Les recalculer une fois pour toutes évite de refaire ce travail à
 * chaque appel : 177 pays, quelques dizaines de milliers de sommets.
 */
let arcsDecodes: number[][][] | null = null;

function decoderArcs(): number[][][] {
  if (arcsDecodes) return arcsDecodes;
  const { scale, translate } = t.transform ?? { scale: [1, 1], translate: [0, 0] };
  arcsDecodes = t.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
  return arcsDecodes;
}

/** Assemble une suite d'arcs en un anneau de coordonnées. */
function anneauDepuisArcs(indices: number[]): Anneau {
  const arcs = decoderArcs();
  const points: Anneau = [];
  for (const index of indices) {
    // Un indice négatif désigne un arc parcouru à l'envers : `~i` vaut `-i-1`.
    const arc = index < 0 ? [...arcs[~index]].reverse() : arcs[index];
    // Le premier point de chaque arc répète le dernier du précédent.
    points.push(...(points.length > 0 ? arc.slice(1) : arc));
  }
  return points;
}

/** Convertit la géométrie TopoJSON d'un pays en polygones d'anneaux. */
function polygonesDuPays(geometrie: TopoGeometry): Anneau[][] {
  if (geometrie.type === "Polygon") {
    const arcs = geometrie.arcs as number[][];
    return [arcs.map(anneauDepuisArcs)];
  }
  if (geometrie.type === "MultiPolygon") {
    const arcs = geometrie.arcs as number[][][];
    return arcs.map((polygone) => polygone.map(anneauDepuisArcs));
  }
  return [];
}

let paysDecodes: PaysDecode[] | null = null;

function chargerPays(): PaysDecode[] {
  if (paysDecodes) return paysDecodes;
  paysDecodes = [];
  for (const geometrie of t.objects.countries.geometries) {
    // Sans identifiant numérique, aucune correspondance ISO n'existe : le pays
    // n'est pas attribuable (N. Cyprus, Somaliland, Kosovo). Il est ignoré ici,
    // et un point qui s'y trouve ressortira « non déterminé » — jamais le pays
    // voisin.
    const iso2 = geometrie.id ? codes[geometrie.id] : undefined;
    if (!iso2) continue;
    const polygones = polygonesDuPays(geometrie);
    if (polygones.length === 0) continue;

    let lonMin = Infinity;
    let latMin = Infinity;
    let lonMax = -Infinity;
    let latMax = -Infinity;
    for (const polygone of polygones) {
      for (const point of polygone[0] ?? []) {
        if (point[0] < lonMin) lonMin = point[0];
        if (point[0] > lonMax) lonMax = point[0];
        if (point[1] < latMin) latMin = point[1];
        if (point[1] > latMax) latMax = point[1];
      }
    }
    paysDecodes.push({
      iso2,
      name: geometrie.properties?.name ?? iso2,
      polygones,
      bbox: [lonMin, latMin, lonMax, latMax],
    });
  }
  return paysDecodes;
}

/** Test point-dans-anneau par lancer de rayon (règle pair-impair). */
function pointDansAnneau(lon: number, lat: number, anneau: Anneau): boolean {
  let dedans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [xi, yi] = anneau[i];
    const [xj, yj] = anneau[j];
    const traverse = yi > lat !== yj > lat;
    if (traverse && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      dedans = !dedans;
    }
  }
  return dedans;
}

function pointDansPolygone(lon: number, lat: number, polygone: Anneau[]): boolean {
  if (polygone.length === 0) return false;
  if (!pointDansAnneau(lon, lat, polygone[0])) return false;
  // Les anneaux suivants sont des trous (lacs, enclaves).
  for (let i = 1; i < polygone.length; i += 1) {
    if (pointDansAnneau(lon, lat, polygone[i])) return false;
  }
  return true;
}

/**
 * Résout le pays d'un point par ses frontières réelles.
 *
 * Le résultat ne dépend ni du fichier déposé, ni de la surface déclarée : les
 * seules entrées sont la longitude et la latitude.
 */
export function resoudrePays(lon: number, lat: number): ResolutionPays {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return NON_DETERMINE;

  const trouves: PaysDecode[] = [];
  for (const pays of chargerPays()) {
    const [lonMin, latMin, lonMax, latMax] = pays.bbox;
    if (lon < lonMin || lon > lonMax || lat < latMin || lat > latMax) continue;
    if (pays.polygones.some((polygone) => pointDansPolygone(lon, lat, polygone))) {
      trouves.push(pays);
    }
  }

  if (trouves.length === 0) return NON_DETERMINE;
  if (trouves.length === 1) {
    return {
      iso2: trouves[0].iso2,
      name: trouves[0].name,
      ambiguous: false,
      candidates: [trouves[0].iso2],
      method: "natural-earth-50m",
    };
  }
  // Frontière contestée : deux polygones contiennent le point. On expose les
  // candidats sans arbitrer — choisir serait inventer une souveraineté.
  const candidats = [...new Set(trouves.map((p) => p.iso2))].sort();
  return {
    iso2: "XX",
    name: "Non déterminé (frontière contestée)",
    ambiguous: true,
    candidates: candidats,
    method: "natural-earth-50m",
  };
}

/** Vrai si le module a pu charger les frontières (fail-closed si ce n'est pas le cas). */
export function frontieresDisponibles(): boolean {
  return chargerPays().length > 0;
}
