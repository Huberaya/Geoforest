/**
 * Contrôle du découplage entre risque PARCELLE et risque PAYS (C6d).
 *
 * ⚠️ Ce que ce contrôle verrouille.
 *
 *   Avant C6d, `risk_level` valait `country.risk` dans les trois fonctions
 *   d'analyse. Une parcelle ghanéenne dont l'analyse avait échoué sortait en
 *   « Risque parcelle : Faible » — parce que le Ghana est LOW au règlement
 *   d'exécution (UE) 2025/1093. L'interface affichait alors côte à côte
 *   « Risque pays : Faible » et « Risque parcelle : Faible », ce qui se lit
 *   comme deux confirmations indépendantes alors qu'il n'y en avait qu'une,
 *   recopiée.
 *
 *   Le règlement classe des PAYS. Il ne dit rien d'une parcelle. Le risque
 *   d'une parcelle dépend de ce qu'on a mesuré sur elle ; quand on n'a rien
 *   mesuré, il n'y a pas de niveau — il y a une absence.
 */
import { niveauRisqueParcelle, constatDepuisAnalyse, libelleNiveauParcelle } from "../src/lib/eudr/risque-parcelle";
import { checkDeforestationRisk, deterministicCheck } from "../src/lib/eudr/satellite-checker";
import type { RiskLevel, SupportedGeometry } from "../src/lib/eudr/types";

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

/* --- Table de décision --------------------------------------------------- */

console.log("\nTable de décision :");

// ⚠️ Le cas central : aucune analyse, aucun niveau. C'est précisément ce que
//   le code faisait de travers.
verifier(
  "analyse indisponible → aucun niveau de risque",
  niveauRisqueParcelle("NON_ANALYSEE", "LOW") === null,
  `obtenu : ${String(niveauRisqueParcelle("NON_ANALYSEE", "LOW"))}`,
);
verifier(
  "analyse indisponible dans un pays HIGH → toujours aucun niveau",
  niveauRisqueParcelle("NON_ANALYSEE", "HIGH") === null,
);
verifier("simulation → aucun niveau (P0-04 : un jeu d'essai ne conclut pas)", niveauRisqueParcelle("SIMULATION", "LOW") === null);

// Perte constatée : élevé, quelle que soit l'origine. Une parcelle déboisée
// après le 31/12/2020 n'est pas « à faible risque » parce que le pays est LOW.
verifier(
  "perte constatée dans un pays LOW → HIGH",
  niveauRisqueParcelle("PERTE_CONSTATEE", "LOW") === "HIGH",
);
verifier(
  "perte constatée dans un pays HIGH → HIGH",
  niveauRisqueParcelle("PERTE_CONSTATEE", "HIGH") === "HIGH",
);

// Aucune perte : on ne descend jamais sous le niveau du pays. L'article
// 10(2)(a) impose de tenir compte de la classification.
verifier(
  "aucune perte dans un pays LOW → STANDARD (pas LOW)",
  niveauRisqueParcelle("AUCUNE_PERTE", "LOW") === "STANDARD",
  `obtenu : ${String(niveauRisqueParcelle("AUCUNE_PERTE", "LOW"))}`,
);
verifier("aucune perte dans un pays STANDARD → STANDARD", niveauRisqueParcelle("AUCUNE_PERTE", "STANDARD") === "STANDARD");
verifier("aucune perte dans un pays HIGH → HIGH (on ne minore jamais)", niveauRisqueParcelle("AUCUNE_PERTE", "HIGH") === "HIGH");

// ⚠️ Le sens de l'erreur compte : le risque parcellaire ne doit JAMAIS être
//   inférieur au risque pays quand quelque chose a été mesuré.
const RANG: Record<RiskLevel, number> = { LOW: 0, STANDARD: 1, HIGH: 2, CRITICAL: 3 };
const minore = (["LOW", "STANDARD", "HIGH", "CRITICAL"] as RiskLevel[]).some((pays) => {
  const parcelle = niveauRisqueParcelle("AUCUNE_PERTE", pays);
  return parcelle !== null && RANG[parcelle] < RANG[pays];
});
verifier("le niveau parcellaire ne minore jamais le niveau pays", !minore);

/* --- Correspondance source d'analyse → constat --------------------------- */

console.log("\nCorrespondance analyse → constat :");
verifier("unavailable → NON_ANALYSEE", constatDepuisAnalyse("unavailable", null) === "NON_ANALYSEE");
verifier("simulated → SIMULATION", constatDepuisAnalyse("simulated", null) === "SIMULATION");
verifier("gfw-live non conforme → PERTE_CONSTATEE", constatDepuisAnalyse("gfw-live", false) === "PERTE_CONSTATEE");
verifier("gfw-live conforme → AUCUNE_PERTE", constatDepuisAnalyse("gfw-live", true) === "AUCUNE_PERTE");

/* --- Libellés ------------------------------------------------------------ */

console.log("\nLibellés :");
verifier("null s'affiche « Non établi »", libelleNiveauParcelle(null) === "Non établi");
verifier("LOW s'affiche « Faible »", libelleNiveauParcelle("LOW") === "Faible");

/* --- Intégration : le moteur de démonstration --------------------------- */

console.log("\nMoteur de démonstration :");
const geometrie: SupportedGeometry = {
  type: "Point",
  coordinates: [-0.19, 5.6], // Accra, Ghana — LOW à l'annexe
};
const demo = deterministicCheck(geometrie, "2024-06-01");
verifier("la démonstration ne rend aucun niveau parcellaire", demo.risk_level === null, `obtenu : ${String(demo.risk_level)}`);
verifier("le risque pays est conservé comme contexte", demo.country_risk === "LOW", `obtenu : ${String(demo.country_risk)}`);
verifier("le pays est bien résolu au Ghana", demo.country_code === "GH", demo.country_code);
verifier("le statut de résolution est transmis", demo.country_statut === "RESOLU", demo.country_statut);

/* --- Intégration : analyse indisponible -------------------------------- */

async function verifierAnalyseIndisponible(): Promise<void> {
  console.log("\nAnalyse indisponible :");
  // ⚠️ Environnement neutre, pas un paramètre de test : sans GFW_API_KEY et
  //   sans mode démonstration, la fonction prend RÉELLEMENT le chemin
  //   « indisponible ».
  delete process.env.GFW_API_KEY;
  delete process.env.EUDR_DEMO_MODE;
  const indispo = await checkDeforestationRisk(geometrie, "2024-06-01");
  verifier("aucun niveau parcellaire", indispo.risk_level === null, `obtenu : ${String(indispo.risk_level)}`);
  verifier("le risque pays reste consultable", typeof indispo.country_risk === "string");
  verifier(
    "aucun repli silencieux vers un verdict",
    indispo.compliant === null && indispo.is_probative === false,
  );
}

/* ------------------------------- Rapport -------------------------------- */

verifierAnalyseIndisponible().then(() => {
  console.log(`\n${ok}/${ok + echecs.length} contrôle(s) réussi(s)`);
  process.exit(echecs.length === 0 ? 0 : 1);
});
