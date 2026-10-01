import type { GeoJsonInput } from "@/lib/eudr/types";

/**
 * Conversion des fichiers déposés (GeoJSON / KML / CSV) vers un objet GeoJSON.
 * Exécuté côté navigateur.
 */

export type SupportedExtension = "geojson" | "json" | "kml" | "csv" | "txt";

export interface ParsedUpload {
  geojson: GeoJsonInput;
  /**
   * Le même GeoJSON, mais sérialisé en préservant la précision des
   * coordonnées **telle qu'écrite dans le fichier d'origine**.
   *
   * P1-16 — pourquoi ce champ existe, et pourquoi il n'est pas optionnel.
   *
   * `JSON.stringify` supprime les zéros terminaux : `5.300000` devient `5.3`.
   * Or le serveur mesure la précision sur les littéraux qu'il reçoit — à
   * dessein, depuis P0-05, pour qu'un fichier ne puisse pas *déclarer* sa
   * précision dans une propriété. Conséquence : un fichier parfaitement
   * géolocalisé à 6 décimales était refusé avec `INSUFFICIENT_PRECISION` dès
   * lors qu'il passait par le dépôt du navigateur, alors que le même texte
   * envoyé tel quel était accepté.
   *
   * La précision et la géométrie voyagent donc dans le **même** artefact :
   * elles ne peuvent pas diverger, ce qui serait arrivé si l'on avait transmis
   * la précision à part.
   */
  geojsonText: string;
  format: "GeoJSON" | "KML" | "CSV";
  featureCount: number;
}

/** Coordonnée accompagnée du nombre de décimales lu dans le fichier. */
interface CoordPrecise {
  lon: number;
  lat: number;
  lonDec: number;
  latDec: number;
}

function nombreTexte(valeur: number, decimales: number): string {
  // `toFixed` est borné à 100 décimales ; une valeur plus grande trahirait un
  // fichier hostile plutôt qu'une vraie mesure.
  return valeur.toFixed(Math.max(0, Math.min(12, decimales)));
}

function coordTexte(c: CoordPrecise): string {
  return `[${nombreTexte(c.lon, c.lonDec)},${nombreTexte(c.lat, c.latDec)}]`;
}

/**
 * Émet un GeoJSON texte où chaque coordonnée garde sa précision d'origine.
 * Le sommet de fermeture répète le premier point : il hérite donc de sa
 * précision, pas d'une précision arbitraire.
 */
function geometrieTexte(coords: CoordPrecise[]): { texte: string; type: "Point" | "Polygon" } {
  if (coords.length === 1) {
    return { texte: `{"type":"Point","coordinates":${coordTexte(coords[0])}}`, type: "Point" };
  }
  const anneau = [...coords];
  const premier = anneau[0];
  const dernier = anneau[anneau.length - 1];
  if (premier.lon !== dernier.lon || premier.lat !== dernier.lat) anneau.push(premier);
  const anneauTexte = "[" + anneau.map(coordTexte).join(",") + "]";
  return { texte: `{"type":"Polygon","coordinates":[${anneauTexte}]}`, type: "Polygon" };
}

function featureCollectionTexte(features: string[]): string {
  return `{"type":"FeatureCollection","features":[${features.join(",")}]}`;
}

function proprietesTexte(props: Record<string, unknown>): string {
  return JSON.stringify(props);
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

function countStringDecimals(str: string, decimalSep: "," | "." = "."): number {
  const trimmed = str.trim().replace(/^"|"$/g, "");
  const sep = trimmed.includes(decimalSep) ? decimalSep : decimalSep === "," ? "." : ",";
  if (!trimmed.includes(sep)) return 0;
  return trimmed.split(sep)[1].replace(/[^0-9]/g, "").length;
}

/**
 * Lit un nombre dans une cellule CSV, en respectant le séparateur décimal
 * attendu, et rapporte sa précision réelle.
 *
 * P1-16 — Excel français exporte en point-virgule avec la virgule pour
 * décimales : `46,123456`. `Number("46,123456")` vaut `NaN`, si bien que
 * chaque ligne était rejetée par « coordonnées non numériques ». Pire : quand
 * la cellule passait quand même, la précision était comptée après le point,
 * donc mesurée à 0 décimale, et la parcelle était refusée comme imprécise
 * alors qu'elle était parfaitement géolocalisée.
 *
 * La valeur et sa précision sont résolues **ensemble** : les produire par deux
 * chemins différents permettait à l'une de désigner la virgule et à l'autre le
 * point, ce qui est arrivé et rendait le diagnostic incompréhensible.
 */
function resolveNumber(raw: string, decimalSep: "," | "."): { value: number; decimals: number } {
  // Les espaces — y compris insécables, que Excel insère comme séparateur de
  // milliers — sont retirés avant toute analyse.
  const t0 = raw.trim().replace(/^"|"$/g, "").replace(/[\s\u00a0\u202f']/g, "");
  // Séparateur annoncé absent : on retombe sur l'autre plutôt que de lire un
  // entier à la place d'un décimal.
  const sep = t0.includes(decimalSep) ? decimalSep : decimalSep === "," ? "." : ",";
  const other = sep === "," ? "." : ",";
  const parts = t0.split(sep);
  const entiere = parts[0].split(other).join("");
  const decimales = parts.length > 1 ? parts.slice(1).join("").replace(/[^0-9]/g, "") : "";
  if (entiere.replace("-", "") === "" && decimales === "") {
    return { value: Number.NaN, decimals: 0 };
  }
  return { value: Number(entiere + (decimales ? "." + decimales : "")), decimals: decimales.length };
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
  // Le texte d'origine EST le GeoJSON : le reprendre tel quel préserve la
  // précision à l'identique, sans aucun risque de la dégrader.
  return { geojson, geojsonText: text.trim(), format: "GeoJSON", featureCount: countFeatures(geojson) };
}

// ---------------------------------------------------------------- KML
/**
 * KML : le séparateur décimal est le point (norme XML), quelle que soit la
 * langue de l'export.
 */
function parseKmlCoordinates(text: string): { coords: CoordPrecise[]; minDecimals: number } {
  let minDec = 999;
  const coords = text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tuple) => {
      const parts = tuple.split(",");
      if (parts.length < 2) {
        throw new ParseError(`Coordonnée KML invalide : "${tuple}"`);
      }
      const rawLon = parts[0];
      const rawLat = parts[1];
      const lon = Number(rawLon);
      const lat = Number(rawLat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        throw new ParseError(`Coordonnée KML invalide : "${tuple}"`);
      }
      const lonDec = countStringDecimals(rawLon, ".");
      const latDec = countStringDecimals(rawLat, ".");
      minDec = Math.min(minDec, lonDec, latDec);
      return { lon, lat, lonDec, latDec };
    });
  return { coords, minDecimals: minDec === 999 ? 0 : minDec };
}

function parseKml(text: string): ParsedUpload {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new ParseError("KML illisible (XML invalide)");

  const features: Array<Record<string, unknown>> = [];
  const featuresTexte: string[] = [];
  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));
  const containers = placemarks.length > 0 ? placemarks : [doc.documentElement];

  for (const pm of containers) {
    const name = pm.getElementsByTagName("name")[0]?.textContent?.trim() ?? null;
    const polygons = Array.from(pm.getElementsByTagName("Polygon"));
    for (const poly of polygons) {
      const outer = poly.getElementsByTagName("outerBoundaryIs")[0]?.getElementsByTagName("coordinates")[0];
      if (!outer?.textContent) continue;
      const outerParsed = parseKmlCoordinates(outer.textContent);
      const rings: number[][][] = [outerParsed.coords.map((c) => [c.lon, c.lat])];
      const ringsTexte: string[] = [];
      let minDec = outerParsed.minDecimals;

      for (const inner of Array.from(poly.getElementsByTagName("innerBoundaryIs"))) {
        const c = inner.getElementsByTagName("coordinates")[0]?.textContent;
        if (c) {
          const innerParsed = parseKmlCoordinates(c);
          rings.push(innerParsed.coords.map((cc) => [cc.lon, cc.lat]));
          minDec = Math.min(minDec, innerParsed.minDecimals);
        }
      }

      // Le texte est émis avant le rejet des trous par le serveur : ce défaut
      // doit être vu et compris par l'opérateur, pas avalé par l'import.
      const anneaux = outerParsed.coords;
      const geom = geometrieTexte(anneaux);
      ringsTexte.push(geom.texte);
      const props = { name, min_decimals: minDec };
      features.push({
        type: "Feature",
        properties: props,
        geometry: { type: "Polygon", coordinates: rings },
      });
      featuresTexte.push(
        `{"type":"Feature","properties":${proprietesTexte(props)},"geometry":${geom.texte}}`,
      );
    }
    if (polygons.length === 0) {
      for (const point of Array.from(pm.getElementsByTagName("Point"))) {
        const c = point.getElementsByTagName("coordinates")[0]?.textContent;
        if (!c) continue;
        const ptParsed = parseKmlCoordinates(c);
        const premier = ptParsed.coords[0];
        const props = { name, min_decimals: ptParsed.minDecimals };
        features.push({
          type: "Feature",
          properties: props,
          geometry: { type: "Point", coordinates: [premier.lon, premier.lat] },
        });
        featuresTexte.push(
          `{"type":"Feature","properties":${proprietesTexte(props)},"geometry":${geometrieTexte([premier]).texte}}`,
        );
      }
    }
  }
  if (features.length === 0) throw new ParseError("Aucun Polygon ni Point trouvé dans le KML");
  return {
    geojson: { type: "FeatureCollection", features },
    geojsonText: featureCollectionTexte(featuresTexte),
    format: "KML",
    featureCount: features.length,
  };
}

// ---------------------------------------------------------------- CSV
/**
 * CSV accepté :
 *   - en-tête optionnelle contenant `lat`/`latitude` et `lon`/`lng`/`longitude` (ordre libre) ;
 *   - sans en-tête : colonnes `lat,lon` par défaut ;
 *   - colonnes optionnelles `parcel`/`id` et `area`/`area_ha` ;
 *   - 1 ligne => Point ; ≥ 3 lignes => Polygon (fermé automatiquement si nécessaire).
 */
function parseCsv(text: string): ParsedUpload {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) throw new ParseError("CSV vide");

  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  // P1-16 — Excel en français exporte en point-virgule, avec la virgule comme
  // séparateur décimal. Le délier du délimiteur faisait échouer la moitié des
  // tableurs français sur un message « coordonnées non numériques » sans
  // rapport avec la vraie cause.
  const decimalSep: "," | "." = delimiter === ";" ? "," : ".";
  const split = (l: string): string[] => l.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));

  const header = split(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = header.some((h) => /^(lat|latitude|y)$/.test(h)) && header.some((h) => /^(lon|lng|long|longitude|x)$/.test(h));
  let latIdx = 0;
  let lonIdx = 1;
  let idIdx = -1;
  let areaIdx = -1;

  if (hasHeader) {
    latIdx = header.findIndex((h) => /^(lat|latitude|y)$/.test(h));
    lonIdx = header.findIndex((h) => /^(lon|lng|long|longitude|x)$/.test(h));
    idIdx = header.findIndex((h) => /^(parcel|parcel_id|plot|id|name)$/.test(h));
    areaIdx = header.findIndex((h) => /^(area|area_ha|superficie|surface|hectares|ha)$/.test(h));
  } else if (!/^-?\d/.test(lines[0])) {
    throw new ParseError("En-tête CSV non reconnue : colonnes attendues lat/latitude et lon/longitude");
  }

  interface GroupData {
    coords: CoordPrecise[];
    minDecimals: number;
    areaHa: number | null;
  }

  const groups = new Map<string, GroupData>();
  const rows = hasHeader ? lines.slice(1) : lines;

  rows.forEach((line, i) => {
    const cells = split(line);
    const rawLat = cells[latIdx] ?? "";
    const rawLon = cells[lonIdx] ?? "";
    const latN = resolveNumber(rawLat, decimalSep);
    const lonN = resolveNumber(rawLon, decimalSep);
    const lat = latN.value;
    const lon = lonN.value;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new ParseError(
        `Ligne ${i + (hasHeader ? 2 : 1)} : coordonnées non numériques ` +
          `(lu « ${rawLat} » / « ${rawLon} », séparateur décimal « ${decimalSep} »). ` +
          (decimalSep === "."
            ? "Pour un fichier à virgule décimale, exportez-le en point-virgule."
            : "Pour un fichier à point décimal, exportez-le en virgule comme séparateur de colonnes."),
      );
    }
    // Garde-fou : une lecture qui perd la précision doit être signalée, pas
    // absorbée. Des colonnes inversées donnent souvent des latitudes à trois
    // chiffres, que rien ne détecterait plus loin.
    if (lat > 90 || lat < -90 || lon > 180 || lon < -180) {
      throw new ParseError(
        `Ligne ${i + (hasHeader ? 2 : 1)} : coordonnées hors bornes WGS84 ` +
          `(lat ${lat}, lon ${lon}) — les colonnes sont-elles inversées ?`,
      );
    }

    const key = idIdx >= 0 ? (cells[idIdx] ?? "parcel") : "parcel";
    const rowDec = Math.min(latN.decimals, lonN.decimals);
    const rawArea = areaIdx >= 0 && cells[areaIdx] ? resolveNumber(cells[areaIdx], decimalSep).value : null;

    const group = groups.get(key) ?? { coords: [], minDecimals: 999, areaHa: null };
    group.coords.push({ lon, lat, lonDec: lonN.decimals, latDec: latN.decimals });
    group.minDecimals = Math.min(group.minDecimals, rowDec);
    if (rawArea !== null && Number.isFinite(rawArea)) {
      group.areaHa = rawArea;
    }
    groups.set(key, group);
  });

  const features: Array<Record<string, unknown>> = [];
  const featuresTexte: string[] = [];
  for (const [key, group] of groups) {
    const minDec = group.minDecimals === 999 ? 0 : group.minDecimals;
    const props: Record<string, unknown> = {
      name: key,
      min_decimals: minDec,
    };
    if (group.areaHa !== null) {
      props.area_ha = group.areaHa;
    }

    if (group.coords.length === 1) {
      const c = group.coords[0];
      features.push({
        type: "Feature",
        properties: props,
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
      });
      featuresTexte.push(
        `{"type":"Feature","properties":${proprietesTexte(props)},"geometry":${geometrieTexte([c]).texte}}`,
      );
    } else if (group.coords.length >= 3) {
      const geom = geometrieTexte(group.coords);
      features.push({
        type: "Feature",
        properties: props,
        geometry: { type: "Polygon", coordinates: [[...group.coords.map((c) => [c.lon, c.lat]), [group.coords[0].lon, group.coords[0].lat]]] },
      });
      featuresTexte.push(
        `{"type":"Feature","properties":${proprietesTexte(props)},"geometry":${geom.texte}}`,
      );
    } else {
      throw new ParseError(`Parcelle "${key}" : 2 points ne forment ni un point ni un polygone`);
    }
  }

  return {
    geojson: { type: "FeatureCollection", features },
    geojsonText: featureCollectionTexte(featuresTexte),
    format: "CSV",
    featureCount: features.length,
  };
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
