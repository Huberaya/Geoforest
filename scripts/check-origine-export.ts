/**
 * Contrôle de l'exportabilité selon l'origine du produit (C6f).
 *
 * ⚠️ La question tranchée ici.
 *
 *   `country_code` et `country_benchmark_risk` sont des champs réglementaires
 *   de la déclaration. Jusqu'à C6f, un dossier dont le pays n'était pas résolu
 *   exportait une chaîne vide. Dans un dossier destiné à une autorité, une
 *   chaîne vide ne se lit pas « non résolu » — elle se lit « non renseigné par
 *   négligence ».
 *
 *   Et l'inverse est pire : une origine prise au hasard se lirait comme une
 *   affirmation. On n'exporte donc pas ce qu'on ne sait pas nommer.
 *
 * ⚠️ Ce contrôle teste la décision ET la sortie réelle : un dossier exportable
 *   dont le champ benchmark serait vide passerait la décision mais produirait
 *   un fichier inexploitable. Les deux sont vérifiés.
 */
import { verifierOrigineExportable } from "../src/lib/eudr/origine-exportable";
import { buildTracesXml, buildDdsPayload } from "../src/lib/eudr/traces-exporter";
import type { ParcelAuditRow } from "../src/db/schema";
import type { TracesOptions } from "../src/lib/eudr/traces-exporter";

let ok = 0;
const echecs: string[] = [];

function verifier(nom: string, condition: boolean, detail = ""): void {
  if (condition) {
    ok += 1;
    console.log(`  ✅ ${nom}`);
  } else {
    echecs.push(`${nom}${detail ? ` — ${detail}` : ""}`);
    console.log(`  🔴 ${nom}${detail ? ` — ${detail}` : ""}`);
  }
}

/* --- Décision : les cas de refus ----------------------------------------- */

console.log("\nRefus d'export :");

// ⚠️ `XX` est le code d'absence de pays. Il ne doit jamais être exporté comme
//   une origine : le SI EUDR le refuserait, et une autorité ne peut rien
//   instruire sur « pays inconnu ».
const xx = verifierOrigineExportable("HORS_COUVERTURE", "XX");
verifier("XX n'est pas exportable", xx.exportable === false);
verifier("le refus porte un code stable", !xx.exportable && xx.code === "ORIGINE_INDETERMINEE");
verifier("le refus dit quoi corriger", !xx.exportable && xx.action.length > 20);

const vide = verifierOrigineExportable("RESOLU", "");
verifier("un code pays vide n'est pas exportable", vide.exportable === false);

const sansStatut = verifierOrigineExportable(null, "XX");
verifier("un statut absent n'est pas exportable", sansStatut.exportable === false);

const conflit = verifierOrigineExportable("CONFLIT", "FR");
verifier("un conflit de frontière n'est pas exportable, même avec un code", conflit.exportable === false);
verifier(
  "le refus de conflit nomme la contestation",
  !conflit.exportable && /contest|plusieurs pays/i.test(conflit.detail),
);

const horsCouverture = verifierOrigineExportable("HORS_COUVERTURE", "FR");
verifier(
  "un point hors couverture n'est pas exportable, même avec un code",
  horsCouverture.exportable === false,
);

/* --- Décision : les cas d'acceptation ------------------------------------ */

console.log("\nAcceptation d'export :");
for (const [pays, statut] of [
  ["GH", "RESOLU"],
  ["BR", "RESOLU"],
  ["FR", "RESOLU"],
] as const) {
  verifier(`${pays} (${statut}) est exportable`, verifierOrigineExportable(statut, pays).exportable === true);
}

// Tolérance de casse : un code venu de la base peut être en minuscules.
verifier("un code en minuscules est accepté", verifierOrigineExportable("RESOLU", "gh").exportable === true);

/* --- Sortie réelle ------------------------------------------------------- */

console.log("\nSortie du fichier :");

const options: TracesOptions = {
  activityType: "IMPORT",
  netWeightKg: 1000,
  internalReference: null,
  countryOfActivity: "FR",
};

function ligne(pays: string, statut: string, benchmark: string): ParcelAuditRow {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: new Date("2026-03-01T10:00:00Z"),
    operatorName: "Coopérative Test",
    operatorEori: "FR123456789",
    operatorCountry: "FR",
    operatorAddress: "1 rue de Test, Nantes",
    commodity: "cocoa",
    hsCode: "1801",
    harvestDate: "2024-11-15",
    geometry: { type: "Point", coordinates: [-0.19, 5.6] },
    geometryType: "Point",
    areaHa: 2.5,
    centroidLon: -0.19,
    centroidLat: 5.6,
    countryCode: pays,
    countryRisk: benchmark,
    countryStatut: statut,
    compliant: true,
    lossYear: null,
    confidenceScore: 0.95,
    analysisSource: "gfw-live",
    analysisProbative: true,
    analysisMethod: "gfw-live",
    analysisVersion: "v1",
    riskLevel: "STANDARD",
    satellite: { source: "gfw-live" },
    producerName: "Producteur Test",
    producerCountry: pays,
    parcelReference: "PAR-001",
    status: "COMPLIANT",
  };
  return base as unknown as ParcelAuditRow;
}

const ghana = ligne("GH", "RESOLU", "LOW");
const xml = buildTracesXml(ghana, { name: "Coopérative Test", eori: "FR123456789", country: "FR", address: "", email: "" }, options);

verifier("le XML est produit", xml.includes("eudr:SubmitStatementRequest") && xml.includes("</eudr:SubmitStatementRequest>"), xml.slice(0, 80));
verifier("country_benchmark_risk est renseigné", xml.includes("LOW"), "");
verifier(
  "aucun champ réglementaire n'est vide dans la vérification",
  !/<gft:countryBenchmarkRisk>\s*<\/gft:countryBenchmarkRisk>/.test(xml),
);

const payload = buildDdsPayload(ghana, { name: "Coopérative Test", eori: "FR123456789", country: "FR", address: "", email: "" }, options);
const verification = payload.verification as Record<string, unknown>;
verifier("le payload JSON porte le benchmark pays", verification.country_benchmark_risk === "LOW", String(verification.country_benchmark_risk));

// Un pays HIGH doit ressortir HIGH : le référentiel doit traverser l'export.
const russie = ligne("RU", "RESOLU", "HIGH");
const xmlRu = buildTracesXml(russie, { name: "Coopérative Test", eori: "FR123456789", country: "FR", address: "", email: "" }, options);
verifier("un pays HIGH est exporté HIGH", xmlRu.includes("HIGH"));

/* ------------------------------- Rapport -------------------------------- */

console.log(`\n${ok}/${ok + echecs.length} contrôle(s) réussi(s)`);
process.exit(echecs.length === 0 ? 0 : 1);
