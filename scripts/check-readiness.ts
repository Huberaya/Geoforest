/**
 * Contrôles du moteur de readiness des dossiers DDS (src/lib/eudr/readiness.ts).
 *
 * Exécution : npm run test:unit   (ou : npx tsx --conditions=react-server scripts/check-readiness.ts)
 *
 * Ces contrôles verrouillent la recette du 2026-10-08 :
 *   - une analyse simulée ou indisponible n'est jamais un verdict de conformité ;
 *   - une déforestation établie bloque la déclaration ;
 *   - une pièce sans empreinte SHA-256 ou expirée n'est pas une preuve ;
 *   - « prêt pour déclaration » exige une revue humaine préalable ;
 *   - le niveau de risque est explicable, facteur par facteur.
 */
import {
  evaluerReadiness,
  pieceValide,
  type ReadinessAudit,
  type ReadinessDocument,
  type ReadinessInput,
} from "../src/lib/eudr/readiness";

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

const AUJOURDHUI = "2026-10-08";

const ANALYSE_PROBANTE: ReadinessAudit = {
  id: "a1",
  plotId: "p1",
  parcelReference: "PARC-1",
  status: "COMPLIANT",
  compliant: true,
  analysisProbative: true,
  analysisSource: "gfw-umd-loss-gain",
  countryRisk: "LOW",
  lossYear: null,
  areaHa: 12.5,
};

const PIECE_VALIDE: ReadinessDocument = {
  id: "d1",
  title: "Titre foncier",
  category: "LAND_TENURE",
  status: "VALID",
  supplierId: "s1",
  plotId: null,
  storageKey: "org/abc/d1",
  sha256: "a".repeat(64),
  expiryDate: null,
};

function dossierComplet(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    dossier: { status: "UNDER_REVIEW", supplierId: "s1", productId: "pr1", netWeightKg: 1000 },
    fournisseurPresent: true,
    produitPresent: true,
    analyses: [ANALYSE_PROBANTE],
    documents: [PIECE_VALIDE],
    aujourdhui: AUJOURDHUI,
    ...overrides,
  };
}

function main(): void {
  section("Dossier vide");
  const vide = evaluerReadiness({
    dossier: { status: "DRAFT", supplierId: null, productId: null, netWeightKg: 0 },
    fournisseurPresent: false,
    produitPresent: false,
    analyses: [],
    documents: [],
    aujourdhui: AUJOURDHUI,
  });
  check("un dossier vide n'est jamais READY", vide.etat === "INCOMPLETE", `état=${vide.etat}`);
  check("un dossier vide a une complétude < 100", vide.completude < 100, `${vide.completude} %`);
  check("aucune parcelle analysée est signalée", vide.manquants.some((m) => m.includes("Aucune analyse")));
  check("sans pays connu, le risque géographique est HIGH", vide.risque.facteurs.find((f) => f.facteur === "Risque géographique")?.niveau === "HIGH");
  check("le risque global d'un dossier vide est HIGH", vide.risque.niveau === "HIGH", vide.risque.niveau);

  section("Dossier complet, revue humaine requise");
  const complet = evaluerReadiness(dossierComplet());
  check("dossier complet en revue → READY_FOR_REVIEW", complet.etat === "READY_FOR_REVIEW", complet.etat);
  check("completude 100 % quand tout est satisfait", complet.completude === 100, `${complet.completude}`);
  check("aucun blocage", complet.blocages.length === 0);
  check("risque LOW quand toutes les preuves sont là", complet.risque.niveau === "LOW", complet.risque.niveau);
  check("l'explication n'annonce pas de déclaration effectuée", !/déclaré/i.test(complet.explication) && complet.explication.includes("Validation humaine"));

  section("Porte de sortie : validé = prêt pour déclaration");
  const valide = evaluerReadiness(dossierComplet({ dossier: { status: "READY_FOR_DECLARATION", supplierId: "s1", productId: "pr1", netWeightKg: 1000 } }));
  check("dossier complet validé → READY_FOR_DDS", valide.etat === "READY_FOR_DDS", valide.etat);
  check("l'explication précise qu'aucune transmission n'a eu lieu", valide.explication.includes("aucune transmission"));

  const brouillon = evaluerReadiness(dossierComplet({ dossier: { status: "DRAFT", supplierId: "s1", productId: "pr1", netWeightKg: 1000 } }));
  check("dossier complet en brouillon → COMPLETE (pas READY)", brouillon.etat === "COMPLETE", brouillon.etat);

  section("Analyse simulée : jamais un verdict");
  const simulee = evaluerReadiness(
    dossierComplet({
      analyses: [{ ...ANALYSE_PROBANTE, status: "SIMULATED_NON_PROBATIVE", compliant: null, analysisProbative: false, analysisSource: "simulated" }],
    }),
  );
  check("analyse simulée → BLOCKED", simulee.etat === "BLOCKED", simulee.etat);
  check("analyse simulée : l'analyse probante est nommée comme bloquante", simulee.blocages.some((b) => b.includes("simulée")));
  check("analyse simulée : risque de déforestation HIGH, pas LOW", simulee.risque.facteurs.find((f) => f.facteur === "Risque de déforestation")?.niveau === "HIGH");

  section("Analyse indisponible : UNKNOWN, jamais favorable");
  const indispo = evaluerReadiness(
    dossierComplet({
      analyses: [{ ...ANALYSE_PROBANTE, status: "ANALYSIS_UNAVAILABLE", compliant: null, analysisProbative: false, analysisSource: "unavailable" }],
    }),
  );
  check("analyse indisponible → BLOCKED", indispo.etat === "BLOCKED", indispo.etat);
  check("analyse indisponible : aucun mot « conforme » dans l'explication", !/\bconforme\b/i.test(indispo.explication));

  section("Déforestation établie");
  const deforeste = evaluerReadiness(
    dossierComplet({
      analyses: [{ ...ANALYSE_PROBANTE, status: "NON_COMPLIANT", compliant: false, lossYear: 2023 }],
    }),
  );
  check("déforestation post-2020 → BLOCKED", deforeste.etat === "BLOCKED", deforeste.etat);
  check("déforestation → risque CRITICAL", deforeste.risque.niveau === "CRITICAL", deforeste.risque.niveau);
  check("le blocage cite l'année de perte", deforeste.blocages.some((b) => b.includes("2023")));

  section("Géométrie invalide");
  const geo = evaluerReadiness(dossierComplet({ analyses: [{ ...ANALYSE_PROBANTE, status: "INVALID_GEOMETRY", compliant: null, analysisProbative: false, analysisSource: "unavailable" }] }));
  check("géométrie invalide : manquant, pas blocage satellite", geo.etat === "INCOMPLETE", geo.etat);
  check("géométrie invalide : dossier pas COMPLETE", geo.etat !== "COMPLETE" && geo.etat !== "READY_FOR_REVIEW");

  section("Pièces justificatives");
  check("pièce VALID avec empreinte et stockage : valide", pieceValide(PIECE_VALIDE, AUJOURDHUI));
  check("pièce sans empreinte SHA-256 : non valide", !pieceValide({ ...PIECE_VALIDE, sha256: null }, AUJOURDHUI));
  check("pièce sans stockage : non valide", !pieceValide({ ...PIECE_VALIDE, storageKey: null }, AUJOURDHUI));
  check("pièce PENDING : non valide", !pieceValide({ ...PIECE_VALIDE, status: "PENDING" }, AUJOURDHUI));
  check("pièce expirée hier : non valide", !pieceValide({ ...PIECE_VALIDE, expiryDate: "2026-10-07" }, AUJOURDHUI));
  check("pièce expirant aujourd'hui : encore valide", pieceValide({ ...PIECE_VALIDE, expiryDate: AUJOURDHUI }, AUJOURDHUI));

  const sansEmpreinte = evaluerReadiness(dossierComplet({ documents: [{ ...PIECE_VALIDE, sha256: null }] }));
  check("pièce sans empreinte : dossier INCOMPLETE", sansEmpreinte.etat === "INCOMPLETE", sansEmpreinte.etat);

  const expiree = evaluerReadiness(
    dossierComplet({ documents: [PIECE_VALIDE, { ...PIECE_VALIDE, id: "d2", title: "Permis d'exploitation", category: "HARVEST_PERMIT", expiryDate: "2026-01-01" }] }),
  );
  check("pièce obligatoire expirée → BLOCKED", expiree.etat === "BLOCKED", expiree.etat);
  check("le blocage porte le code DOCUMENT_EXPIRED", expiree.blocages.some((b) => b.includes("DOCUMENT_EXPIRED")));

  const autreFournisseur = evaluerReadiness(dossierComplet({ documents: [{ ...PIECE_VALIDE, supplierId: "autre" }] }));
  check("pièce d'un autre fournisseur ne compte pas", autreFournisseur.etat === "INCOMPLETE", autreFournisseur.etat);

  section("Fournisseur et produit");
  const sansFournisseur = evaluerReadiness(dossierComplet({ fournisseurPresent: false }));
  check("fournisseur absent → INCOMPLETE", sansFournisseur.etat === "INCOMPLETE", sansFournisseur.etat);
  const sansPoids = evaluerReadiness(dossierComplet({ dossier: { status: "UNDER_REVIEW", supplierId: "s1", productId: "pr1", netWeightKg: 0 } }));
  check("poids nul → INCOMPLETE", sansPoids.etat === "INCOMPLETE", sansPoids.etat);

  section("Explicabilité et déterminisme");
  check("chaque facteur a une raison non vide", complet.risque.facteurs.every((f) => f.raison.length > 0));
  check("le niveau global est le plus grave des facteurs", complet.risque.niveau === "LOW");
  const relance = evaluerReadiness(dossierComplet());
  check("calcul déterministe (mêmes entrées, même sortie)", JSON.stringify(relance) === JSON.stringify(complet));
  check("aucun contrôle n'est vide", complet.controles.every((c) => c.detail.length > 0));
  check("un contrôle satisfait n'a pas de gravité", complet.controles.every((c) => !c.ok || c.gravite === null));

  console.log(`\n${passed}/${passed + failures.length} contrôles réussis`);
  if (failures.length) {
    console.log("\nÉchecs :");
    for (const f of failures) console.log(`  🔴 ${f}`);
    process.exit(1);
  }
}

main();
