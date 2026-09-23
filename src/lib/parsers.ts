import type { GeoJsonInput } from "@/lib/eudr/types";

/**
 * Conversion des fichiers déposés (GeoJSON / KML / CSV) vers un objet GeoJSON.
 * Exécuté côté navigateur.
 */

export type SupportedExtension = "geojson" | "json" | "kml" | "csv" | "txt";

export interface ParsedUpload {
  geojson: GeoJsonInput;
  format: "GeoJSON" | "KML" | "CSV";
  featureCount: number;
}

export class ParseError extends Error {}

function extensionOf(name: string): SupportedExtension | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (["geojson", "json", "kml", "csv", "txt"] as const).includes(ext as SupportedExtension) ? (ext as SupportedExtension) : null;
}

function countFeatures(geojson: GeoJsonInput): number {
  if (geojson.type === "FeatureCollection" && Array.isArray(geojson.features)) return geojson.features.length;
  return 1;
}

// ---------------------------------------------------------------- GeoJSON
function parseGeoJson(text: string): ParsedUpload {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ParseError("Fichier JSON illisible (syntaxe invalide)");
  }
  if (!data || typeof data !== "object" || typeof (data as { type?: unknown }).type !== "string") {
    throw new ParseError("Le fichier ne contient pas d'objet GeoJSON (champ 'type' manquant)");
  }
  const geojson = data as GeoJsonInput;
  return { geojson, format: "GeoJSON", featureCount: countFeatures(geojson) };
}

// ---------------------------------------------------------------- KML
function parseKmlCoordinates(text: string): number[][] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tuple) => {
      const parts = tuple.split(",").map(Number);
      if (parts.length < 2 || parts.some((n, i) => i < 2 && !Number.isFinite(n))) {
        throw new ParseError(`Coordonnée KML invalide : "${tuple}"`);
      }
      return [parts[0], parts[1]];
    });
}

function parseKml(text: string): ParsedUpload {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new ParseError("KML illisible (XML invalide)");

  const features: Array<Record<string, unknown>> = [];
  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));
  const containers = placemarks.length > 0 ? placemarks : [doc.documentElement];

  for (const pm of containers) {
    const name = pm.getElementsByTagName("name")[0]?.textContent?.trim() ?? null;
    const polygons = Array.from(pm.getElementsByTagName("Polygon"));
    for (const poly of polygons) {
      const outer = poly.getElementsByTagName("outerBoundaryIs")[0]?.getElementsByTagName("coordinates")[0];
      if (!outer?.textContent) continue;
      const rings: number[][][] = [parseKmlCoordinates(outer.textContent)];
      for (const inner of Array.from(poly.getElementsByTagName("innerBoundaryIs"))) {
        const c = inner.getElementsByTagName("coordinates")[0]?.textContent;
        if (c) rings.push(parseKmlCoordinates(c));
      }
      features.push({ type: "Feature", properties: { name }, geometry: { type: "Polygon", coordinates: rings } });
    }
    if (polygons.length === 0) {
      for (const point of Array.from(pm.getElementsByTagName("Point"))) {
        const c = point.getElementsByTagName("coordinates")[0]?.textContent;
        if (!c) continue;
        features.push({ type: "Feature", properties: { name }, geometry: { type: "Point", coordinates: parseKmlCoordinates(c)[0] } });
      }
    }
  }
  if (features.length === 0) throw new ParseError("Aucun Polygon ni Point trouvé dans le KML");
  return { geojson: { type: "FeatureCollection", features }, format: "KML", featureCount: features.length };
}

// ---------------------------------------------------------------- CSV
/**
 * CSV accepté :
 *   - en-tête optionnelle contenant `lat`/`latitude` et `lon`/`lng`/`longitude` (ordre libre) ;
 *   - sans en-tête : colonnes `lat,lon` par défaut ;
 *   - une colonne optionnelle `parcel`/`id` pour regrouper plusieurs parcelles ;
 *   - 1 ligne => Point ; ≥ 3 lignes => Polygon (fermé automatiquement si nécessaire).
 */
function parseCsv(text: string): ParsedUpload {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) throw new ParseError("CSV vide");

  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const split = (l: string): string[] => l.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));

  const header = split(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = header.some((h) => /^(lat|latitude|y)$/.test(h)) && header.some((h) => /^(lon|lng|long|longitude|x)$/.test(h));
  let latIdx = 0;
  let lonIdx = 1;
  let idIdx = -1;
  if (hasHeader) {
    latIdx = header.findIndex((h) => /^(lat|latitude|y)$/.test(h));
    lonIdx = header.findIndex((h) => /^(lon|lng|long|longitude|x)$/.test(h));
    idIdx = header.findIndex((h) => /^(parcel|parcel_id|plot|id|name)$/.test(h));
  } else if (!/^-?\d/.test(lines[0])) {
    throw new ParseError("En-tête CSV non reconnue : colonnes attendues lat/latitude et lon/longitude");
  }

  const groups = new Map<string, number[][]>();
  const rows = hasHeader ? lines.slice(1) : lines;
  rows.forEach((line, i) => {
    const cells = split(line);
    const lat = Number(cells[latIdx]);
    const lon = Number(cells[lonIdx]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new ParseError(`Ligne ${i + (hasHeader ? 2 : 1)} : coordonnées non numériques`);
    const key = idIdx >= 0 ? (cells[idIdx] ?? "parcel") : "parcel";
    const list = groups.get(key) ?? [];
    list.push([lon, lat]);
    groups.set(key, list);
  });

  const features: Array<Record<string, unknown>> = [];
  for (const [key, coords] of groups) {
    if (coords.length === 1) {
      features.push({ type: "Feature", properties: { name: key }, geometry: { type: "Point", coordinates: coords[0] } });
    } else if (coords.length >= 3) {
      const ring = [...coords];
      const [f, l] = [ring[0], ring[ring.length - 1]];
      if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
      features.push({ type: "Feature", properties: { name: key }, geometry: { type: "Polygon", coordinates: [ring] } });
    } else {
      throw new ParseError(`Parcelle "${key}" : 2 points ne forment ni un point ni un polygone`);
    }
  }
  return { geojson: { type: "FeatureCollection", features }, format: "CSV", featureCount: features.length };
}

// ---------------------------------------------------------------- API
export async function parseUploadedFile(file: File): Promise<ParsedUpload> {
  const ext = extensionOf(file.name);
  if (!ext) throw new ParseError("Format non supporté : utilisez .geojson, .json, .kml ou .csv");
  if (file.size > 10 * 1024 * 1024) throw new ParseError("Fichier trop volumineux (max 10 Mo)");
  const text = await file.text();
  if (ext === "kml") return parseKml(text);
  if (ext === "csv" || ext === "txt") return parseCsv(text);
  return parseGeoJson(text);
}

export function parsePastedText(text: string): ParsedUpload {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return parseGeoJson(trimmed);
  if (trimmed.startsWith("<")) return parseKml(trimmed);
  return parseCsv(trimmed);
}
