/**
 * Contrôle P2-16 — attribution du pays par frontières réelles (parité TypeScript).
 *
 * ⚠️ Pourquoi ce script existe.
 *
 * Jusqu'ici, le moteur ne savait pas dans quel pays se trouvait une parcelle :
 * il répondait « XX » partout, après qu'une version antérieure ait attribué
 * Tunis à l'Union européenne et Kiev à la Russie par simples rectangles. Le
 * pays est maintenant lu dans un jeu de frontières **versionné** avec sa
 * provenance (`data/frontieres/PROVENANCE.md`). Ce qui doit rester vrai :
 *
 *   1. les points de contrôle partagés avec Python donnent le même résultat
 *      (`data/frontieres/points-de-controle.json`, lu par les DEUX suites) ;
 *   2. un point hors couverture reste « XX » — aucun voisin n'est substitué ;
 *   3. le niveau de risque pays reste `UNKNOWN` : aucun benchmark officiel
 *      versionné n'est intégré, et il n'est pas déduit du pays ;
 *   4. l'analyse consigne la méthode d'attribution dans sa provenance, et
 *      l'export TRACES publie cette méthode — jamais une étiquette fabriquée.
 *
 * Exécution : npx tsx --conditions=react-server scripts/check-frontieres.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { frontieresDisponibles, resoudrePays } from "../src/lib/eudr/frontieres";
import { checkDeforestationRisk, resolveCountry } from "../src/lib/eudr/satellite-checker";
import { attributionPays, buildDdsPayload } from "../src/lib/eudr/traces-exporter";
import type { ParcelAuditRow } from "../src/db/schema";
import type { SupportedGeometry } from "../src/lib/eudr/types";

let passed = 0;
const echecs: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    echecs.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(titre: string): void {
  console.log(`\n\u001b[1m${titre}\u001b[0m`);
}

const DOSSIER = join(process.cwd(), "data", "frontieres");

interface PointDeControle {
  label: string;
  lon: number;
  lat: number;
  iso2: string;
  motif?: string;
}

const EMPREINTES: Record<string, string> = {
  "countries-50m.json": "04342cdc1e3016bcd7db1630de95684d67b79fe3c8c460321e87aef469502394",
  "iso-numerique-alpha2.json": "1a006da4c336a74a3e60e7230885a543ae72bcb46ca0717d962b83af8baf501e",
};

function sha256(chemin: string): string {
  return createHash("sha256").update(readFileSync(chemin)).digest("hex");
}

async function main(): Promise<void> {
  section("Référentiel : empreintes, provenance, licence");
  for (const [fichier, attendu] of Object.entries(EMPREINTES)) {
    const obtenu = sha256(join(DOSSIER, fichier));
    check(`${fichier} : empreinte SHA-256 conforme à PROVENANCE.md`, obtenu === attendu, obtenu.slice(0, 16));
  }
  const provenance = readFileSync(join(DOSSIER, "PROVENANCE.md"), "utf8");
  check("PROVENANCE.md nomme la source et la version", provenance.includes("world-atlas@2.0.2"));
  check("notice de licence ISC versionnée", readFileSync(join(DOSSIER, "LICENSE-world-atlas.txt"), "utf8").includes("Michael Bostock"));
  check("frontières chargées", frontieresDisponibles());

  section("Points de contrôle partagés avec Python (même fichier, même attendu)");
  const jeu = JSON.parse(readFileSync(join(DOSSIER, "points-de-controle.json"), "utf8")) as {
    methode: string;
    points: PointDeControle[];
  };
  check("méthode annoncée : natural-earth-50m", jeu.methode === "natural-earth-50m");
  check("au moins quinze points de contrôle", jeu.points.length >= 15, `${jeu.points.length}`);
  for (const p of jeu.points) {
    const r = resoudrePays(p.lon, p.lat);
    const ok = r.iso2 === p.iso2 && !r.ambiguous && r.method === "natural-earth-50m" &&
      (p.iso2 === "XX" ? r.candidates.length === 0 : r.candidates.length === 1 && r.candidates[0] === p.iso2);
    check(`${p.label} → ${p.iso2}`, ok, `${r.iso2}${r.ambiguous ? " (ambigu)" : ""}${p.motif ? ` · ${p.motif}` : ""}`);
  }

  section("Hors couverture et entrées invalides : jamais un voisin substitué");
  check("haute mer → XX", resoudrePays(-30, 20).iso2 === "XX");
  check("NaN → XX", resoudrePays(Number.NaN, 0).iso2 === "XX");
  check("Infinity → XX", resoudrePays(Number.POSITIVE_INFINITY, 0).iso2 === "XX");
  check("hors plage (lon 200) → XX", resoudrePays(200, 0).iso2 === "XX");

  section("Moteur : pays attribué, risque jamais déduit");
  const paris = resolveCountry(2.3522, 48.8566);
  check("Paris → FR par natural-earth-50m", paris.iso2 === "FR" && paris.method === "natural-earth-50m");
  check("risque pays = UNKNOWN (aucun benchmark officiel intégré)", paris.risk === "UNKNOWN");
  const mer = resolveCountry(-30, 20);
  check("haute mer : XX, candidats vides, risque UNKNOWN", mer.iso2 === "XX" && mer.candidates.length === 0 && mer.risk === "UNKNOWN");

  // Analyse réelle du moteur sans GFW ni démonstration : indisponible, mais le
  // pays et la méthode d'attribution sont tout de même consignés.
  delete process.env.GFW_API_KEY;
  process.env.GFW_DEMO_MODE = "false";
  const abidjan: SupportedGeometry = { type: "Point", coordinates: [-4.0083, 5.3599] } as SupportedGeometry;
  const analyse = await checkDeforestationRisk(abidjan, "2025-01-01");
  check("analyse indisponible : aucun verdict", analyse.compliant === null && analyse.source === "unavailable");
  check("analyse indisponible : pays tout de même attribué (CI)", analyse.country_code === "CI");
  check("analyse indisponible : risque pays UNKNOWN", analyse.country_risk === "UNKNOWN" && analyse.risk_level === "UNKNOWN");
  check(
    "provenance.params.resolution_pays = natural-earth-50m",
    analyse.provenance.params.resolution_pays === "natural-earth-50m",
    JSON.stringify(analyse.provenance.params.resolution_pays),
  );
  check("provenance.limits mentionne la limite d'attribution", analyse.provenance.limits.some((l) => l.includes("Natural Earth 1:50m")));

  section("Export TRACES : la méthode publiée est celle consignée, jamais fabriquée");
  check("params sans méthode → legacy_unknown", attributionPays(undefined) === "legacy_unknown");
  check("params {} → legacy_unknown", attributionPays({}) === "legacy_unknown");
  check("params unavailable → unavailable", attributionPays({ resolution_pays: "unavailable" }) === "unavailable");
  check("params natural-earth-50m → natural-earth-50m", attributionPays({ resolution_pays: "natural-earth-50m" }) === "natural-earth-50m");
  check("valeur inconnue → legacy_unknown (pas de confiance implicite)", attributionPays({ resolution_pays: "approximate_bbox" }) === "legacy_unknown");

  const now = new Date();
  const ligne = {
    id: "00000000-0000-4000-8000-000000000001",
    organizationId: "00000000-0000-4000-8000-0000000000aa",
    operatorName: "Opérateur Test",
    operatorEori: "FR12345678901234",
    operatorCountry: "FR",
    producerName: null,
    producerCountry: null,
    commodity: "cocoa",
    hsCode: "1801",
    harvestDate: "2025-01-01",
    parcelReference: "P-1",
    geometry: abidjan,
    geometryType: "Point",
    areaHa: 1,
    vertexCount: 1,
    centroidLon: -4.0083,
    centroidLat: 5.3599,
    countryCode: analyse.country_code,
    countryRisk: analyse.country_risk,
    compliant: null,
    lossYear: null,
    confidenceScore: null,
    analysisSource: "unavailable",
    analysisProbative: false,
    analysisEvidence: null,
    analysisMethod: "aucune",
    analysisVersion: null,
    analysisParams: analyse.provenance.params,
    analysisLimits: analyse.provenance.limits,
    riskLevel: "UNKNOWN",
    status: "ANALYSIS_UNAVAILABLE",
    validation: {},
    satellite: analyse,
    createdAt: now,
  } as unknown as ParcelAuditRow;
  const dds = buildDdsPayload(
    ligne,
    { name: "Opérateur Test", eori: "FR12345678901234", country: "FR" },
    { activityType: "IMPORT", netWeightKg: 100, internalReference: "REF-1", countryOfActivity: "FR" },
  ) as { verification: Record<string, unknown> };
  check("export : country_code publié = CI", dds.verification.country_code === "CI");
  check("export : country_attribution = natural-earth-50m", dds.verification.country_attribution === "natural-earth-50m");
  check("export : attribution déclarée non fiable au cadastre", dds.verification.country_attribution_reliable === false);
  check("export : benchmark pays UNKNOWN", dds.verification.country_benchmark_risk === "UNKNOWN");
  const avertissement = String(dds.verification.country_attribution_warning ?? "");
  check("export : plus aucune mention de boîte englobante", !avertissement.includes("boîte englobante") && avertissement.includes("Natural Earth"));

  const ancienne = { ...ligne, satellite: { ...analyse, provenance: { ...analyse.provenance, params: {} } } } as unknown as ParcelAuditRow;
  const ddsAncienne = buildDdsPayload(
    ancienne,
    { name: "Opérateur Test", eori: "FR12345678901234", country: "FR" },
    { activityType: "IMPORT", netWeightKg: 100, internalReference: "REF-2", countryOfActivity: "FR" },
  ) as { verification: Record<string, unknown> };
  check("export d'un audit antérieur (sans méthode) : legacy_unknown, non rétro-qualifié", ddsAncienne.verification.country_attribution === "legacy_unknown");

  console.log(`\nRésultat : ${passed} contrôle(s) réussi(s), ${echecs.length} échec(s).`);
  if (echecs.length > 0) {
    for (const e of echecs) console.log(`  - ${e}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Contrôle interrompu :", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
