import { createHash } from "node:crypto";
import { geodesicAreaHa } from "./gis-validator";
import { resoudrePays } from "./frontieres";
import { EUDR_CUTOFF_DATE, EUDR_CUTOFF_YEAR, type AnalysisEvidence, type Position, type RiskLevel, type SatelliteCheckResult, type SupportedGeometry } from "./types";
import { incrementer, noterJauges } from "@/lib/observability/metriques";
import { journal } from "@/lib/observability/journal";

// ---------------------------------------------------------------- Benchmark pays (Commission UE, art. 29 EUDR)
/**
 * P2-16 — table de risque **par pays**, et résolution par frontières réelles.
 *
 * ⚠️ Ce qui a changé, et pourquoi.
 *   La résolution testait l'appartenance à des rectangles (`COUNTRY_BOXES`).
 *   Or un rectangle n'est pas un pays : la boîte « Union européenne » couvrait
 *   la Tunisie, l'Algérie, le Maroc, la Serbie et l'Ukraine. Tunis, Alger,
 *   Tanger et Belgrade étaient donc attribués à l'Union européenne, Kiev et
 *   Oulan-Bator à la Russie, et Hokkaido à la Russie. Ces attributions étaient
 *   fausses, et présentées comme des pays.
 *
 *   Le pays est désormais résolu par les frontières Natural Earth 1:50m
 *   versionnées dans `data/frontieres/` (cf. `frontieres.ts` et le
 *   `PROVENANCE.md` du dossier). Un point qui n'appartient à aucun pays est
 *   rendu `XX` — « non déterminé » — et non attribué au voisin le plus proche.
 *
 * ⚠️ Ce qui n'a pas changé, et ne doit pas être confondu.
 *   Le niveau de risque reste une **table interne non vérifiée**. Résoudre
 *   correctement le pays ne rend pas la classification réglementaire exacte :
 *   ce sont deux contrôles distincts. Un risque `LOW` n'est toujours pas retenu
 *   au niveau de l'audit (cf. `risqueRetenu`).
 */

/**
 * Risque déclaré par pays, repris de la table interne précédente.
 *
 * Les États membres de l'Union européenne sont ajoutés explicitement : la
 * boîte « EU » ne peut pas être conservée comme entrée, puisqu'un pays résolu
 * est désormais un vrai pays. Les valeurs elles-mêmes sont inchangées : cette
 * table n'est pas une classification officielle (cf. `verified: false`).
 */
const PAYS_UE: readonly string[] = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
];

/**
 * Pays à risque « faible » selon la table interne. Les autres pays classés
 * « élevé » figurent dans `RISQUE_ELEVE` ; tout le reste vaut `STANDARD`.
 */
const RISQUE_ELEVE: readonly string[] = ["BY", "MM", "KP", "RU"];
const RISQUE_FAIBLE: readonly string[] = [
  ...PAYS_UE,
  "US", "CA", "AU", "NZ", "JP", "CN",
];

/** Risque associé à un code ISO 3166-1 alpha-2. */
export function risquePays(iso2: string): RiskLevel {
  if (RISQUE_ELEVE.includes(iso2)) return "HIGH";
  if (RISQUE_FAIBLE.includes(iso2)) return "LOW";
  return "STANDARD";
}

/**
 * Métadonnées du référentiel de risque pays.
 *
 * ⚠️ P2-01 — ce référentiel est une **table interne**, pas la classification de
 * la Commission. Au moment de ce chantier, aucune source vérifiable, aucune
 * version officielle et aucune date d'application ne sont présentes dans le
 * dépôt : l'affirmer serait une preuve inventée. Les champs ci-dessous existent
 * pour que cette absence soit **visible dans chaque résultat**, et non découverte
 * trois ans plus tard dans un audit.
 *
 * Un niveau `LOW` n'est par ailleurs jamais retenu au niveau de l'audit : la
 * **classification** reste non vérifiée, indépendamment de la qualité de la
 * résolution géographique (cf. `risqueRetenu`).
 */
export const COUNTRY_RISK_BENCHMARK = {
  /** Origine réelle de la table de risque. */
  source: "Table interne GeoForest — non confrontée à une publication de la Commission",
  /** Aucune URL de publication vérifiable n'est connue à ce jour. */
  source_url: null as string | null,
  /** Version interne de la table (suit les modifications du fichier). */
  version: "2026-10-19",
  /** Date d'application réglementaire : inconnue. */
  applied_from: null as string | null,
  /** Vrai uniquement si la classification a été confrontée à sa source. */
  verified: false,
  /** Méthode de résolution géographique réellement employée. */
  resolution_method: "natural-earth-50m",
  /** Jeu de frontières employé, avec sa provenance. */
  borders: {
    dataset: "Natural Earth 1:50m (via world-atlas 2.0.2)",
    version: "2.0.2",
    path: "data/frontieres/countries-50m.json",
  },
} as const;

/** Limite à joindre à tout résultat qui s'appuie sur ce référentiel. */
export const LIMITE_BENCHMARK_PAYS =
  "Risque pays : table interne non vérifiée (aucune source, version ou date d'application " +
  "officielle disponible). Le pays est déduit des frontières Natural Earth 1:50m — un point " +
  "situé à moins de quelques centaines de mètres d'une frontière peut être mal attribué, et " +
  "un point hors couverture est rendu « non déterminé ». La résolution du pays ne vaut pas " +
  "classification réglementaire : un risque « faible » n'est jamais retenu au niveau de " +
  "l'audit (plancher STANDARD).";

/** Limite ajoutée lorsqu'aucun pays n'a pu être déterminé. */
export const LIMITE_PAYS_NON_DETERMINE =
  "Pays non déterminé : le point n'appartient à aucun polygone du jeu de frontières " +
  "(haute mer, zone non couverte, entité sans code ISO, ou effet de généralisation). " +
  "Aucun pays voisin n'a été substitué.";

export interface CountryResolution {
  iso2: string;
  name: string;
  /** Benchmark du pays résolu — informatif, jamais une conclusion d'audit. */
  risk: RiskLevel;
  /** Vrai si plusieurs pays contiennent le point (frontière contestée). */
  ambiguous: boolean;
  /** Tous les pays candidats, triés. Vide si aucun. */
  candidates: string[];
  /** Méthode de résolution, consignée avec l'audit. */
  method: string;
}

/**
 * Résout le pays d'un point par ses frontières réelles.
 *
 * P2-16 — remplace la recherche dans des rectangles. Le résultat porte sa
 * méthode et son ambiguïté : une résolution qui ne peut pas conclure renvoie
 * `XX`, jamais un pays « probable ».
 */
export function resolveCountry(lon: number, lat: number): CountryResolution {
  const resolution = resoudrePays(lon, lat);
  return {
    iso2: resolution.iso2,
    name: resolution.name,
    risk: resolution.iso2 === "XX" ? "STANDARD" : risquePays(resolution.iso2),
    ambiguous: resolution.ambiguous,
    candidates: resolution.candidates,
    method: resolution.method,
  };
}

/**
 * Niveau de risque retenu pour un audit.
 *
 * ⚠️ P2-01 — un risque « faible » ne peut pas être établi par un géocodage
 * approximatif : le coût d'un faux « faible » est une déclaration EUDR
 * favorable non fondée. `STANDARD` est la valeur par défaut du règlement
 * (art. 29) lorsque le pays n'est pas classé — ce n'est pas une conclusion
 * favorable. Les niveaux ÉLEVÉ/CRITIQUE restent utilisables : ils sont
 * conservateurs.
 */
export function risqueRetenu(benchmark: RiskLevel): RiskLevel {
  return benchmark === "LOW" ? "STANDARD" : benchmark;
}

// ---------------------------------------------------------------- Hotspots déterministes (mode hors-ligne)
interface LossHotspot {
  label: string;
  box: [number, number, number, number];
  lossYear: number;
  lossFraction: number;
  treeCover2000: number;
}

const LOSS_HOTSPOTS: LossHotspot[] = [
  { label: "Arc de déforestation — Pará (BR)", box: [-56.0, -10.0, -48.0, -2.0], lossYear: 2022, lossFraction: 0.42, treeCover2000: 88 },
  { label: "Riau — Sumatra (ID)", box: [100.0, -1.0, 104.0, 2.0], lossYear: 2021, lossFraction: 0.35, treeCover2000: 81 },
  { label: "Kalimantan central (ID)", box: [110.0, -3.0, 117.0, 2.0], lossYear: 2024, lossFraction: 0.27, treeCover2000: 84 },
  { label: "Sud-ouest ivoirien — Taï (CI)", box: [-8.0, 5.0, -6.0, 7.0], lossYear: 2023, lossFraction: 0.18, treeCover2000: 76 },
  { label: "Mato Grosso (BR) — perte pré-cutoff", box: [-60.0, -16.0, -52.0, -10.01], lossYear: 2019, lossFraction: 0.3, treeCover2000: 79 },
  { label: "Bassin du Congo — Tshopo (CD)", box: [24.0, -1.0, 27.0, 2.0], lossYear: 2019, lossFraction: 0.12, treeCover2000: 90 },
];


/**
 * Déplie Feature / FeatureCollection / GeometryCollection pour atteindre les
 * géométries. Sans ce dépliage, un Feature passé au moteur donnait un
 * centroïde vide, donc une absence de hotspot, donc un faux verdict conforme.
 */
function unwrapGeometries(input: SupportedGeometry): SupportedGeometry[] {
  const type = input.type as string;
  if (type === "Feature") {
    return unwrapGeometries((input as unknown as { geometry: SupportedGeometry }).geometry);
  }
  if (type === "FeatureCollection") {
    return (input as unknown as { features: { geometry: SupportedGeometry }[] }).features.flatMap((f) =>
      unwrapGeometries(f.geometry),
    );
  }
  if (type === "GeometryCollection") {
    return (input as unknown as { geometries: SupportedGeometry[] }).geometries.flatMap((g) => unwrapGeometries(g));
  }
  return [input];
}

function centroidOf(geometry: SupportedGeometry): [number, number] {
  const pts: number[][] = [];
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number") {
      pts.push(c as number[]);
      return;
    }
    c.forEach(walk);
  };
  for (const g of unwrapGeometries(geometry)) {
    walk((g as { coordinates?: unknown }).coordinates);
  }
  if (pts.length === 0) {
    throw new Error("Centroïde incalculable : aucune coordonnée exploitable dans la géométrie");
  }
  const sum = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
  return [sum[0] / pts.length, sum[1] / pts.length];
}

/** Rayon du disque substitué à un point : ≈ 55 m, soit environ 0,95 ha. */
const RAYON_POINT_DEG = 0.0005;

/**
 * P1-16 — un point n'a pas de surface, or l'analyse porte sur une surface.
 *
 * Le rayon est une **convention d'exploitation**, pas une donnée réglementaire :
 * rien dans le règlement ne fixe la surface d'un point. Elle doit donc rester
 * explicite et constante, jamais déduite de la surface déclarée — sinon la
 * déclaration de l'opérateur déterminerait l'étendue de la zone analysée, et
 * l'analyse ne ferait que confirmer ce qu'il a écrit.
 */
function disqueAutour([lon, lat]: Position): Position[] {
  const ring: Position[] = [];
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    ring.push([lon + RAYON_POINT_DEG * Math.cos(a), lat + RAYON_POINT_DEG * Math.sin(a)]);
  }
  return ring;
}

function bufferPoint(geometry: SupportedGeometry): SupportedGeometry {
  if (geometry.type === "Point") {
    return { type: "Polygon", coordinates: [disqueAutour(geometry.coordinates as Position)] };
  }
  if (geometry.type === "MultiPoint") {
    // Avant P1-16 : on prenait le centre de l'ensemble des points et l'on n'en
    // traçait qu'un seul disque. Un lot de dix points répartis sur dix
    // kilomètres était donc analysé comme un unique carré de 110 m au milieu
    // de nulle part — une analyse qui ne portait sur aucune des parcelles
    // déclarées, tout en étant présentée comme telle.
    const points = geometry.coordinates as Position[];
    if (points.length === 1) {
      return { type: "Polygon", coordinates: [disqueAutour(points[0])] };
    }
    return { type: "MultiPolygon", coordinates: points.map((p) => [disqueAutour(p)]) };
  }
  return geometry;
}

/**
 * Réduit n'importe quel GeoJSON reçu — Feature, FeatureCollection,
 * GeometryCollection ou géométrie nue — à une **seule** géométrie
 * Polygon ou MultiPolygon.
 *
 * P1-16 — l'API du fournisseur satellite attend une géométrie. Or la géométrie
 * normalisée d'un lot de plusieurs parcelles est une FeatureCollection : elle
 * était envoyée telle quelle et refusée, si bien qu'un lot multi-parcelles ne
 * déclenchait jamais d'analyse réelle — le produit le traitait comme simulé
 * sans le dire.
 */
export function aplatirPourAnalyse(input: SupportedGeometry): SupportedGeometry {
  const geometries = unwrapGeometries(input);
  const polygones: Position[][][] = [];
  const points: Position[] = [];

  for (const g of geometries) {
    const t = g.type as string;
    if (t === "Point") {
      points.push(g.coordinates as Position);
    } else if (t === "MultiPoint") {
      for (const p of g.coordinates as Position[]) points.push(p);
    } else if (t === "Polygon") {
      // Chaque anneau est conservé : les trous sont refusés en amont (P1-16),
      // mais une géométrie enregistrée avant le correctif peut en comporter.
      for (const anneau of g.coordinates as Position[][]) polygones.push([anneau]);
    } else if (t === "MultiPolygon") {
      for (const poly of g.coordinates as Position[][][]) polygones.push(poly);
    }
  }

  for (const p of points) polygones.push([disqueAutour(p)]);

  if (polygones.length === 0) {
    throw new Error("Géométrie inexploitable : ni polygone ni point n'a été trouvé");
  }
  if (polygones.length === 1) {
    return { type: "Polygon", coordinates: polygones[0] };
  }
  return { type: "MultiPolygon", coordinates: polygones };
}

/** Fraction pseudo-aléatoire stable, dérivée d'un condensat. */
function stableFraction(seed: string): number {
  const digest = createHash("sha256").update(seed).digest("hex");
  return parseInt(digest.slice(0, 8), 16) / 0xffffffff;
}

// ---------------------------------------------------------------- Moteur déterministe
/** Moteur de repli hors ligne : résultat déterministe, jamais une analyse réelle. */
/**
 * Provenance complète d'une analyse — P1-10.
 *
 * ⚠️ Un verdict sans méthode n'est pas un résultat, c'est un chiffre. Relire
 *   un audit trois ans après sans savoir **quoi** a été interrogé, **dans
 *   quelle version**, avec **quels paramètres** et **sous quelles limites**,
 *   c'est relire une mesure sans unité : on ne peut ni la défendre devant un
 *   contrôle, ni même savoir si elle est encore valable.
 *
 * Les limites sont consignées aussi soigneusement que le résultat. Un audit
 * qui ne dit pas ce qu'il n'a pas pu mesurer se fait passer pour plus complet
 * qu'il n'est — et c'est une affirmation de conformité déguisée.
 */
export interface AnalyseProvenance {
  /** Méthode employée. `aucune` quand l'analyse n'a pas pu être menée. */
  method: "gfw-live" | "deterministic-demo" | "aucune";
  /** Version du jeu de données réellement servi, quand elle est connue. */
  version: string | null;
  /** Paramètres transmis — jamais les valeurs par défaut supposées. */
  params: Record<string, unknown>;
  /** Ce que l'analyse n'a pas pu établir. Jamais vide. */
  limits: string[];
}

/**
 * Limites inhérentes à toute analyse de couvert arboré : elles ne dépendent
 * pas de la méthode employée, et une analyse qui les tairait laisserait croire
 * qu'elle a tout mesuré.
 */
const LIMITES_METHODE_COUVERT = [
  "Résolution native du capteur : 30 m — une parcelle ou une coupe de moins de 0,09 ha n'est pas détectable.",
  "Le jeu de données mesure la perte de couvert arboré, pas la cause de cette perte : une coupe légale et une déforestation illégale y sont indiscernables.",
  "La perte est datée de l'année, pas du jour : la chronologie fine d'une récolte n'est pas établie par cette analyse.",
];

export function deterministicCheck(geometry: SupportedGeometry, harvestDate: string): SatelliteCheckResult {
  const [lon, lat] = centroidOf(geometry);
  const country = resolveCountry(lon, lat);
  const jitter = stableFraction(`${lon.toFixed(4)}:${lat.toFixed(4)}`);

  let lossYear: number | null = null;
  let lossFraction = 0;
  let treeCover = Number((35 + jitter * 40).toFixed(1));
  let hotspotLabel: string | null = null;

  for (const spot of LOSS_HOTSPOTS) {
    const [lonMin, latMin, lonMax, latMax] = spot.box;
    if (lon >= lonMin && lon <= lonMax && lat >= latMin && lat <= latMax) {
      lossYear = spot.lossYear;
      lossFraction = spot.lossFraction;
      treeCover = spot.treeCover2000;
      hotspotLabel = spot.label;
      break;
    }
  }

  const areaHa = geodesicAreaHa(geometry);
  const lossArea = areaHa > 0 ? Number((areaHa * lossFraction).toFixed(4)) : lossYear ? 0.05 : 0;

  let details: string;
  if (lossYear !== null && lossYear > EUDR_CUTOFF_YEAR) {
    details =
      `Simulation : scénario de démonstration « ${hotspotLabel} », perte de ${lossArea} ha ` +
      `en ${lossYear}. Ces chiffres sont **inventés pour la démonstration**.`;
  } else if (lossYear !== null) {
    details = `Simulation : scénario de démonstration « ${hotspotLabel} », perte historique ${lossYear}. Chiffres inventés.`;
  } else {
    details =
      `Simulation : aucun scénario de démonstration ne couvre cette position. ` +
      `Pays : ${country.name} (${country.iso2}), benchmark UE déclaré : ${country.risk}.`;
  }
  if (harvestDate <= EUDR_CUTOFF_DATE) details += " Récolte antérieure à la date butoir : hors champ temporel EUDR.";

  return {
    // P0-04 : un moteur de démonstration ne rend PAS de verdict. Les valeurs
    // affichées sont présentées pour ce qu'elles sont : un jeu d'essai.
    compliant: null,
    loss_year: lossYear,
    confidence_score: null,
    risk_level: risqueRetenu(country.risk),
    country_code: country.iso2,
    country_name: country.name,
    country_risk: country.risk,
    source: "simulated",
    is_probative: false,
    evidence: null,
    // P1-10 — le jeu d'essai est nommé comme tel, avec ses limites : le lire
    // dans trois ans ne doit laisser aucun doute sur ce qu'il est.
    provenance: {
      method: "deterministic-demo",
      version: null,
      params: {
        date_butoir: EUDR_CUTOFF_DATE,
        scenarios_disponibles: LOSS_HOTSPOTS.length,
        scenario_retenu: hotspotLabel,
        resolution_pays: COUNTRY_RISK_BENCHMARK.resolution_method,
        pays_candidats: country.candidates,
        pays_ambigu: country.ambiguous,
        methode_resolution_pays: country.method,
        benchmark_pays: COUNTRY_RISK_BENCHMARK,
      },
      limits: [
        "Aucune donnée satellite n'a été consultée : les chiffres sont inventés pour la démonstration.",
        "Le pays est déterminé par les frontières Natural Earth 1:50m, non par géocodage inverse.",
        LIMITE_BENCHMARK_PAYS,
        ...(country.iso2 === "XX" ? [LIMITE_PAYS_NON_DETERMINE] : []),
        ...LIMITES_METHODE_COUVERT,
      ],
    },
    disclaimer:
      "Analyse simulée — résultat non probant. Aucune donnée satellite n'a été consultée : " +
      "ce résultat ne peut pas servir de preuve de conformité au règlement (UE) 2023/1115.",
    loss_area_ha: lossArea,
    tree_cover_2000_pct: treeCover,
    details,
  };
}

/**
 * Résultat d'une analyse qui n'a pas pu être menée.
 *
 * Il n'y a **pas de repli silencieux** vers le moteur déterministe (P0-04) :
 * une indisponibilité est un fait que l'on déclare, pas un verdict que l'on
 * remplace par une estimation.
 */
function unavailableResult(geometry: SupportedGeometry, reason: string): SatelliteCheckResult {
  // ⚠️ P2-07 — le centroïde n'existe pas toujours : une FeatureCollection vide
  // ou une géométrie sans coordonnée n'en a aucun. L'ancien code levait ici
  // (« Centroïde incalculable »), si bien qu'une analyse *déjà* indisponible
  // finissait en exception non gérée au lieu d'un résultat `unavailable`.
  let centroid: [number, number] | null = null;
  try {
    centroid = centroidOf(geometry);
  } catch {
    centroid = null;
  }
  const country: CountryResolution = centroid
    ? resolveCountry(centroid[0], centroid[1])
    : {
        iso2: "XX",
        name: "Non déterminé",
        risk: "STANDARD",
        ambiguous: false,
        candidates: [],
        method: COUNTRY_RISK_BENCHMARK.resolution_method,
      };
  return {
    compliant: null,
    loss_year: null,
    confidence_score: null,
    // ⚠️ P2-01 — une analyse indisponible ne peut pas produire un risque
    // « faible » : le niveau affiché est le plancher STANDARD du benchmark.
    risk_level: risqueRetenu(country.risk),
    country_code: country.iso2,
    country_name: country.name,
    country_risk: country.risk,
    source: "unavailable",
    is_probative: false,
    evidence: null,
    // P1-10 — la raison de l'indisponibilité est consignée avec l'audit :
    // sans elle, un audit vide se relirait comme une absence d'anomalie.
    provenance: {
      method: "aucune",
      version: null,
      params: {
        resolution_pays: COUNTRY_RISK_BENCHMARK.resolution_method,
        pays_candidats: country.candidates,
        pays_ambigu: country.ambiguous,
        methode_resolution_pays: country.method,
        benchmark_pays: COUNTRY_RISK_BENCHMARK,
      },
      limits: [
        reason,
        "Aucun verdict de conformité n'a été établi.",
        LIMITE_BENCHMARK_PAYS,
        ...(country.iso2 === "XX" ? [LIMITE_PAYS_NON_DETERMINE] : []),
        ...LIMITES_METHODE_COUVERT,
      ],
    },
    disclaimer:
      "Analyse non disponible — aucun verdict de conformité n'a été établi. " +
      "Aucune conclusion ne doit en être tirée pour un dossier EUDR.",
    loss_area_ha: 0,
    tree_cover_2000_pct: null,
    details: centroid
      ? `Analyse satellite impossible : ${reason}. Pays déduit des coordonnées : ${country.name} (${country.iso2}).`
      : `Analyse satellite impossible : ${reason}. Aucune coordonnée exploitable : le pays n'a pas pu être déterminé.`,
  };
}

// ---------------------------------------------------------------- Moteur live Global Forest Watch
const GFW_SQL =
  "SELECT umd_tree_cover_loss__year, SUM(area__ha) AS area__ha FROM results " +
  "WHERE umd_tree_cover_density_2000__threshold = 30 GROUP BY umd_tree_cover_loss__year ORDER BY umd_tree_cover_loss__year";

/** Observation de perte, après validation stricte de la ligne fournisseur. */
interface GfwObservation {
  year: number;
  area: number;
}

/**
 * Réponse du fournisseur qui ne peut pas être interprétée.
 *
 * ⚠️ P2-02 — une réponse illisible **n'est pas** une absence de perte. Avant
 * ce correctif, `payload.data ?? []` transformait `{"data": null}`, un champ
 * manquant, une ligne sans année ou une surface négative en `0 ha de perte`,
 * donc en verdict `CONFORME` avec `is_probative: true`. C'est la faute la plus
 * grave que puisse commettre ce moteur : elle fabrique une preuve.
 */
class GfwResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GfwResponseError";
  }
}

/** Nombre strictement numérique, éventuellement sérialisé en chaîne. */
function nombreStrict(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Valide la charge utile GFW et renvoie les observations.
 *
 * Règles, toutes vérifiables par test :
 *   • la charge utile doit être un objet JSON (pas un tableau, pas `null`) ;
 *   • `data` doit être un **tableau** — son absence est une réponse
 *     malformée, pas une absence de perte ;
 *   • chaque ligne doit porter une année entière plausible et une surface
 *     finie, positive ou nulle ;
 *   • un tableau vide est accepté : c'est une observation négative du
 *     fournisseur, assortie d'une limite de couverture explicite.
 */
export function parseGfwRows(payload: unknown): GfwObservation[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new GfwResponseError("charge utile JSON inattendue (objet attendu)");
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new GfwResponseError("champ 'data' absent ou non tableau — réponse du fournisseur illisible");
  }
  return data.map((row, index) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new GfwResponseError(`ligne #${index + 1} illisible (objet attendu)`);
    }
    const year = nombreStrict((row as Record<string, unknown>).umd_tree_cover_loss__year);
    const area = nombreStrict((row as Record<string, unknown>).area__ha);
    if (year === null || !Number.isInteger(year) || year < 1900 || year > 2100) {
      throw new GfwResponseError(`ligne #${index + 1} : année de perte absente ou illisible`);
    }
    if (area === null || area < 0) {
      throw new GfwResponseError(`ligne #${index + 1} : surface de perte absente, illisible ou négative`);
    }
    return { year, area };
  });
}

/** Limite à joindre quand le fournisseur ne retourne aucune ligne. */
export const LIMITE_REPONSE_VIDE =
  "Réponse du fournisseur sans aucune ligne : elle établit l'absence de perte déclarée pour " +
  "l'emprise interrogée, mais ne distingue pas « aucune perte » d'une « absence de couverture " +
  "du jeu de données » (océan, zone non couverte, géométrie non intersectée).";

/** Limite à joindre quand la version du jeu de données n'a pas été épinglée. */
export const LIMITE_VERSION_NON_EPINGLEE =
  "Version du jeu de données non épinglée (« latest ») : le résultat n'est pas reproductible " +
  "dans le temps et ne doit pas être présenté comme une mesure figée.";

interface GfwQueryResult {
  observations: GfwObservation[];
  evidence: AnalysisEvidence;
  /** Surface réellement envoyée au fournisseur (ha). */
  analyzedAreaHa: number;
}

/** Hôte du service officiel. Toute autre adresse est un service distinct. */
const GFW_HOTE_OFFICIEL = "data-api.globalforestwatch.org";

/**
 * Nomme le fournisseur d'après l'hôte **réellement** appelé.
 *
 * P1-16 — le nom « Global Forest Watch » était inscrit en dur dans la trace
 * d'analyse. Une instance configurée sur un autre service — un cache
 * intermédiaire, un service interne, ou un banc d'essai — produisait donc une
 * trace affirmant une provenance fausse. C'est exactement ce que la
 * traçabilité EUDR a pour objet d'empêcher.
 */
function nommerFournisseur(baseUrl: string): { provider: string; officiel: boolean } {
  let host = baseUrl.toLowerCase();
  try {
    host = new URL(baseUrl).host.toLowerCase();
  } catch {
    /* adresse non analysable : on garde la chaîne brute */
  }
  if (host === GFW_HOTE_OFFICIEL) {
    return { provider: "Global Forest Watch (World Resources Institute)", officiel: true };
  }
  return { provider: `Service configuré (${host}) — distinct de Global Forest Watch`, officiel: false };
}

async function gfwQuery(geometry: SupportedGeometry): Promise<GfwQueryResult> {
  const base = (process.env.GFW_API_URL ?? "https://data-api.globalforestwatch.org").replace(/\/$/, "");
  const dataset = process.env.GFW_DATASET ?? "umd_tree_cover_loss";
  const version = process.env.GFW_DATASET_VERSION ?? "latest";
  // L'API expose la ressource sous /query/json. L'ancien chemin /query renvoyait
  // une redirection 307 : on l'appelle directement pour économiser deux allers-
  // retours et, surtout, pour que la version interrogée soit explicite.
  const endpoint = `${base}/dataset/${dataset}/${version}/query/json`;
  const sentGeometry = aplatirPourAnalyse(geometry);
  // ⚠️ La surface qui décide du seuil de significativité doit être celle qui a
  // été **réellement envoyée** au fournisseur. L'ancien code retombait sur 1 ha
  // pour un point, alors que la requête portait sur un disque de ~0,95 ha : le
  // seuil et la fraction étaient calculés sur une surface qui n'existait pas.
  const analyzedAreaHa = geodesicAreaHa(sentGeometry);
  if (!(analyzedAreaHa > 0)) {
    throw new Error("emprise d'analyse de surface nulle : aucune requête satellite fiable n'est possible");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GFW_TIMEOUT_SECONDS ?? "15") * 1000);
  // ------------------------------------------------------------------ P1-06
  // ⚠️ La disponibilité du fournisseur satellite est mesurée **sur les appels
  //   réels**, pas sur une sonde inventive : sonder Global Forest Watch de
  //   gaieté de cœur consommerait du quota et pourrait faire croire à une
  //   panne que personne n'a cherché à provoquer. Ce sont donc les appels du
  //   métier qui alimentent la jauge, et son absence d'appel est elle-même une
  //   information (« non mesuré »), jamais un « tout va bien ».
  const debutAppel = Date.now();
  noterJauges("gfw_appels", incrementer("gfw_appels"));
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "x-api-key": process.env.GFW_API_KEY ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: GFW_SQL, geometry: sentGeometry }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GFW HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
    }
    noterJauges("gfw_disponible", 1);
    noterJauges("gfw_latence_ms", Date.now() - debutAppel);
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new GfwResponseError("corps de réponse non JSON — réponse du fournisseur illisible");
    }
    // P2-02 — validation stricte : une réponse malformée lève, elle ne devient
    // jamais « 0 ha de perte ».
    const observations = parseGfwRows(payload);
    // La version réellement servie est déduite de l'URL finale : elle est
    // consignée pour qu'un audit ancien reste reproductible.
    const servedVersion = /\/dataset\/[^/]+\/([^/]+)\//.exec(res.url)?.[1] ?? version;
    return {
      observations,
      analyzedAreaHa,
      evidence: {
        provider: nommerFournisseur(base).provider,
        is_official_source: nommerFournisseur(base).officiel,
        dataset,
        dataset_version: servedVersion,
        endpoint,
        sql: GFW_SQL,
        geometry_type: sentGeometry.type,
        retrieved_at: new Date().toISOString(),
      },
    };
  } catch (error) {
    noterJauges("gfw_disponible", 0);
    noterJauges("gfw_echecs", incrementer("gfw_echecs"));
    journal.warn("gfw.appel_en_echec", {
      endpoint,
      dureeMs: Date.now() - debutAppel,
      erreur: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function liveCheck(geometry: SupportedGeometry, harvestDate: string): Promise<SatelliteCheckResult> {
  const { observations, evidence, analyzedAreaHa } = await gfwQuery(geometry);
  const [lon, lat] = centroidOf(geometry);
  const country = resolveCountry(lon, lat);

  const post = observations.filter((r) => r.year > EUDR_CUTOFF_YEAR);
  const lossArea = Number(post.reduce((acc, r) => acc + r.area, 0).toFixed(4));
  const seuil = Number(Math.max(0.01, analyzedAreaHa * 0.005).toFixed(4));
  const significant = lossArea >= seuil;
  const reponseVide = observations.length === 0;
  const versionEpinglee = evidence.dataset_version !== "latest" && evidence.dataset_version !== "";

  // Limites de l'analyse : elles disent ce que le résultat ne mesure pas.
  const limites: string[] = [
    ...LIMITES_METHODE_COUVERT,
    LIMITE_BENCHMARK_PAYS,
    ...(reponseVide ? [LIMITE_REPONSE_VIDE] : []),
    ...(versionEpinglee ? [] : [LIMITE_VERSION_NON_EPINGLEE]),
    "Le score de confiance est une convention d'affichage du produit, non une mesure de qualité fournie par le fournisseur.",
  ];

  const paramsCommuns = {
    jeu_de_donnees: evidence.dataset,
    version_jeu_de_donnees: evidence.dataset_version,
    fournisseur: evidence.provider,
    fournisseur_officiel: evidence.is_official_source,
    seuil_significativite_ha: seuil,
    surface_analysee_ha: Number(analyzedAreaHa.toFixed(4)),
    date_butoir: EUDR_CUTOFF_DATE,
    date_recolte: harvestDate,
    resolution_pays: COUNTRY_RISK_BENCHMARK.resolution_method,
    pays_candidats: country.candidates,
    pays_ambigu: country.ambiguous,
    methode_resolution_pays: country.method,
    benchmark_pays: COUNTRY_RISK_BENCHMARK,
  };

  if (significant) {
    const lossYear = Math.min(...post.map((r) => r.year));
    const fraction = Math.min(lossArea / analyzedAreaHa, 1);
    return {
      compliant: false,
      loss_year: lossYear,
      confidence_score: Number(Math.min(0.99, 0.8 + fraction * 0.5).toFixed(3)),
      risk_level: "HIGH",
      country_code: country.iso2,
      country_name: country.name,
      country_risk: country.risk,
      source: "gfw-live",
      is_probative: true,
      evidence,
      provenance: {
        method: "gfw-live",
        version: evidence.dataset_version,
        params: paramsCommuns,
        limits: limites,
      },
      disclaimer: null,
      loss_area_ha: lossArea,
      tree_cover_2000_pct: null,
      details:
        `${evidence.provider.split(" (")[0]} ${evidence.dataset_version} : ${lossArea} ha de perte de couvert ` +
        `détectés à partir de ${lossYear} (post-2020) sur ${analyzedAreaHa.toFixed(2)} ha. ` +
        `Données Hansen/UMD, seuil de densité 30 %.`,
    };
  }

  const historic = observations.length ? Math.max(...observations.map((r) => r.year)) : null;
  return {
    compliant: true,
    loss_year: historic,
    confidence_score: 0.95,
    // P2-01 — plancher STANDARD : un géocodage approximatif ne peut pas
    // établir un risque faible.
    risk_level: risqueRetenu(country.risk),
    country_code: country.iso2,
    country_name: country.name,
    country_risk: country.risk,
    source: "gfw-live",
    is_probative: true,
    evidence,
    provenance: {
      method: "gfw-live",
      version: evidence.dataset_version,
      params: paramsCommuns,
      limits: limites,
    },
    disclaimer: null,
    loss_area_ha: lossArea,
    tree_cover_2000_pct: null,
    details:
      `${evidence.provider.split(" (")[0]} ${evidence.dataset_version} : ` +
      (reponseVide
        ? "aucune ligne de perte retournée par le fournisseur (0 ha). "
        : `aucune perte significative post-2020 (${lossArea} ha). `) +
      `Pays : ${country.name}, benchmark UE : ${country.risk}.`,
  };
}

/** Vrai si une clé d'API GFW est configurée et l'accès direct activé. */
export function gfwConfigured(): boolean {
  const enabled = (process.env.GFW_LIVE_ENABLED ?? "true").toLowerCase() !== "false";
  return enabled && Boolean(process.env.GFW_API_KEY);
}

/** Vrai si le moteur de démonstration est explicitement autorisé. */
export function demoModeEnabled(): boolean {
  return (process.env.GFW_DEMO_MODE ?? "false").toLowerCase() === "true";
}

/**
 * Évalue le risque de déforestation post-2020 sur une géométrie normalisée.
 *
 * Trois issues, et une seule étant probante :
 *  1. accès GFW configuré et disponible  → verdict fondé sur des données réelles ;
 *  2. accès GFW configuré mais défaillant → **aucun verdict** (jamais de repli
 *     silencieux vers une simulation : c'est l'objet même de P0-04) ;
 *  3. non configuré                       → simulation seulement si le mode
 *     démonstration est explicitement activé, sinon aucun verdict.
 *
 * Le verdict ne dépend dans tous les cas que de la géométrie, de la date de
 * récolte et des données GFW : aucune propriété du fichier déposé ne peut
 * l'influencer (P0-03).
 */
export async function checkDeforestationRisk(
  geometry: SupportedGeometry,
  harvestDate: string,
): Promise<SatelliteCheckResult> {
  if (gfwConfigured()) {
    try {
      return await liveCheck(geometry, harvestDate);
    } catch (err) {
      const reason = (err as Error).name === "AbortError"
        ? `délai dépassé (${process.env.GFW_TIMEOUT_SECONDS ?? "15"} s)`
        : (err as Error).message;
      console.error("[GFW] analyse directe impossible — aucun verdict émis :", reason);
      return unavailableResult(geometry, reason);
    }
  }

  if (demoModeEnabled()) {
    console.warn("[GFW] mode démonstration activé : résultat simulé, non probant.");
    return deterministicCheck(geometry, harvestDate);
  }

  return unavailableResult(
    geometry,
    "aucune source de données satellite configurée (GFW_API_KEY absente) et mode démonstration désactivé",
  );
}
