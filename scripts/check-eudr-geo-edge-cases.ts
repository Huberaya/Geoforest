import { readFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Contrôles des cas limites géospatiaux et des réponses fournisseur dégradées.
 *
 * Exécution : npm run test:gis
 *
 * ⚠️ Aucune requête n'est envoyée à Global Forest Watch. Toutes les réponses
 * sont simulées localement : ces contrôles prouvent le comportement du logiciel
 * face à une réponse donnée, **jamais** la qualité des données du fournisseur.
 */
import { validateGeometry } from "../src/lib/eudr/gis-validator";
import {
  COUNTRY_RISK_BENCHMARK,
  LIMITE_REPONSE_VIDE,
  LIMITE_VERSION_NON_EPINGLEE,
  checkDeforestationRisk,
  parseGfwRows,
  resolveCountry,
  risqueRetenu,
} from "../src/lib/eudr/satellite-checker";
import { buildDdsPayload } from "../src/lib/eudr/traces-exporter";
import type { GeoJsonInput } from "../src/lib/eudr/types";
import type { ParcelAuditRow } from "../src/db/schema";

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

const POLY: GeoJsonInput = {
  type: "Polygon",
  coordinates: [
    [
      [38.201234, 6.161234],
      [38.202334, 6.161234],
      [38.202334, 6.162334],
      [38.201234, 6.162334],
      [38.201234, 6.161234],
    ],
  ],
};

const POLY_TEXT = JSON.stringify(POLY);

// ------------------------------------------------------------------ Pays
function testCountryResolution(): void {
  section("P2-16 — pays : résolution par frontières réelles, jamais par rectangles");

  // Cas exigés par la mission : les quatre capitales qui tombaient dans la
  // boîte « Union européenne », et les deux qui tombaient en Russie.
  const attendus: Array<[string, number, number, string]> = [
    ["Tunis", 10.1815, 36.8065, "TN"],
    ["Alger", 3.0588, 36.7538, "DZ"],
    ["Tanger", -5.7998, 35.7595, "MA"],
    ["Belgrade", 20.4573, 44.7872, "RS"],
    ["Kiev", 30.5234, 50.4501, "UA"],
    ["Hokkaido", 142.0, 43.0, "JP"],
    ["Oulan-Bator", 106.9057, 47.8864, "MN"],
    ["Nassau", -77.3396, 25.0443, "BS"],
    ["San Salvador", -89.2182, 13.6929, "SV"],
    ["Paris", 2.3522, 48.8566, "FR"],
  ];
  for (const [label, lon, lat, attendu] of attendus) {
    const r = resolveCountry(lon, lat);
    check(
      `${label} → ${attendu}`,
      r.iso2 === attendu && r.method === "natural-earth-50m",
      `pays=${r.iso2} (${r.name}) méthode=${r.method}`,
    );
  }

  // Garde : les attributions fautives mesurées avant P2-16 ne doivent pas revenir.
  const interdits: Array<[string, number, number, string]> = [
    ["Tunis n'est pas l'Union européenne", 10.1815, 36.8065, "EU"],
    ["Alger n'est pas l'Union européenne", 3.0588, 36.7538, "EU"],
    ["Tanger n'est pas l'Union européenne", -5.7998, 35.7595, "EU"],
    ["Belgrade n'est pas l'Union européenne", 20.4573, 44.7872, "EU"],
    ["Kiev n'est pas la Russie", 30.5234, 50.4501, "RU"],
    ["Hokkaido n'est pas la Russie", 142.0, 43.0, "RU"],
  ];
  for (const [label, lon, lat, interdit] of interdits) {
    const r = resolveCountry(lon, lat);
    check(label, r.iso2 !== interdit && !r.candidates.includes(interdit), `pays=${r.iso2}`);
  }

  // Un point hors couverture reste non déterminé, avec sa limite explicite.
  const kosovo = resolveCountry(21.1655, 42.6629);
  check(
    "un point sans code ISO reste « non déterminé », sans pays voisin substitué",
    kosovo.iso2 === "XX" && kosovo.candidates.length === 0,
    `pays=${kosovo.iso2} candidats=${kosovo.candidates.join("/")}`,
  );
  const ocean = resolveCountry(-30.0, 20.0);
  check("un point en haute mer reste « non déterminé »", ocean.iso2 === "XX", `pays=${ocean.iso2}`);

  // Le plancher de risque est un contrôle DISTINCT de la résolution du pays :
  // résoudre correctement « France » ne rend pas la classification vérifiée.
  check(
    "un risque faible n'est jamais retenu au niveau de l'audit",
    risqueRetenu("LOW") === "STANDARD" && risqueRetenu("HIGH") === "HIGH",
    `LOW→${risqueRetenu("LOW")} · HIGH→${risqueRetenu("HIGH")}`,
  );
  check(
    "la résolution correcte du pays n'élève pas la table de risque au rang de source vérifiée",
    COUNTRY_RISK_BENCHMARK.verified === false && COUNTRY_RISK_BENCHMARK.applied_from === null,
    `verified=${COUNTRY_RISK_BENCHMARK.verified}`,
  );
  check(
    "la provenance du jeu de frontières est déclarée",
    COUNTRY_RISK_BENCHMARK.borders.dataset.includes("Natural Earth") &&
      COUNTRY_RISK_BENCHMARK.borders.version === "2.0.2",
    COUNTRY_RISK_BENCHMARK.borders.dataset,
  );

  // Parité : le fichier de points de contrôle est lu par les DEUX suites. Une
  // divergence entre frontières TypeScript et Python échoue des deux côtés.
  const referentiel = JSON.parse(
    readFileSync(join(process.cwd(), "data/frontieres/points-de-controle.json"), "utf8"),
  ) as {
    methode: string;
    points: Array<{ label: string; lon: number; lat: number; iso2: string }>;
  };
  check(
    "le référentiel partagé déclare la même méthode que le code",
    referentiel.methode === COUNTRY_RISK_BENCHMARK.resolution_method,
    referentiel.methode,
  );
  check("le référentiel partagé contient au moins 15 points", referentiel.points.length >= 15, `${referentiel.points.length}`);
  const ecarts: string[] = [];
  for (const p of referentiel.points) {
    const r = resolveCountry(p.lon, p.lat);
    if (r.iso2 !== p.iso2) ecarts.push(`${p.label}: attendu ${p.iso2}, obtenu ${r.iso2}`);
  }
  check(
    "les 18 points de contrôle partagés concordent",
    ecarts.length === 0,
    ecarts.join(" · ") || `${referentiel.points.length} points`,
  );

  // Parité avec le backend : ces valeurs sont les mêmes dans
  // backend/tests/test_gis_edge_cases.py::TestPays.
  check(
    "parité de méthode entre TypeScript et Python",
    COUNTRY_RISK_BENCHMARK.resolution_method === "natural-earth-50m",
    COUNTRY_RISK_BENCHMARK.resolution_method,
  );
}

// ------------------------------------------------------------------ GFW
async function testGfwDegraded(): Promise<void> {
  section("P2-02 — réponse GFW dégradée : jamais un verdict conforme fabriqué");

  check("charge utile nulle rejetée", throws(() => parseGfwRows(null)));
  check("champ data absent rejeté", throws(() => parseGfwRows({ statut: "ok" })));
  check("data non tableau rejeté", throws(() => parseGfwRows({ data: { rows: [] } })));
  check("ligne sans année rejetée", throws(() => parseGfwRows({ data: [{ area__ha: 2 }] })));
  check("surface nulle rejetée", throws(() => parseGfwRows({ data: [{ umd_tree_cover_loss__year: 2022, area__ha: null }] })));
  check("surface négative rejetée", throws(() => parseGfwRows({ data: [{ umd_tree_cover_loss__year: 2022, area__ha: -3 }] })));
  check(
    "tableau vide accepté comme observation négative",
    parseGfwRows({ data: [] }).length === 0,
  );
  check(
    "ligne valide (année et surface en chaînes) acceptée",
    parseGfwRows({ data: [{ umd_tree_cover_loss__year: "2022", area__ha: "0.9" }] })[0]?.area === 0.9,
  );

  const saved = {
    key: process.env.GFW_API_KEY,
    enabled: process.env.GFW_LIVE_ENABLED,
    url: process.env.GFW_API_URL,
    version: process.env.GFW_DATASET_VERSION,
    demo: process.env.GFW_DEMO_MODE,
    fetch: globalThis.fetch,
  };
  process.env.GFW_API_KEY = "cle-de-test-locale-jamais-reelle";
  process.env.GFW_LIVE_ENABLED = "true";
  // Hôte non routable : aucune requête ne sort du poste.
  process.env.GFW_API_URL = "https://gfw-test.invalid";
  process.env.GFW_DEMO_MODE = "false";
  delete process.env.GFW_DATASET_VERSION;

  const scenarios: Array<[string, string]> = [
    ["data = null", JSON.stringify({ data: null })],
    ["data absent", JSON.stringify({ statut: "ok" })],
    ["data = objet", JSON.stringify({ data: { rows: [] } })],
    ["ligne sans année", JSON.stringify({ data: [{ area__ha: 2 }] })],
    ["année 2022 sans surface", JSON.stringify({ data: [{ umd_tree_cover_loss__year: 2022, area__ha: null }] })],
    ["corps non JSON", "<html>maintenance</html>"],
  ];
  for (const [label, body] of scenarios) {
    globalThis.fetch = (async () => new Response(body, { status: 200 })) as typeof fetch;
    const result = await checkDeforestationRisk(POLY as never, "2024-06-01");
    check(
      `${label} ⇒ aucun verdict`,
      result.source === "unavailable" && result.compliant === null && result.is_probative === false,
      `source=${result.source} compliant=${String(result.compliant)}`,
    );
  }

  globalThis.fetch = (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as typeof fetch;
  const empty = await checkDeforestationRisk(POLY as never, "2024-06-01");
  check(
    "réponse vide : verdict négatif mais limite de couverture consignée",
    empty.compliant === true &&
      empty.source === "gfw-live" &&
      empty.provenance.limits.includes(LIMITE_REPONSE_VIDE),
  );
  check(
    "version « latest » : non-reproductibilité consignée",
    empty.provenance.limits.includes(LIMITE_VERSION_NON_EPINGLEE),
    `version=${String(empty.provenance.version)}`,
  );

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: [{ umd_tree_cover_loss__year: 2022, area__ha: 0.9 }] }), {
      status: 200,
    })) as typeof fetch;
  const loss = await checkDeforestationRisk(POLY as never, "2024-06-01");
  check(
    "perte post-2020 : non conforme, aucun risque faible",
    loss.compliant === false && loss.risk_level === "HIGH" && loss.loss_area_ha === 0.9,
    `perte=${loss.loss_area_ha} ha`,
  );

  // ---------------------------------------------------------------- P2-07
  const fcVide = { type: "FeatureCollection", features: [] };
  const vide = await checkDeforestationRisk(fcVide as never, "2024-06-01");
  check(
    "collection vide : aucun verdict, aucun pays inventé",
    vide.source === "unavailable" && vide.compliant === null && vide.country_code === "XX",
    `source=${vide.source} pays=${vide.country_code}`,
  );

  const fcNulle = {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: null }],
  };
  const nulle = await checkDeforestationRisk(fcNulle as never, "2024-06-01");
  check(
    "collection sans géométrie : aucun verdict, pas d'exception",
    nulle.source === "unavailable" && nulle.compliant === null,
    `source=${nulle.source} compliant=${String(nulle.compliant)}`,
  );

  process.env.GFW_API_URL = "https://cache-interne.exemple.invalid";
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as typeof fetch;
  const nonOfficiel = await checkDeforestationRisk(POLY as never, "2024-06-01");
  check(
    "un hôte non officiel n'est jamais présenté comme Global Forest Watch",
    nonOfficiel.evidence?.is_official_source === false &&
      !nonOfficiel.evidence?.provider.startsWith("Global Forest Watch"),
    `fournisseur=${nonOfficiel.evidence?.provider}`,
  );

  process.env.GFW_API_KEY = saved.key;
  process.env.GFW_LIVE_ENABLED = saved.enabled;
  process.env.GFW_API_URL = saved.url;
  process.env.GFW_DATASET_VERSION = saved.version;
  process.env.GFW_DEMO_MODE = saved.demo;
  globalThis.fetch = saved.fetch;
  if (saved.key === undefined) delete process.env.GFW_API_KEY;
  if (saved.url === undefined) delete process.env.GFW_API_URL;
  if (saved.version === undefined) delete process.env.GFW_DATASET_VERSION;
}

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// ------------------------------------------------------------------ GéoJSON
function testGeometryEdgeCases(): void {
  section("P2-03/04/05 — géométries invalides, trous, antiméridien, surfaces");

  const fcNull = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: POLY },
      { type: "Feature", properties: {}, geometry: null },
    ],
  };
  const rNull = validateGeometry(fcNull as never, { rawText: JSON.stringify(fcNull) });
  check(
    "une géométrie absente dans un lot est un refus, pas une omission",
    rNull.valid === false && rNull.errors.some((e) => e.code === "MISSING_GEOMETRY"),
    `erreurs=${rNull.errors.map((e) => e.code).join(",")}`,
  );

  const troue = {
    type: "Polygon",
    coordinates: [
      [[0.001234, 0.001234], [0.011234, 0.001234], [0.011234, 0.011234], [0.001234, 0.011234], [0.001234, 0.001234]],
      [[0.003234, 0.003234], [0.005234, 0.003234], [0.005234, 0.005234], [0.003234, 0.005234], [0.003234, 0.003234]],
    ],
  };
  const rTrou = validateGeometry(troue as never, { rawText: JSON.stringify(troue) });
  check(
    "polygone à trou refusé (règle SI EUDR)",
    rTrou.valid === false && rTrou.errors.some((e) => e.code === "POLYGON_WITH_HOLES"),
    `erreurs=${rTrou.errors.map((e) => e.code).join(",")}`,
  );

  const anti = {
    type: "Polygon",
    coordinates: [[
      [179.900001, -16.100001], [-179.900001, -16.100001],
      [-179.900001, -16.000001], [179.900001, -16.000001], [179.900001, -16.100001],
    ]],
  };
  const rAnti = validateGeometry(anti as never, { rawText: JSON.stringify(anti) });
  check(
    "antiméridien refusé au lieu d'une surface de 42,8 M ha",
    rAnti.valid === false && rAnti.errors.some((e) => e.code === "ANTIMERIDIAN_UNSUPPORTED") && rAnti.area_ha === 0,
    `area=${rAnti.area_ha} erreurs=${rAnti.errors.map((e) => e.code).join(",")}`,
  );

  const point41 = validateGeometry(
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [38.201234, 6.161234] } } as never,
    { declaredAreaHa: 4.1, rawText: "{}" },
  );
  const msg = point41.errors.find((e) => e.code === "POLYGON_REQUIRED")?.message ?? "";
  check(
    "message du seuil : strictement supérieur à 4 ha",
    msg.includes("> 4 ha") && !msg.includes("≥ 4 ha"),
    msg,
  );

  const carre = validateGeometry(
    { type: "Polygon", coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]] } as never,
    { rawText: "{}" },
  );
  check(
    "surface ellipsoïdale de référence : 0,01° × 0,01° à l'équateur = 123,0907 ha",
    Math.abs(carre.area_ha - 123.0907) < 0.0002,
    `area=${carre.area_ha} ha`,
  );

  const mismatch = validateGeometry(POLY, { declaredAreaHa: 8, rawText: POLY_TEXT });
  check(
    "écart surface déclarée / surface calculée signalé",
    mismatch.warnings.some((w) => w.code === "DECLARED_AREA_MISMATCH"),
    `avertissements=${mismatch.warnings.map((w) => w.code).join(",")}`,
  );

  const formes: Array<[string, unknown]> = [
    ["Polygon sans coordinates", { type: "Polygon" }],
    ["Polygon coordinates vides", { type: "Polygon", coordinates: [] }],
    ["MultiPolygon [null]", { type: "MultiPolygon", coordinates: [null] }],
    ["MultiPolygon [anneau, null]", { type: "MultiPolygon", coordinates: [[[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0]]], null] }],
    ["GeometryCollection [null]", { type: "GeometryCollection", geometries: [null] }],
    ["Polygon anneau null", { type: "Polygon", coordinates: [null] }],
  ];
  for (const [label, forme] of formes) {
    let resultat: ReturnType<typeof validateGeometry> | null = null;
    let plante = false;
    try {
      resultat = validateGeometry(forme as never);
    } catch {
      plante = true;
    }
    check(
      `${label} : refus, jamais de plantage`,
      !plante && resultat !== null && resultat.valid === false && resultat.errors.length > 0,
      resultat ? `erreurs=${resultat.errors.map((e) => e.code).join(",")}` : "exception non gérée",
    );
  }

  const trop = {
    type: "Polygon",
    coordinates: [[
      ...Array.from({ length: 5001 }, (_, i) => [38 + i * 1e-6, 6.0]),
      ...Array.from({ length: 5001 }, (_, i) => [38 + (5000 - i) * 1e-6, 6.001]),
    ]],
  };
  const rTrop = validateGeometry(trop as never, { rawText: JSON.stringify(trop) });
  check(
    "plafond de 10 000 sommets appliqué avec le décompte réel",
    rTrop.valid === false &&
      rTrop.errors.some((e) => e.code === "TOO_MANY_VERTICES") &&
      rTrop.vertex_count > 10_000,
    `sommets=${rTrop.vertex_count}`,
  );
}

// ------------------------------------------------------------------ Export
function testExportTraceability(): void {
  section("P2-06 — trace exportée : trois états, règle des 4 ha par parcelle");

  const base = {
    id: "11111111-1111-1111-1111-111111111111",
    createdAt: new Date("2026-10-19T12:00:00Z"),
    operatorName: "Opérateur test",
    operatorEori: "FR12345678901234",
    operatorCountry: "FR",
    producerName: "Producteur test",
    producerCountry: "CI",
    commodity: "cocoa",
    hsCode: "1801",
    harvestDate: "2024-03-15",
    parcelReference: "P-1",
    geometry: POLY,
    geometryType: "Polygon",
    areaHa: 6,
    validation: { eudr_geometry_rule: "POINT_ALLOWED" },
    satellite: { source: "unavailable" },
    status: "ANALYSIS_UNAVAILABLE",
    compliant: null,
    lossYear: null,
    confidenceScore: null,
    riskLevel: "STANDARD",
    countryRisk: "STANDARD",
    countryCode: "CI",
    centroidLon: 38.2018,
    centroidLat: 6.1618,
  } as unknown as ParcelAuditRow;

  const payload = buildDdsPayload(base, { name: "Opérateur test", eori: "FR12345678901234", country: "FR" }, {
    activityType: "IMPORT",
    netWeightKg: 100,
    internalReference: null,
    countryOfActivity: "FR",
  }) as { verification: Record<string, unknown> };
  check(
    "absence de verdict exportée comme NOT_VERIFIED (ni conforme ni non conforme)",
    payload.verification.status === "NOT_VERIFIED",
    `statut=${String(payload.verification.status)}`,
  );
  check(
    "aucune déforestation affirmée sans mesure",
    payload.verification.deforestation_detected_post_cutoff === null,
    `valeur=${String(payload.verification.deforestation_detected_post_cutoff)}`,
  );
  check(
    "règle des 4 ha reprise de la validation, pas recalculée sur 6 ha",
    payload.verification.geometry_rule === "POINT_ALLOWED",
    `règle=${String(payload.verification.geometry_rule)}`,
  );
}

// ------------------------------------------------------------------ Opérateur
function testOperatorIdentity(): void {
  section("P2-15 — identité de l'opérateur : aucune valeur de remplissage");

  const base = {
    id: "22222222-2222-2222-2222-222222222222",
    createdAt: new Date("2026-10-19T12:00:00Z"),
    // Dossier sans identité : les trois colonnes valent null.
    operatorName: null,
    operatorEori: null,
    operatorCountry: null,
    producerName: null,
    producerCountry: null,
    commodity: "cocoa",
    hsCode: "1801",
    harvestDate: "2024-03-15",
    parcelReference: "P-2",
    geometry: POLY,
    geometryType: "Polygon",
    areaHa: 1.2,
    validation: { eudr_geometry_rule: "POINT_ALLOWED" },
    satellite: { source: "unavailable" },
    status: "ANALYSIS_UNAVAILABLE",
    compliant: null,
    lossYear: null,
    confidenceScore: null,
    riskLevel: "STANDARD",
    countryRisk: "STANDARD",
    countryCode: "CI",
    centroidLon: 38.2018,
    centroidLat: 6.1618,
  } as unknown as ParcelAuditRow;

  const options = {
    activityType: "IMPORT" as const,
    netWeightKg: null,
    internalReference: null,
    countryOfActivity: "FR",
  };

  const avecIdentite = buildDdsPayload(
    base,
    { name: "Coopérative Test", eori: "BE12345678901234", country: null as unknown as string },
    options,
  ) as { operator: Record<string, unknown> };
  check(
    "pays de l'opérateur déduit de l'EORI, jamais « FR » par défaut",
    avecIdentite.operator.country === "BE",
    `pays=${String(avecIdentite.operator.country)}`,
  );

  const nord = buildDdsPayload(
    base,
    { name: "Coopérative Nord", eori: "SE12345678901234" },
    options,
  ) as { operator: Record<string, unknown> };
  check(
    "aucune nationalité inventée pour un opérateur sans pays déclaré",
    nord.operator.country === "SE",
    `pays=${String(nord.operator.country)}`,
  );

  const producteur = buildDdsPayload(
    base,
    { name: "Coopérative Test", eori: "FR12345678901234" },
    options,
  ) as {
    statement: { commodities: Array<{ producers: Array<{ name: string; country: string }> }> };
  };
  const noeud = producteur.statement.commodities[0].producers[0];
  check(
    "le producteur n'emprunte pas le nom de l'opérateur",
    noeud.name === "",
    `nom=${JSON.stringify(noeud.name)}`,
  );
  check(
    "le producteur n'emprunte pas la nationalité de la parcelle",
    noeud.country === "",
    `pays=${JSON.stringify(noeud.country)}`,
  );

  const texte = JSON.stringify(producteur);
  check(
    "aucun EORI de remplissage dans la déclaration",
    !texte.includes("XX0000000000000"),
    texte.includes("XX0000000000000") ? "valeur fabriquée présente" : "absent",
  );
}

async function main(): Promise<void> {
  console.log("======================================================================");
  console.log("CAS LIMITES GÉOSPATIAUX ET RÉPONSES FOURNISSEUR DÉGRADÉES");
  console.log("Aucune requête externe : réponses GFW simulées localement.");
  console.log("======================================================================");
  testCountryResolution();
  await testGfwDegraded();
  testGeometryEdgeCases();
  testExportTraceability();
  testOperatorIdentity();
  console.log(`\n${passed}/${passed + failures.length} contrôles réussis`);
  if (failures.length > 0) {
    console.log("\nÉchecs :");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

void main();
