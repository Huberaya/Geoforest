import { createHash } from "node:crypto";
import { geodesicAreaHa } from "./gis-validator";
import { EUDR_CUTOFF_DATE, EUDR_CUTOFF_YEAR, type AnalysisEvidence, type Position, type RiskLevel, type SatelliteCheckResult, type SupportedGeometry } from "./types";
import { incrementer, noterJauges } from "@/lib/observability/metriques";
import { journal } from "@/lib/observability/journal";

// ---------------------------------------------------------------- Benchmark pays (Commission UE, art. 29 EUDR)
interface CountryBox {
  iso2: string;
  name: string;
  box: [number, number, number, number]; // lonMin, latMin, lonMax, latMax
  risk: RiskLevel;
}

const COUNTRY_BOXES: CountryBox[] = [
  { iso2: "BY", name: "Biélorussie", box: [23.1, 51.2, 32.8, 56.2], risk: "HIGH" },
  { iso2: "MM", name: "Myanmar", box: [92.1, 9.5, 101.2, 28.6], risk: "HIGH" },
  { iso2: "KP", name: "Corée du Nord", box: [124.1, 37.6, 130.7, 43.0], risk: "HIGH" },
  { iso2: "RU", name: "Russie", box: [27.3, 41.1, 180.0, 81.9], risk: "HIGH" },
  { iso2: "CI", name: "Côte d'Ivoire", box: [-8.6, 4.3, -2.5, 10.8], risk: "STANDARD" },
  { iso2: "GH", name: "Ghana", box: [-3.3, 4.7, 1.2, 11.2], risk: "STANDARD" },
  { iso2: "NG", name: "Nigeria", box: [2.6, 4.2, 14.7, 13.9], risk: "STANDARD" },
  { iso2: "CM", name: "Cameroun", box: [8.4, 1.6, 16.2, 13.1], risk: "STANDARD" },
  { iso2: "CD", name: "RD Congo", box: [12.2, -13.5, 31.3, 5.4], risk: "STANDARD" },
  { iso2: "UG", name: "Ouganda", box: [29.5, -1.5, 35.0, 4.2], risk: "STANDARD" },
  { iso2: "ET", name: "Éthiopie", box: [32.9, 3.4, 48.0, 14.9], risk: "STANDARD" },
  { iso2: "KE", name: "Kenya", box: [33.9, -4.7, 41.9, 5.5], risk: "STANDARD" },
  { iso2: "TZ", name: "Tanzanie", box: [29.3, -11.8, 40.5, -0.9], risk: "STANDARD" },
  { iso2: "LR", name: "Liberia", box: [-11.5, 4.3, -7.4, 8.6], risk: "STANDARD" },
  { iso2: "ID", name: "Indonésie", box: [95.0, -11.0, 141.0, 6.1], risk: "STANDARD" },
  { iso2: "MY", name: "Malaisie", box: [99.6, 0.8, 119.3, 7.4], risk: "STANDARD" },
  { iso2: "VN", name: "Vietnam", box: [102.1, 8.4, 109.5, 23.4], risk: "STANDARD" },
  { iso2: "TH", name: "Thaïlande", box: [97.3, 5.6, 105.7, 20.5], risk: "STANDARD" },
  { iso2: "PG", name: "Papouasie-Nouvelle-Guinée", box: [140.8, -11.7, 156.0, -1.3], risk: "STANDARD" },
  { iso2: "IN", name: "Inde", box: [68.1, 6.7, 97.4, 35.5], risk: "STANDARD" },
  { iso2: "BR", name: "Brésil", box: [-74.0, -33.8, -34.8, 5.3], risk: "STANDARD" },
  { iso2: "CO", name: "Colombie", box: [-79.0, -4.2, -66.9, 12.5], risk: "STANDARD" },
  { iso2: "PE", name: "Pérou", box: [-81.4, -18.4, -68.7, -0.03], risk: "STANDARD" },
  { iso2: "EC", name: "Équateur", box: [-81.1, -5.0, -75.2, 1.7], risk: "STANDARD" },
  { iso2: "BO", name: "Bolivie", box: [-69.6, -22.9, -57.5, -9.7], risk: "STANDARD" },
  { iso2: "PY", name: "Paraguay", box: [-62.7, -27.6, -54.3, -19.3], risk: "STANDARD" },
  { iso2: "AR", name: "Argentine", box: [-73.6, -55.1, -53.6, -21.8], risk: "STANDARD" },
  { iso2: "HN", name: "Honduras", box: [-89.4, 12.9, -83.1, 16.5], risk: "STANDARD" },
  { iso2: "GT", name: "Guatemala", box: [-92.3, 13.7, -88.2, 17.8], risk: "STANDARD" },
  { iso2: "NI", name: "Nicaragua", box: [-87.7, 10.7, -83.1, 15.0], risk: "STANDARD" },
  { iso2: "CR", name: "Costa Rica", box: [-85.9, 8.0, -82.6, 11.2], risk: "STANDARD" },
  { iso2: "MX", name: "Mexique", box: [-118.4, 14.5, -86.7, 32.7], risk: "STANDARD" },
  { iso2: "US", name: "États-Unis", box: [-125.0, 24.5, -66.9, 49.4], risk: "LOW" },
  { iso2: "CA", name: "Canada", box: [-141.0, 41.7, -52.6, 83.1], risk: "LOW" },
  { iso2: "AU", name: "Australie", box: [113.3, -43.6, 153.6, -10.7], risk: "LOW" },
  { iso2: "NZ", name: "Nouvelle-Zélande", box: [166.5, -47.3, 178.6, -34.4], risk: "LOW" },
  { iso2: "JP", name: "Japon", box: [129.4, 31.0, 145.8, 45.5], risk: "LOW" },
  { iso2: "CN", name: "Chine", box: [73.5, 18.2, 134.8, 53.6], risk: "LOW" },
  { iso2: "EU", name: "Union européenne", box: [-10.5, 35.0, 31.6, 71.2], risk: "LOW" },
];

export function resolveCountry(lon: number, lat: number): { iso2: string; name: string; risk: RiskLevel } {
  for (const c of COUNTRY_BOXES) {
    const [lonMin, latMin, lonMax, latMax] = c.box;
    if (lon >= lonMin && lon <= lonMax && lat >= latMin && lat <= latMax) return { iso2: c.iso2, name: c.name, risk: c.risk };
  }
  return { iso2: "XX", name: "Non déterminé", risk: "STANDARD" };
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
    risk_level: country.risk,
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
        resolution_pays: "boîte englobante",
      },
      limits: [
        "Aucune donnée satellite n'a été consultée : les chiffres sont inventés pour la démonstration.",
        "Le pays est déterminé par boîte englobante, non par géocodage inverse (cf. P1-09).",
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
  const [lon, lat] = centroidOf(geometry);
  const country = resolveCountry(lon, lat);
  return {
    compliant: null,
    loss_year: null,
    confidence_score: null,
    risk_level: country.risk,
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
      params: {},
      limits: [reason, "Aucun verdict de conformité n'a été établi.", ...LIMITES_METHODE_COUVERT],
    },
    disclaimer:
      "Analyse non disponible — aucun verdict de conformité n'a été établi. " +
      "Aucune conclusion ne doit en être tirée pour un dossier EUDR.",
    loss_area_ha: 0,
    tree_cover_2000_pct: null,
    details: `Analyse satellite impossible : ${reason}. Pays déduit des coordonnées : ${country.name} (${country.iso2}).`,
  };
}

// ---------------------------------------------------------------- Moteur live Global Forest Watch
interface GfwRow {
  umd_tree_cover_loss__year?: number | string | null;
  area__ha?: number | string | null;
}

const GFW_SQL =
  "SELECT umd_tree_cover_loss__year, SUM(area__ha) AS area__ha FROM results " +
  "WHERE umd_tree_cover_density_2000__threshold = 30 GROUP BY umd_tree_cover_loss__year ORDER BY umd_tree_cover_loss__year";

interface GfwQueryResult {
  rows: GfwRow[];
  evidence: AnalysisEvidence;
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
    const payload = (await res.json()) as { data?: GfwRow[] };
    // La version réellement servie est déduite de l'URL finale : elle est
    // consignée pour qu'un audit ancien reste reproductible.
    const servedVersion = /\/dataset\/[^/]+\/([^/]+)\//.exec(res.url)?.[1] ?? version;
    return {
      rows: payload.data ?? [],
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

async function liveCheck(geometry: SupportedGeometry): Promise<SatelliteCheckResult> {
  const { rows, evidence } = await gfwQuery(geometry);
  const [lon, lat] = centroidOf(geometry);
  const country = resolveCountry(lon, lat);
  const areaHa = geodesicAreaHa(geometry) || 1;
  const parsed = rows
    .map((r) => ({ year: Number(r.umd_tree_cover_loss__year ?? 0), area: Number(r.area__ha ?? 0) }))
    .filter((r) => r.year > 0);
  const post = parsed.filter((r) => r.year > EUDR_CUTOFF_YEAR);
  const lossArea = Number(post.reduce((acc, r) => acc + r.area, 0).toFixed(4));
  const significant = lossArea >= Math.max(0.01, areaHa * 0.005);

  if (significant) {
    const lossYear = Math.min(...post.map((r) => r.year));
    const fraction = Math.min(lossArea / areaHa, 1);
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
        params: {
          jeu_de_donnees: evidence.dataset_version,
          fournisseur: evidence.provider,
          seuil_significativite_ha: Number(Math.max(0.01, areaHa * 0.005).toFixed(4)),
          date_butoir: EUDR_CUTOFF_DATE,
        },
        limits: LIMITES_METHODE_COUVERT,
      },
      disclaimer: null,
      loss_area_ha: lossArea,
      tree_cover_2000_pct: null,
      details:
        `${evidence.provider.split(" (")[0]} ${evidence.dataset_version} : ${lossArea} ha de perte de couvert ` +
        `détectés à partir de ${lossYear} (post-2020) sur ${areaHa.toFixed(2)} ha. ` +
        `Données Hansen/UMD, seuil de densité 30 %.`,
    };
  }

  const historic = parsed.length ? Math.max(...parsed.map((r) => r.year)) : null;
  return {
    compliant: true,
    loss_year: historic,
    confidence_score: 0.95,
    risk_level: country.risk,
    country_code: country.iso2,
    country_name: country.name,
    country_risk: country.risk,
    source: "gfw-live",
    is_probative: true,
    evidence,
    provenance: {
      method: "gfw-live",
      version: evidence.dataset_version,
      params: {
        jeu_de_donnees: evidence.dataset_version,
        fournisseur: evidence.provider,
        seuil_significativite_ha: Number(Math.max(0.01, areaHa * 0.005).toFixed(4)),
        date_butoir: EUDR_CUTOFF_DATE,
      },
      limits: LIMITES_METHODE_COUVERT,
    },
    disclaimer: null,
    loss_area_ha: lossArea,
    tree_cover_2000_pct: null,
    details:
      `${evidence.provider.split(" (")[0]} ${evidence.dataset_version} : aucune perte significative ` +
      `post-2020 (${lossArea} ha). Pays : ${country.name}, benchmark UE : ${country.risk}.`,
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
      return await liveCheck(geometry);
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
