/**
 * Produit les corps de requête du banc P1-16.
 *
 * Pourquoi un script à part : l'import de fichier se fait côté navigateur, et
 * c'est **le client** qui détruisait la précision des coordonnées en
 * resérialisant le GeoJSON. Reproduire ce trajet à la main dans les tests
 * reviendrait à tester une copie du client, pas le client. On appelle donc le
 * vrai parseur et le vrai sérialiseur de requête, et l'on écrit les corps tels
 * qu'ils partiraient réellement.
 *
 * Exécution :
 *     npx tsx scripts/emettre-corps-p116.ts /tmp/corps_p116.json
 */
import { writeFileSync } from "node:fs";
import { parsePastedText } from "../src/lib/parsers";
import { serialiserRequete } from "../src/lib/api";

const OPERATEUR = {
  name: "Coopérative Test P1-16",
  country: "FR",
  role: "operator",
  eori: "FR12345678901",
  address: "12 rue de la Forêt, Nantes",
  email: "op@test.fr",
};

const sortie = process.argv[2] ?? "/tmp/corps_p116.json";

const CSV_FRANCAIS = [
  "Latitude;Longitude",
  "5,300000;-5,500000",
  "5,310000;-5,490000",
  "5,310000;-5,500000",
  "5,300000;-5,500000",
].join("\n");

const CSV_IMPRECIS = ["Latitude;Longitude", "5,3;-5,5", "5,31;-5,49", "5,31;-5,50", "5,3;-5,50"].join("\n");

// ⚠️ Écrit en littéral, pas par `JSON.stringify` : la sérialisation supprime
// les zéros terminaux et détruirait précisément ce que ce cas vérifie.
const GEOJSON_6 =
  '{"type":"Polygon","coordinates":[[[-5.500000,5.300000],[-5.490000,5.300000],' +
  "[-5.490000,5.310000],[-5.500000,5.310000],[-5.500000,5.300000]]]}";

const GEOJSON_8 =
  '{"type":"Polygon","coordinates":[[[-5.51234567,5.31234567],[-5.50234567,5.31234567],' +
  "[-5.50234567,5.32234567],[-5.51234567,5.32234567],[-5.51234567,5.31234567]]]}";

const TROUS =
  '{"type":"Polygon","coordinates":[' +
  "[[-5.500000,5.300000],[-5.490000,5.300000],[-5.490000,5.310000],[-5.500000,5.310000],[-5.500000,5.300000]]," +
  "[[-5.498000,5.304000],[-5.492000,5.304000],[-5.492000,5.308000],[-5.498000,5.308000],[-5.498000,5.304000]]]}";

const MULTIPOINT =
  '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"P1"},' +
  '"geometry":{"type":"MultiPoint","coordinates":[[-5.500000,5.300000],[-5.400000,5.300000],[-5.400000,5.400000]]}}]}';

function lot(n: number): string {
  const features = Array.from({ length: n }, (_, i) => {
    const lon = -5.5 + i * 0.02;
    const anneau = [
      [lon, 5.3],
      [lon + 0.01, 5.3],
      [lon + 0.01, 5.31],
      [lon, 5.31],
      [lon, 5.3],
    ]
      .map(([a, b]) => `[${(a as number).toFixed(6)},${(b as number).toFixed(6)}]`)
      .join(",");
    return `{"type":"Feature","properties":{"name":"P${i + 1}"},"geometry":{"type":"Polygon","coordinates":[[${anneau}]]}}`;
  });
  return `{"type":"FeatureCollection","features":[${features.join(",")}]}`;
}

interface Cas {
  /** Texte source (CSV/GeoJSON) ou GeoJSON déjà texte. */
  source: string;
  producteur?: { name: string; country: string };
  sameAsOperator?: boolean;
}

const CAS: Record<string, Cas> = {
  csv_francais: { source: CSV_FRANCAIS },
  csv_francais_avec_producteur: { source: CSV_FRANCAIS, producteur: { name: "Coopérative des Montagnes", country: "ET" } },
  csv_imprecis: { source: CSV_IMPRECIS },
  geojson_6: { source: GEOJSON_6 },
  geojson_8: { source: GEOJSON_8 },
  trous: { source: TROUS },
  multipoint: { source: MULTIPOINT },
  lot_5: { source: lot(5) },
  carre: { source: GEOJSON_6, producteur: { name: "Coopérative des Montagnes", country: "ET" } },
  carre_sans_producteur: { source: GEOJSON_6 },
  carre_producteur_operateur: { source: GEOJSON_6, sameAsOperator: true },
};

const corps: Record<string, string> = {};

for (const [cle, cas] of Object.entries(CAS)) {
  const analyse = parsePastedText(cas.source);
  const producer = cas.sameAsOperator
    ? { same_as_operator: true }
    : cas.producteur
      ? { name: cas.producteur.name, country: cas.producteur.country }
      : null;
  corps[cle] = serialiserRequete({
    geojson: analyse.geojson as never,
    geojsonText: analyse.geojsonText,
    commodity: "coffee",
    harvest_date: "2025-06-01",
    operator: OPERATEUR as never,
    producer: producer as never,
  } as never);
}

writeFileSync(sortie, JSON.stringify(corps), "utf-8");
console.log(`${Object.keys(corps).length} corps écrits dans ${sortie}`);
