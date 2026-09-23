import { createHash } from "node:crypto";
import { geodesicAreaHa } from "./gis-validator";
import { EUDR_CUTOFF_DATE, EUDR_CUTOFF_YEAR, type GeoJsonInput, type RiskLevel, type SatelliteCheckResult, type SupportedGeometry } from "./types";

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

function stableFraction(seed: string): number {
  const digest = createHash("sha256").update(seed).digest("hex");
  return parseInt(digest.slice(0, 8), 16) / 0xffffffff;
}

function extractSimulatedLossYear(input: GeoJsonInput): number | null {
  const props = input.properties as Record<string, unknown> | undefined;
  if (props && props.simulated_loss_year !== undefined && props.simulated_loss_year !== null) {
    const y = Number(props.simulated_loss_year);
    return Number.isFinite(y) ? Math.trunc(y) : null;
  }
  if (input.type === "FeatureCollection" && Array.isArray(input.features)) {
    for (const f of input.features as GeoJsonInput[]) {
      const y = extractSimulatedLossYear(f);
      if (y !== null) return y;
    }
  }
  return null;
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
  walk(geometry.coordinates);
  const sum = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
  return [sum[0] / pts.length, sum[1] / pts.length];
}

function bufferPoint(geometry: SupportedGeometry): SupportedGeometry {
  if (geometry.type !== "Point" && geometry.type !== "MultiPoint") return geometry;
  const [lon, lat] = centroidOf(geometry);
  const r = 0.0005; // ≈ 55 m
  const ring: number[][] = [];
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    ring.push([lon + r * Math.cos(a), lat + r * Math.sin(a)]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

// ---------------------------------------------------------------- Moteur déterministe
export function deterministicCheck(geometry: SupportedGeometry, harvestDate: string, forcedLossYear: number | null): SatelliteCheckResult {
  const [lon, lat] = centroidOf(geometry);
  const country = resolveCountry(lon, lat);
  const jitter = stableFraction(`${lon.toFixed(4)}:${lat.toFixed(4)}`);

  let lossYear: number | null = forcedLossYear;
  let lossFraction = 0;
  let treeCover = Number((35 + jitter * 40).toFixed(1));
  let hotspotLabel: string | null = null;

  if (lossYear === null) {
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
  } else {
    lossFraction = 0.25;
    hotspotLabel = "Année de perte simulée (mode démonstration)";
  }

  const areaHa = geodesicAreaHa(geometry);
  const lossArea = areaHa > 0 ? Number((areaHa * lossFraction).toFixed(4)) : lossYear ? 0.05 : 0;
  const postCutoff = lossYear !== null && lossYear > EUDR_CUTOFF_YEAR;

  let confidence: number;
  let riskLevel: RiskLevel;
  let details: string;

  if (postCutoff) {
    confidence = Number((0.86 + jitter * 0.12).toFixed(3));
    riskLevel = "HIGH";
    details = `Perte de couvert forestier détectée en ${lossYear} (${lossArea} ha, ${Math.round(lossFraction * 100)} % de la parcelle) — postérieure au 31/12/2020. Zone : ${hotspotLabel}.`;
  } else if (lossYear !== null) {
    confidence = Number((0.88 + jitter * 0.1).toFixed(3));
    riskLevel = country.risk === "LOW" ? "STANDARD" : country.risk;
    details = `Perte historique en ${lossYear} (antérieure à la date butoir) : conforme, mais vigilance renforcée. Zone : ${hotspotLabel}.`;
  } else {
    confidence = Number((0.9 + jitter * 0.09).toFixed(3));
    riskLevel = country.risk;
    details = `Aucune alerte Hansen Tree Cover Loss post-2020 sur l'emprise. Pays : ${country.name} (${country.iso2}), benchmark UE : ${country.risk}.`;
  }

  if (harvestDate <= EUDR_CUTOFF_DATE) details += " Récolte antérieure à la date butoir : hors champ temporel EUDR.";

  return {
    compliant: !postCutoff,
    loss_year: lossYear,
    confidence_score: Math.min(confidence, 1),
    risk_level: riskLevel,
    country_code: country.iso2,
    country_name: country.name,
    country_risk: country.risk,
    source: "deterministic-mock (Hansen/GFW rules engine)",
    loss_area_ha: lossArea,
    tree_cover_2000_pct: treeCover,
    details,
  };
}

// ---------------------------------------------------------------- Moteur live Global Forest Watch
interface GfwRow {
  umd_tree_cover_loss__year?: number | string | null;
  area__ha?: number | string | null;
}

async function gfwQuery(geometry: SupportedGeometry): Promise<GfwRow[]> {
  const base = (process.env.GFW_API_URL ?? "https://data-api.globalforestwatch.org").replace(/\/$/, "");
  const dataset = process.env.GFW_DATASET ?? "umd_tree_cover_loss";
  const sql =
    "SELECT umd_tree_cover_loss__year, SUM(area__ha) AS area__ha FROM results " +
    "WHERE umd_tree_cover_density_2000__threshold = 30 GROUP BY umd_tree_cover_loss__year ORDER BY umd_tree_cover_loss__year";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GFW_TIMEOUT_SECONDS ?? "15") * 1000);
  try {
    const res = await fetch(`${base}/dataset/${dataset}/latest/query`, {
      method: "POST",
      headers: { "x-api-key": process.env.GFW_API_KEY ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ sql, geometry: bufferPoint(geometry) }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`GFW HTTP ${res.status}`);
    const payload = (await res.json()) as { data?: GfwRow[] };
    return payload.data ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

async function liveCheck(geometry: SupportedGeometry): Promise<SatelliteCheckResult> {
  const rows = await gfwQuery(geometry);
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
      source: "gfw-live (umd_tree_cover_loss)",
      loss_area_ha: lossArea,
      tree_cover_2000_pct: null,
      details: `GFW : ${lossArea} ha de perte détectés à partir de ${lossYear} (post-2020) sur ${areaHa.toFixed(2)} ha.`,
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
    source: "gfw-live (umd_tree_cover_loss)",
    loss_area_ha: lossArea,
    tree_cover_2000_pct: null,
    details: `GFW : aucune perte significative post-2020 (${lossArea} ha). Pays : ${country.name}, benchmark UE : ${country.risk}.`,
  };
}

export function gfwLiveAvailable(): boolean {
  const enabled = (process.env.GFW_LIVE_ENABLED ?? "true").toLowerCase() !== "false";
  return enabled && Boolean(process.env.GFW_API_KEY);
}

/**
 * Évalue le risque de déforestation post-2020 sur une géométrie normalisée.
 * @param originalInput GeoJSON d'origine (pour lire d'éventuelles propriétés de démonstration).
 */
export async function checkDeforestationRisk(
  geometry: SupportedGeometry,
  harvestDate: string,
  originalInput: GeoJsonInput,
): Promise<SatelliteCheckResult> {
  const forced = extractSimulatedLossYear(originalInput);
  if (gfwLiveAvailable() && forced === null) {
    try {
      return await liveCheck(geometry);
    } catch (err) {
      console.warn("[GFW] live indisponible — repli déterministe :", (err as Error).message);
    }
  }
  return deterministicCheck(geometry, harvestDate, forced);
}
