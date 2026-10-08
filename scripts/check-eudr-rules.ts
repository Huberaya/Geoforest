/**
 * Vérification des règles EUDR du moteur TypeScript.
 *
 * Exécution : npm run test:eudr   (ou : npx tsx scripts/check-eudr-rules.ts)
 *
 * Ces contrôles verrouillent deux correctifs de sécurité réglementaire :
 *   - P0-03 : le verdict de conformité ne peut pas être dicté par le fichier
 *             déposé (propriétés `simulated_loss_year`, `area_ha`, …).
 *   - P0-05 : la précision des coordonnées est mesurée sur le texte source,
 *             sinon 92 % des GeoJSON valides à 6 décimales sont rejetés.
 */
import { validateGeometry, minDecimalsFromJsonText } from "../src/lib/eudr/gis-validator";
import { checkDeforestationRisk, deterministicCheck, nommerFournisseur } from "../src/lib/eudr/satellite-checker";
import { buildEudrIsGeoJson, toEudrIsGeometry } from "../src/lib/eudr/eudr-is-geojson";
import type { GeoJsonInput } from "../src/lib/eudr/types";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n##### ${title} #####`);
}

const CLEAN_POLYGON: GeoJsonInput = {
  type: "Polygon",
  coordinates: [
    [
      [38.201234, 6.161234],
      [38.203334, 6.161234],
      [38.203334, 6.163334],
      [38.201234, 6.163334],
      [38.201234, 6.161234],
    ],
  ],
};

// Zone du Pará (BR) : hotspot de déforestation 2022 du moteur déterministe.
const DEFORESTED_POLYGON: GeoJsonInput = {
  type: "Polygon",
  coordinates: [
    [
      [-52.401234, -5.101234],
      [-52.391234, -5.101234],
      [-52.391234, -5.091234],
      [-52.401234, -5.091234],
      [-52.401234, -5.101234],
    ],
  ],
};

// --------------------------------------------------------------- P0-03
async function testVerdictNotSpoofable(): Promise<void> {
  section("P0-03 — le verdict ne peut pas être dicté par le fichier");

  // Les deux appels reçoivent exactement la même forme (Feature) : seule la
  // propriété diffère. Comparer un Polygon et un Feature n'aurait rien prouvé.
  const clean = await checkDeforestationRisk(
    { type: "Feature", properties: {}, geometry: CLEAN_POLYGON } as unknown as never,
    "2024-06-01",
  );
  const poisoned = await checkDeforestationRisk(
    {
      type: "Feature",
      properties: { simulated_loss_year: 2022 },
      geometry: CLEAN_POLYGON,
    } as unknown as never,
    "2024-06-01",
  );
  check(
    "propriété simulated_loss_year = 2022 ignorée sur une parcelle saine",
    poisoned.compliant === clean.compliant && poisoned.loss_year === clean.loss_year,
    `propre=${clean.compliant} (${clean.loss_year}) · empoisonné=${poisoned.compliant} (${poisoned.loss_year})`,
  );

  // Le moteur de démonstration est activé le temps du test : sans source
  // configurée il n'y aurait aucun fait observable à comparer. P0-03 porte sur
  // l'influence du fichier, pas sur la provenance (objet de P0-04).
  const savedDemo = process.env.GFW_DEMO_MODE;
  process.env.GFW_DEMO_MODE = "true";
  const dirty = await checkDeforestationRisk(
    { type: "Feature", properties: {}, geometry: DEFORESTED_POLYGON } as unknown as never,
    "2024-06-01",
  );
  const whitewashed = await checkDeforestationRisk(
    {
      type: "Feature",
      properties: { simulated_loss_year: 2015, compliant: true, loss_year: null },
      geometry: DEFORESTED_POLYGON,
    } as unknown as never,
    "2024-06-01",
  );
  check(
    "aucune propriété ne peut blanchir une zone déforestée",
    dirty.loss_year === 2022 &&
      whitewashed.loss_year === dirty.loss_year &&
      whitewashed.risk_level === dirty.risk_level &&
      whitewashed.details === dirty.details,
    `référence=${dirty.loss_year} · falsifié=${whitewashed.loss_year}`,
  );
  process.env.GFW_DEMO_MODE = savedDemo ?? "false";

  const withArea = validateGeometry(
    {
      type: "Feature",
      properties: { area_ha: 50, declared_area_ha: 50, area: 50 },
      geometry: { type: "Point", coordinates: [38.201234, 6.161234] },
    } as unknown as GeoJsonInput,
    { declaredAreaHa: 1, rawText: "{}" },
  );
  const withoutArea = validateGeometry(
    { type: "Point", coordinates: [38.201234, 6.161234] } as unknown as GeoJsonInput,
    { declaredAreaHa: 1, rawText: "{}" },
  );
  check(
    "surface d'un point : la propriété area_ha du fichier est ignorée",
    withArea.area_ha === withoutArea.area_ha && withArea.eudr_geometry_rule === withoutArea.eudr_geometry_rule,
    `avec=${withArea.area_ha} ha · sans=${withoutArea.area_ha} ha`,
  );

  check(
    "la fonction de contournement a disparu du code source",
    !/simulated_loss_year/.test(
        require("fs").readFileSync(new URL("../src/lib/eudr/satellite-checker.ts", import.meta.url), "utf8"),
    ),
  );
}

// --------------------------------------------------------------- P0-05
function testPrecision(): void {
  section("P0-05 — précision mesurée sans détruire l'information");

  const rawSix = '{"type":"Polygon","coordinates":[[[-5.500000,5.300000],[-5.490000,5.300000],'
    + '[-5.490000,5.310000],[-5.500000,5.310000],[-5.500000,5.300000]]]}';
  check(
    "littéral -5.500000 ⇒ 6 décimales (et non 1 après parsing)",
    minDecimalsFromJsonText(rawSix) === 6,
    `mesuré ${minDecimalsFromJsonText(rawSix)}`,
  );

  const six = validateGeometry(JSON.parse(rawSix) as GeoJsonInput, { rawText: rawSix });
  check("fichier à 6 décimales accepté", six.valid && six.precision_ok, `min=${six.min_decimals_found} déc.`);

  const rawTwo = '{"type":"Polygon","coordinates":[[[-5.50,5.30],[-5.49,5.30],[-5.49,5.31],[-5.50,5.31],[-5.50,5.30]]]}';
  const two = validateGeometry(JSON.parse(rawTwo) as GeoJsonInput, { rawText: rawTwo });
  check(
    "fichier à 2 décimales toujours rejeté",
    !two.precision_ok && two.errors.some((e) => e.code === "INSUFFICIENT_PRECISION"),
    `min=${two.min_decimals_found} déc.`,
  );

  const noText = validateGeometry(JSON.parse(rawSix) as GeoJsonInput, {});
  check(
    "sans texte source, la précision approximée est signalée",
    noText.warnings.some((w) => w.code === "PRECISION_APPROXIMATED"),
  );

  const norm = JSON.stringify(six.normalized_geometry ?? {});
  const longest = Math.max(...(norm.match(/\.\d+/g) ?? ["."]).map((m) => m.length - 1));
  check("géométrie normalisée arrondie à 6 décimales (troncation EUDR-IS)", longest <= 6, `max ${longest} déc.`);
}

// --------------------------------------------------------------- P0-04
async function testProvenance(): Promise<void> {
  section("P0-04 — le verdict repose sur des données réelles, ou n'existe pas");

  const savedKey = process.env.GFW_API_KEY;
  const savedDemo = process.env.GFW_DEMO_MODE;

  // 1. Aucune source configurée, démonstration désactivée ⇒ aucun verdict.
  delete process.env.GFW_API_KEY;
  process.env.GFW_DEMO_MODE = "false";
  const noSource = await checkDeforestationRisk(CLEAN_POLYGON as never, "2024-06-01");
  check(
    "sans source configurée : aucun verdict, aucune confiance",
    noSource.source === "unavailable" && noSource.compliant === null && noSource.confidence_score === null,
    `source=${noSource.source} · compliant=${noSource.compliant}`,
  );
  check("sans source : la mention est présente", Boolean(noSource.disclaimer));

  // 2. Mode démonstration : simulation explicite, jamais probante.
  process.env.GFW_DEMO_MODE = "true";
  const simulated = await checkDeforestationRisk(DEFORESTED_POLYGON as never, "2024-06-01");
  check(
    "mode démonstration : simulé, non probant, sans verdict",
    simulated.source === "simulated" &&
      simulated.is_probative === false &&
      simulated.compliant === null &&
      simulated.confidence_score === null,
    `source=${simulated.source} · probant=${simulated.is_probative}`,
  );

  // 3. Une panne GFW ne doit jamais produire une simulation.
  process.env.GFW_DEMO_MODE = "false";
  process.env.GFW_API_KEY = "cle-volontairement-invalide";
  process.env.GFW_TIMEOUT_SECONDS = "10";
  const broken = await checkDeforestationRisk(DEFORESTED_POLYGON as never, "2024-06-01");
  check(
    "accès GFW défaillant : aucun repli vers la simulation",
    broken.source !== "simulated" && broken.compliant === null,
    `source=${broken.source} · détail=${(broken.details || "").slice(0, 90)}`,
  );

  if (savedKey === undefined) delete process.env.GFW_API_KEY;
  else process.env.GFW_API_KEY = savedKey;
  process.env.GFW_DEMO_MODE = savedDemo ?? "false";
}

// --------------------------------------------------------------- P0-06
function testEudrIsGeoJson(): void {
  section("P0-06 — GeoJSON conforme au système d'information EUDR");

  const polygon = {
    type: "Polygon",
    coordinates: [
      [
        [-5.5000001234, 5.3000009876],
        [-5.4900001234, 5.3000009876],
        [-5.4900001234, 5.3100009876],
        [-5.5000001234, 5.3100009876],
        [-5.5000001234, 5.3000009876],
      ],
    ],
  } as never;

  const built = buildEudrIsGeoJson([
    {
      geometry: polygon,
      areaHa: 1.4837,
      producerName: "Coopérative du Sassandra",
      producerCountry: "CI",
      productionPlace: "Sassandra",
    },
  ]);

  check("FeatureCollection produite", built.geojson.type === "FeatureCollection" && built.geojson.features.length === 1);
  const feature = built.geojson.features[0];
  check(
    "propriétés reconnues par le SI uniquement",
    JSON.stringify(Object.keys(feature.properties).sort()) ===
      JSON.stringify(["Area", "ProducerCountry", "ProducerName", "ProductionPlace"]),
    Object.keys(feature.properties).join(", "),
  );
  check("Area arrondie à 4 décimales", feature.properties.Area === 1.4837, String(feature.properties.Area));

  const coords = (feature.geometry as { coordinates: number[][][] }).coordinates[0];
  const longest = Math.max(
    ...coords.flat().map((c) => {
      const text = String(c);
      return text.includes(".") ? text.split(".")[1].length : 0;
    }),
  );
  check("coordonnées tronquées à 6 décimales", longest <= 6, `max ${longest} déc.`);
  // Cas d'école : 1,2345678 → troncation 1,234567 / arrondi 1,234568.
  const tronque = toEudrIsGeometry({ type: "Point", coordinates: [1.2345678, 9.8765432] } as never);
  const point = (tronque as { coordinates: number[] }).coordinates;
  check(
    "troncation et non arrondi (le SI tronque)",
    point[0] === 1.234567 && point[1] === 9.876543,
    `obtenu [${point[0]}, ${point[1]}] · attendu [1.234567, 9.876543] (arrondi donnerait 1.234568)`,
  );

  // Un type refusé par le SI doit être écarté et signalé, pas accepté.
  const lineString = { type: "LineString", coordinates: [[0, 0], [1, 1]] } as never;
  check("type refusé par le SI écarté", toEudrIsGeometry(lineString) === null);

  const withHoles = buildEudrIsGeoJson([
    {
      geometry: {
        type: "Polygon",
        coordinates: [
          [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
          [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4], [0.2, 0.2]],
        ],
      } as never,
    },
  ]);
  check(
    "polygone à trous signalé (refusé par le SI)",
    withHoles.warnings.some((w) => w.includes("trous")),
    withHoles.warnings[0] ?? "aucun avertissement",
  );

  const empty = buildEudrIsGeoJson([]);
  check("fichier vide signalé", empty.warnings.some((w) => w.includes("vide")));
}

// --------------------------------------------------------------- seuil 4 ha
function testFourHectares(): void {
  section("Règle des 4 ha — seuil strictement supérieur (art. 9(1)(d))");

  const point = { type: "Point", coordinates: [38.201234, 6.161234] } as unknown as GeoJsonInput;
  const at4 = validateGeometry(point, { declaredAreaHa: 4, rawText: "{}" });
  check("point déclaré à exactement 4 ha : point autorisé", at4.valid && at4.eudr_geometry_rule === "POINT_ALLOWED");

  const above4 = validateGeometry(point, { declaredAreaHa: 4.1, rawText: "{}" });
  check(
    "point déclaré au-delà de 4 ha : polygone requis",
    !above4.valid && above4.errors.some((e) => e.code === "POLYGON_REQUIRED"),
  );
}

// ---------------------------------------------------------------- moteur
function testDeterministicEngine(): void {
  section("Moteur déterministe — cohérence");
  const a = deterministicCheck(DEFORESTED_POLYGON as never, "2024-06-01");
  const b = deterministicCheck(DEFORESTED_POLYGON as never, "2024-06-01");
  check("deux appels identiques donnent le même verdict", JSON.stringify(a) === JSON.stringify(b));
}

/**
 * P0 (recette 2026-10-08) — garde-fous de la source satellite.
 * Aucun appel réseau : chaque cas choisi retourne avant toute requête.
 */
async function testSourceSatellite(): Promise<void> {
  section("Source satellite — garde-fous (recette 2026-10-08)");
  const cles = ["GFW_API_KEY", "GFW_API_URL", "GFW_DEMO_MODE"] as const;
  const sauvegarde: Record<string, string | undefined> = {};
  for (const k of cles) sauvegarde[k] = process.env[k];
  const restaurer = () => {
    for (const k of cles) {
      if (sauvegarde[k] === undefined) delete process.env[k];
      else process.env[k] = sauvegarde[k];
    }
  };

  try {
    // 1. Ni clé ni mode démonstration : aucun verdict.
    delete process.env.GFW_API_KEY;
    process.env.GFW_DEMO_MODE = "false";
    const sansSource = await checkDeforestationRisk(CLEAN_POLYGON as never, "2024-06-01");
    check("sans source ni démo : aucun verdict", sansSource.compliant === null, `compliant=${sansSource.compliant}`);
    check("sans source ni démo : source unavailable", sansSource.source === "unavailable", sansSource.source);
    check("sans source ni démo : non probant", sansSource.is_probative === false);

    // 2. Clé présente mais hôte non officiel : aucun verdict, pas d'appel réseau.
    process.env.GFW_API_KEY = "cle-de-test-non-reelle";
    process.env.GFW_API_URL = "https://miroir.example.org/api";
    const miroir = await checkDeforestationRisk(CLEAN_POLYGON as never, "2024-06-01");
    check("hôte non officiel : aucun verdict", miroir.compliant === null, `compliant=${miroir.compliant}`);
    check("hôte non officiel : source unavailable", miroir.source === "unavailable", miroir.source);
    check("hôte non officiel : détail nommé", miroir.details.includes("miroir.example.org"));

    // 3. Mode démonstration : résultat simulé, jamais probant, jamais « conforme » établi.
    delete process.env.GFW_API_KEY;
    process.env.GFW_DEMO_MODE = "true";
    const demo = await checkDeforestationRisk(CLEAN_POLYGON as never, "2024-06-01");
    check("démo : source simulée", demo.source === "simulated", demo.source);
    check("démo : non probante", demo.is_probative === false);
    check("démo : jamais compliant=true", demo.compliant !== true, `compliant=${demo.compliant}`);

    // 4. Identification de l'hôte officiel.
    check("hôte officiel reconnu", nommerFournisseur("https://data-api.globalforestwatch.org").officiel === true);
    check("sous-domaine usurpé refusé", nommerFournisseur("https://data-api.globalforestwatch.org.evil.example").officiel === false);
    check("chemin trompeur refusé", nommerFournisseur("https://evil.example/data-api.globalforestwatch.org").officiel === false);
  } finally {
    restaurer();
  }
}

async function main(): Promise<void> {
  console.log("=" .repeat(70));
  console.log("CHANTIER P0-03 / P0-05 — règles EUDR du moteur TypeScript");
  console.log("=".repeat(70));

  await testVerdictNotSpoofable();
  testPrecision();
  await testProvenance();
  testEudrIsGeoJson();
  testFourHectares();
  testDeterministicEngine();
  await testSourceSatellite();

  console.log(`\n${passed}/${passed + failures.length} contrôles réussis`);
  if (failures.length) {
    console.log("\nÉchecs :");
    for (const f of failures) console.log(`  🔴 ${f}`);
    process.exit(1);
  }
}

void main();
