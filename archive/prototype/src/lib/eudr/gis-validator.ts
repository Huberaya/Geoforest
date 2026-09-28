import {
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

function extractPropMinDecimals(obj: unknown): number | null {
  if (obj && typeof obj === "object") {
    const props = (obj as { properties?: Record<string, unknown> }).properties ?? (obj as Record<string, unknown>);
    if (props && typeof props === "object") {
      for (const k of ["min_decimals", "raw_min_decimals", "precision_decimals"]) {
        const val = props[k];
        if (typeof val === "number" && Number.isFinite(val)) return Math.floor(val);
      }
    }
  }
  return null;
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

function ringSelfIntersects(ring: Position[]): Position | null {
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === n - 1) continue;
      const c = ring[j];
      const d = ring[j + 1];
      if (segmentsIntersect(a, b, c, d)) return a;
    }
  }
  return null;
}

function roundCoords<T>(coords: T, decimals = 8): T {
  if (Array.isArray(coords)) {
    if (isPosition(coords)) return coords.map((c) => Number(Number(c).toFixed(decimals))) as unknown as T;
    return coords.map((c) => roundCoords(c, decimals)) as unknown as T;
  }
  return coords;
}

// ---------------------------------------------------------------- API
export function validateGeometry(geojson: GeoJsonInput, declaredAreaHa?: number | null): GeometryValidationResult {
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

  // Coordonnées & Précision
  const allPositions: Position[] = [];
  const overallPropDecimals = extractPropMinDecimals(geojson);

  for (const item of plotItems) {
    const pos = [...iterPositions(item.geometry.coordinates)];
    if (pos.length === 0) {
      errors.push({
        code: "EMPTY_COORDINATES",
        message: `Parcelle #${item.featureIndex + 1} : aucune coordonnée trouvée`,
      });
      return result;
    }
    allPositions.push(...pos);
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

  let minDecimals = Math.min(...allPositions.map(([lon, lat]) => Math.min(countDecimals(lon), countDecimals(lat))));
  if (overallPropDecimals !== null) {
    minDecimals = Math.max(minDecimals, overallPropDecimals);
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
      let plotDecArea: number | null = null;
      for (const k of ["area_ha", "declared_area_ha", "area"]) {
        const v = item.properties[k];
        if (typeof v === "number" && v > 0) {
          plotDecArea = v;
          break;
        }
      }
      if (plotDecArea === null) plotDecArea = perPointDeclared;
      effectivePlotArea = plotDecArea ?? 0;

      if (effectivePlotArea >= EUDR_POLYGON_THRESHOLD_HA) {
        hasPolygonRequired = true;
        const nameStr = (item.properties.name as string) ?? `Parcelle #${item.featureIndex + 1}`;
        errors.push({
          code: "POLYGON_REQUIRED",
          message: `${nameStr} : surface ${effectivePlotArea.toFixed(2)} ha ≥ ${EUDR_POLYGON_THRESHOLD_HA} ha. L'EUDR exige un polygone (art. 9(1)(d)), un point n'est pas suffisant.`,
        });
      } else if (plotDecArea === null && (declaredAreaHa === null || declaredAreaHa === undefined)) {
        warnings.push({
          code: "POINT_WITHOUT_DECLARED_AREA",
          message: `Parcelle #${item.featureIndex + 1} par point sans surface déclarée : supposée < 4 ha`,
        });
      }
    } else if (plotArea >= EUDR_POLYGON_THRESHOLD_HA) {
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
  result.bbox = [
    Number(Math.min(...lons).toFixed(6)),
    Number(Math.min(...lats).toFixed(6)),
    Number(Math.max(...lons).toFixed(6)),
    Number(Math.max(...lats).toFixed(6)),
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
