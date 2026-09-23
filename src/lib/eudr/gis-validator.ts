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

// ---------------------------------------------------------------- Extraction
function collectGeometries(input: GeoJsonInput): Record<string, unknown>[] {
  if (!input || typeof input !== "object" || typeof input.type !== "string") {
    throw new ExtractionError("INVALID_GEOJSON", "Objet GeoJSON invalide : champ 'type' manquant");
  }
  const type = input.type;
  if (type === "FeatureCollection") {
    const features = Array.isArray(input.features) ? (input.features as Record<string, unknown>[]) : [];
    const geoms = features
      .map((f) => (f && typeof f === "object" ? (f.geometry as Record<string, unknown> | null) : null))
      .filter((g): g is Record<string, unknown> => Boolean(g));
    if (geoms.length === 0) throw new ExtractionError("EMPTY_COLLECTION", "FeatureCollection vide");
    return geoms;
  }
  if (type === "Feature") {
    const geom = input.geometry as Record<string, unknown> | null | undefined;
    if (!geom) throw new ExtractionError("MISSING_GEOMETRY", "Feature sans géométrie");
    return [geom];
  }
  if (type === "GeometryCollection") {
    const geoms = Array.isArray(input.geometries) ? (input.geometries as Record<string, unknown>[]) : [];
    if (geoms.length === 0) throw new ExtractionError("EMPTY_COLLECTION", "GeometryCollection vide");
    return geoms;
  }
  return [input];
}

function mergeGeometries(geoms: Record<string, unknown>[]): Record<string, unknown> {
  if (geoms.length === 1) return geoms[0];
  const types = new Set(geoms.map((g) => g.type as string));
  const onlyPolys = [...types].every((t) => t === "Polygon" || t === "MultiPolygon");
  const onlyPoints = [...types].every((t) => t === "Point" || t === "MultiPoint");
  if (onlyPolys) {
    const polygons: unknown[] = [];
    for (const g of geoms) {
      if (g.type === "Polygon") polygons.push(g.coordinates);
      else polygons.push(...(g.coordinates as unknown[]));
    }
    return { type: "MultiPolygon", coordinates: polygons };
  }
  if (onlyPoints) {
    const points: unknown[] = [];
    for (const g of geoms) {
      if (g.type === "Point") points.push(g.coordinates);
      else points.push(...(g.coordinates as unknown[]));
    }
    return { type: "MultiPoint", coordinates: points };
  }
  throw new ExtractionError(
    "MIXED_GEOMETRY_TYPES",
    `Types de géométries hétérogènes non supportés dans un même dossier : ${[...types].sort().join(", ")}`,
  );
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

export function countDecimals(value: number): number {
  const text = String(value);
  if (/e/i.test(text)) {
    const [mantissa, exp] = text.toLowerCase().split("e");
    const frac = mantissa.includes(".") ? mantissa.split(".")[1] : "";
    return Math.max(0, frac.length - Number(exp));
  }
  if (!text.includes(".")) return 0;
  return text.split(".")[1].length;
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

/** Première excentricité au carré de l'ellipsoïde WGS84. */
const WGS84_E2 = 0.00669437999014;

/**
 * Facteur de correction sphère -> ellipsoïde WGS84 à la latitude φ :
 * (M·N·cosφ) / (a²·cosφ) = (1 - e²) / (1 - e²·sin²φ)²
 * (M = rayon de courbure méridien, N = grande normale).
 */
function ellipsoidCorrection(latDeg: number): number {
  const s2 = Math.sin(toRad(latDeg)) ** 2;
  return (1 - WGS84_E2) / (1 - WGS84_E2 * s2) ** 2;
}

function meanLatitude(ring: Position[]): number {
  return ring.reduce((acc, p) => acc + p[1], 0) / ring.length;
}

function polygonAreaM2(rings: Position[][]): number {
  if (rings.length === 0) return 0;
  let area = Math.abs(ringArea(rings[0])) * ellipsoidCorrection(meanLatitude(rings[0]));
  for (let i = 1; i < rings.length; i++) area -= Math.abs(ringArea(rings[i])) * ellipsoidCorrection(meanLatitude(rings[i]));
  return Math.max(area, 0);
}

export function geodesicAreaHa(geometry: SupportedGeometry): number {
  if (geometry.type === "Polygon") return polygonAreaM2(geometry.coordinates) / 10_000;
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.reduce((acc, poly) => acc + polygonAreaM2(poly), 0) / 10_000;
  }
  return 0;
}

// ---------------------------------------------------------------- Topologie
function orientation(p: Position, q: Position, r: Position): number {
  const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (Math.abs(val) < 1e-18) return 0;
  return val > 0 ? 1 : 2;
}

function onSegment(p: Position, q: Position, r: Position): boolean {
  return (
    q[0] <= Math.max(p[0], r[0]) && q[0] >= Math.min(p[0], r[0]) && q[1] <= Math.max(p[1], r[1]) && q[1] >= Math.min(p[1], r[1])
  );
}

function segmentsIntersect(p1: Position, p2: Position, p3: Position, p4: Position): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p3, p2)) return true;
  if (o2 === 0 && onSegment(p1, p4, p2)) return true;
  if (o3 === 0 && onSegment(p3, p1, p4)) return true;
  if (o4 === 0 && onSegment(p3, p2, p4)) return true;
  return false;
}

/** Détecte une auto-intersection dans un anneau fermé (segments non adjacents). */
function ringSelfIntersects(ring: Position[]): Position | null {
  const n = ring.length - 1; // dernier == premier
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return ring[j];
    }
  }
  return null;
}

function checkRingsClosed(geom: Record<string, unknown>): string[] {
  const problems: string[] = [];
  let rings: unknown[] = [];
  if (geom.type === "Polygon") rings = (geom.coordinates as unknown[]) ?? [];
  else if (geom.type === "MultiPolygon") {
    for (const poly of (geom.coordinates as unknown[][]) ?? []) rings.push(...poly);
  }
  rings.forEach((ring, idx) => {
    if (!Array.isArray(ring) || ring.length < 4) {
      problems.push(`anneau #${idx + 1} : un polygone fermé requiert au moins 4 positions`);
      return;
    }
    const first = ring[0] as Position;
    const last = ring[ring.length - 1] as Position;
    if (first[0] !== last[0] || first[1] !== last[1]) {
      problems.push(`anneau #${idx + 1} : première et dernière position différentes (anneau non fermé)`);
    }
  });
  return problems;
}

function centroidOf(geometry: SupportedGeometry): [number, number] {
  const pts = [...iterPositions(geometry.coordinates)];
  if (geometry.type === "Point" || geometry.type === "MultiPoint") {
    const sum = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [sum[0] / pts.length, sum[1] / pts.length];
  }
  // Centroïde pondéré par la surface (formule du lacet sur l'anneau extérieur de chaque polygone)
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let cx = 0;
  let cy = 0;
  let totalArea = 0;
  for (const poly of polys) {
    const ring = poly[0];
    let a = 0;
    let px = 0;
    let py = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      a += cross;
      px += (ring[i][0] + ring[i + 1][0]) * cross;
      py += (ring[i][1] + ring[i + 1][1]) * cross;
    }
    a /= 2;
    if (Math.abs(a) < 1e-15) continue;
    cx += (px / (6 * a)) * Math.abs(a);
    cy += (py / (6 * a)) * Math.abs(a);
    totalArea += Math.abs(a);
  }
  if (totalArea === 0) {
    const sum = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [sum[0] / pts.length, sum[1] / pts.length];
  }
  return [cx / totalArea, cy / totalArea];
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

  let raw: Record<string, unknown>;
  try {
    const geoms = collectGeometries(geojson);
    if (geoms.length > 1) {
      warnings.push({
        code: "MULTIPLE_FEATURES_MERGED",
        message: `${geoms.length} géométries fusionnées en une seule parcelle multi-partie`,
      });
    }
    raw = mergeGeometries(geoms);
  } catch (err) {
    const e = err as ExtractionError;
    errors.push({ code: e.code ?? "INVALID_GEOJSON", message: e.message });
    return result;
  }

  const type = raw.type as string;
  result.geometry_type = type;
  if (!SUPPORTED.has(type)) {
    errors.push({
      code: "UNSUPPORTED_GEOMETRY_TYPE",
      message: `Type '${type}' non supporté. EUDR : Point, MultiPoint, Polygon ou MultiPolygon`,
    });
    return result;
  }

  const positions = [...iterPositions(raw.coordinates)];
  if (positions.length === 0) {
    errors.push({ code: "EMPTY_COORDINATES", message: "Aucune coordonnée trouvée" });
    return result;
  }
  result.vertex_count = positions.length;

  const bad = positions.find(
    ([lon, lat]) => !Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90,
  );
  if (bad) {
    errors.push({
      code: "COORDINATES_OUT_OF_RANGE",
      message: `Coordonnée hors WGS84 : [${bad[0]}, ${bad[1]}] (attendu lon ∈ [-180,180], lat ∈ [-90,90], ordre [lon, lat])`,
    });
    return result;
  }

  const minDecimals = Math.min(...positions.map(([lon, lat]) => Math.min(countDecimals(lon), countDecimals(lat))));
  result.min_decimals_found = minDecimals;
  if (minDecimals < EUDR_MIN_COORD_DECIMALS) {
    result.precision_ok = false;
    errors.push({
      code: "INSUFFICIENT_PRECISION",
      message: `Précision insuffisante : ${minDecimals} décimale(s) détectée(s), EUDR exige au moins ${EUDR_MIN_COORD_DECIMALS} décimales (~11 cm)`,
    });
  }

  const ringProblems = checkRingsClosed(raw);
  if (ringProblems.length > 0) {
    ringProblems.forEach((p) => errors.push({ code: "RING_NOT_CLOSED", message: `Polygone non fermé — ${p}` }));
    return result;
  }

  const geometry = raw as unknown as SupportedGeometry;
  const isPoint = geometry.type === "Point" || geometry.type === "MultiPoint";

  if (!isPoint) {
    const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        const hit = ringSelfIntersects(ring);
        if (hit) {
          errors.push({
            code: "SELF_INTERSECTION",
            message: `Topologie invalide : Self-intersection au voisinage de [${hit[0]}, ${hit[1]}]`,
          });
          return result;
        }
      }
    }
  }

  const areaHa = geodesicAreaHa(geometry);
  if (!isPoint && areaHa <= 0) {
    errors.push({ code: "DEGENERATE_POLYGON", message: "Polygone dégénéré (surface nulle)" });
    return result;
  }

  const effectiveArea = isPoint ? Number(declaredAreaHa ?? 0) : areaHa;
  result.area_ha = Number(areaHa.toFixed(4));
  const [cx, cy] = centroidOf(geometry);
  result.centroid = [Number(cx.toFixed(6)), Number(cy.toFixed(6))];
  const lons = positions.map((p) => p[0]);
  const lats = positions.map((p) => p[1]);
  result.bbox = [
    Number(Math.min(...lons).toFixed(6)),
    Number(Math.min(...lats).toFixed(6)),
    Number(Math.max(...lons).toFixed(6)),
    Number(Math.max(...lats).toFixed(6)),
  ];

  if (effectiveArea >= EUDR_POLYGON_THRESHOLD_HA) {
    result.eudr_geometry_rule = "POLYGON_REQUIRED";
    if (isPoint) {
      errors.push({
        code: "POLYGON_REQUIRED",
        message: `Surface déclarée ${effectiveArea.toFixed(2)} ha ≥ ${EUDR_POLYGON_THRESHOLD_HA} ha : l'EUDR exige un polygone (art. 9(1)(d)), un point n'est pas suffisant`,
      });
    }
  } else {
    result.eudr_geometry_rule = "POINT_ALLOWED";
    if (isPoint && (declaredAreaHa === null || declaredAreaHa === undefined)) {
      warnings.push({
        code: "POINT_WITHOUT_DECLARED_AREA",
        message: "Parcelle géolocalisée par point sans surface déclarée : supposée < 4 ha",
      });
    }
  }

  if (!isPoint && areaHa > 100_000) {
    warnings.push({
      code: "SUSPICIOUS_AREA",
      message: `Surface anormalement grande (${Math.round(areaHa).toLocaleString("fr-FR")} ha) : vérifiez l'ordre [lon, lat]`,
    });
  }

  result.normalized_geometry = { type: geometry.type, coordinates: roundCoords(geometry.coordinates) } as SupportedGeometry;
  result.valid = errors.length === 0;
  return result;
}
