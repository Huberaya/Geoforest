import { createHash } from "node:crypto";
import { geodesicAreaHa } from "./gis-validator";
import { EUDR_CUTOFF_DATE, EUDR_CUTOFF_YEAR, type AnalysisEvidence, type Position, type RiskLevel, type SatelliteCheckResult, type SupportedGeometry } from "./types";
import { incrementer, noterJauges } from "@/lib/observability/metriques";
import { journal } from "@/lib/observability/journal";

// ---------------------------------------------------------------- Risque pays
/**
 * La géométrie seule ne permet pas d'assigner un pays ni un benchmark EUDR.
 * Les anciennes boîtes englobantes chevauchaient des frontières et des pays
 * voisins ; aucune classification administrative officielle n'est intégrée.
 * Le moteur échoue donc explicitement en « inconnu » au lieu d'inventer un
 * niveau de risque. À remplacer uniquement par une source administrative et
 * un benchmark officiel versionné, avec provenance.
 */
export function resolveCountry(_lon: number, _lat: number): { iso2: string; name: string; risk: RiskLevel } {
  return { iso2: "XX", name: "Non déterminé", risk: "UNKNOWN" as RiskLevel };
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
      // Un Polygon est une surface : le premier anneau est son contour et les suivants
      // sont des trous. Les séparer en polygones positifs inverserait la sémantique.
      polygones.push(g.coordinates as Position[][]);
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
      `Pays et benchmark officiel non déterminés.`;
  }
  if (harvestDate <= EUDR_CUTOFF_DATE) details += " Récolte antérieure à la date butoir : hors champ temporel EUDR.";

  return {
    // P0-04 : un moteur de démonstration ne rend PAS de verdict. Les valeurs
    // affichées sont présentées pour ce qu'elles sont : un jeu d'essai.
    compliant: null,
    loss_year: lossYear,
    confidence_score: null,
    risk_level: "UNKNOWN" as RiskLevel,
    country_code: country.iso2,
    country_name: country.name,
    country_risk: "UNKNOWN" as RiskLevel,
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
        resolution_pays: "non évaluée : aucune source administrative officielle intégrée",
      },
      limits: [
        "Aucune donnée satellite n'a été consultée : les chiffres sont inventés pour la démonstration.",
        "Aucune classification de pays ou de benchmark EUDR n’est calculée : une source administrative officielle versionnée est requise.",
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
    details: `Analyse satellite impossible : ${reason}. Classification du pays et benchmark officiel indisponibles.`,
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

/**
 * Valide strictement le contrat des lignes GFW avant toute décision.
 * Une réponse non vide mais mal formée ne doit jamais devenir « conforme ».
 */
export function normaliserLignesGfw(data: unknown): GfwRow[] {
  if (!Array.isArray(data)) {
    throw new Error("Réponse GFW invalide : le champ data doit être un tableau");
  }
  const anneeCourante = new Date().getUTCFullYear();
  return data.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Réponse GFW invalide : ligne ${index + 1} non objet`);
    }
    const row = raw as Record<string, unknown>;
    const anneeBrute = row.umd_tree_cover_loss__year;
    const surfaceBrute = row.area__ha;
    const annee = typeof anneeBrute === "string" && anneeBrute.trim() !== ""
      ? Number(anneeBrute)
      : anneeBrute;
    const surface = typeof surfaceBrute === "string" && surfaceBrute.trim() !== ""
      ? Number(surfaceBrute)
      : surfaceBrute;
    if (typeof annee !== "number" || !Number.isInteger(annee) || annee < 2001 || annee > anneeCourante) {
      throw new Error(`Réponse GFW invalide : année de perte absente ou hors plage à la ligne ${index + 1}`);
    }
    if (typeof surface !== "number" || !Number.isFinite(surface) || surface < 0) {
      throw new Error(`Réponse GFW invalide : surface absente, non finie ou négative à la ligne ${index + 1}`);
    }
    return {
      umd_tree_cover_loss__year: annee,
      area__ha: surface,
    };
  });
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
export function nommerFournisseur(baseUrl: string): { provider: string; officiel: boolean } {
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
    // fetch suit les redirections : vérifier l'hôte final réellement servi,
    // pas seulement l'URL configurée, avant de lui attribuer une preuve officielle.
    const fournisseurFinal = nommerFournisseur(res.url);
    if (!fournisseurFinal.officiel) {
      throw new Error(`Destination finale non officielle après redirection (${res.url})`);
    }
    noterJauges("gfw_disponible", 1);
    noterJauges("gfw_latence_ms", Date.now() - debutAppel);
    const payload = (await res.json()) as { data?: unknown };
    const rows = normaliserLignesGfw(payload?.data);
    // La version réellement servie est déduite de l'URL finale : elle est
    // consignée pour qu'un audit ancien reste reproductible.
    const servedVersion = /\/dataset\/[^/]+\/([^/]+)\//.exec(res.url)?.[1] ?? version;
    return {
      rows,
      evidence: {
        provider: fournisseurFinal.provider,
        is_official_source: fournisseurFinal.officiel,
        dataset,
        dataset_version: servedVersion,
        endpoint,
        sql: GFW_SQL,
        geometry_type: sentGeometry.type,
        retrieved_at: new Date().toISOString(),
        rows_sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
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
  // Réponse vide : « aucune perte » et « aucune donnée » ne sont pas distinguables
  // dans cette réponse. Aucun verdict de conformité n'est donc émis (cf. EUDR_WORKFLOW_VALIDATION).
  if (rows.length === 0) {
    return unavailableResult(
      geometry,
      "réponse GFW vide : absence de perte et absence de donnée ne sont pas distinguables ; aucun verdict de conformité",
    );
  }
  const currentYear = new Date().getUTCFullYear();
  const parsed = rows.map((r) => {
    const year = Number(r.umd_tree_cover_loss__year);
    const area = Number(r.area__ha);
    const missingYear = r.umd_tree_cover_loss__year == null ||
      (typeof r.umd_tree_cover_loss__year === "string" && r.umd_tree_cover_loss__year.trim() === "");
    const missingArea = r.area__ha == null ||
      (typeof r.area__ha === "string" && r.area__ha.trim() === "");
    return { year, area, missingYear, missingArea };
  });
  const malformed = parsed.some(({ year, area, missingYear, missingArea }) =>
    missingYear ||
    missingArea ||
    !Number.isInteger(year) ||
    year < 2001 ||
    year > currentYear ||
    !Number.isFinite(area) ||
    area < 0
  );
  if (malformed || parsed.length === 0) {
    return unavailableResult(
      geometry,
      "réponse GFW malformée : année ou surface absente, invalide ou hors plage ; aucun verdict de conformité",
    );
  }
  const [lon, lat] = centroidOf(geometry);
  const country = resolveCountry(lon, lat);
  const areaHa = geodesicAreaHa(geometry) || 1;
  const post = parsed.filter((r) => r.year > EUDR_CUTOFF_YEAR);
  const lossArea = Number(post.reduce((acc, r) => acc + r.area, 0).toFixed(4));
  // ------------------------------------------------------------ P0 (recette 2026-10-08)
  // Aucune tolérance. L'ancien seuil (0,5 % de la parcelle, au moins 0,01 ha)
  // transformait une perte réelle mais faible en « CONFORME » : 0,4 ha de
  // déforestation post-2020 sur 100 ha passaient pour conformes. Toute surface
  // de perte post-2020 détectée est donc non conforme ; l'éventuelle erreur
  // de détection se corrige par revue humaine, pas par un seuil silencieux.
  const significant = lossArea > 0;

  if (significant) {
    const lossYear = Math.min(...post.map((r) => r.year));
    return {
      compliant: false,
      loss_year: lossYear,
      confidence_score: null,
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
          seuil_significativite_ha: 0,
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
    confidence_score: null,
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
        seuil_significativite_ha: 0,
        date_butoir: EUDR_CUTOFF_DATE,
      },
      limits: LIMITES_METHODE_COUVERT,
    },
    disclaimer: null,
    loss_area_ha: lossArea,
    tree_cover_2000_pct: null,
    details:
      `${evidence.provider.split(" (")[0]} ${evidence.dataset_version} : aucune perte significative ` +
      `post-2020 (${lossArea} ha). Ce signal ne constitue pas une classification de risque pays.`,
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
    // ------------------------------------------------------------ P0 (recette 2026-10-08)
    // Un verdict « probant » ne peut venir que du service officiel. Un point
    // d'accès configuré ailleurs (cache, miroir, banc d'essai) n'a pas de
    // valeur de preuve : il ne produit donc AUCUN verdict, plutôt qu'un
    // « conforme » qui aurait l'apparence d'une donnée GFW.
    const base = (process.env.GFW_API_URL ?? "https://data-api.globalforestwatch.org").replace(/\/$/, "");
    if (!nommerFournisseur(base).officiel) {
      return unavailableResult(
        geometry,
        `source satellite non officielle (${new URL(base).host}) : aucune preuve ne peut en être tirée`,
      );
    }
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
