/**
 * Machine d'état des dossiers DDS (src/lib/eudr/dds-etats.ts) — chantier 3, B-12.
 *
 * Exécution : npm run test:unit   (ou : npx tsx scripts/check-dds-etats.ts)
 *
 * Verrouille les règles de la machine d'état, indépendamment de la base :
 *   - SUBMITTED et DECLARED ne sont atteignables par aucune action ;
 *   - EXPORTED ne se pose que par l'export d'un dossier READY_FOR_DECLARATION ;
 *   - un dossier figé refuse toute modification de ses données ;
 *   - la readiness lit « prêt » pour un dossier exporté, sans le rétrograder.
 * Le parcours HTTP complet (export réel, refus, cloisonnement) est dans
 * scripts/check-dds-etats-http.ts.
 */
import { evaluerReadiness, type ReadinessInput } from "../src/lib/eudr/readiness";
import {
  ETATS_ACTION_SEULE,
  ETATS_FIGES,
  TRANSITION_EXPORT,
  TRANSITIONS,
  estFige,
  verifierTransitionManuelle,
} from "../src/lib/eudr/dds-etats";
import { DDS_STATUSES, DDS_STATUS_LABELS, type DdsStatus } from "../src/lib/eudr/types";

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

function section(titre: string): void {
  console.log(`\n##### ${titre} #####`);
}

const AUJOURDHUI = "2026-10-14";
const ANALYSE_PROBANTE = {
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
const PIECE_VALIDE = {
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

function dossierComplet(statut: DdsStatus): ReadinessInput {
  return {
    dossier: { status: statut, supplierId: "s1", productId: "pr1", netWeightKg: 1000 },
    fournisseurPresent: true,
    produitPresent: true,
    analyses: [ANALYSE_PROBANTE],
    documents: [PIECE_VALIDE],
    aujourdhui: AUJOURDHUI,
  };
}

function main(): void {
  section("Table des transitions");
  check(
    "chaque statut connu a une entrée de transition",
    DDS_STATUSES.every((s) => Array.isArray(TRANSITIONS[s])),
  );
  const cibles = new Set(Object.values(TRANSITIONS).flat());
  check(
    "aucune transition manuelle ne cible EXPORTED, SUBMITTED ou DECLARED",
    ETATS_ACTION_SEULE.every((s) => !cibles.has(s)),
    [...ETATS_ACTION_SEULE].filter((s) => cibles.has(s)).join(", ") || "aucune cible",
  );
  check(
    "SUBMITTED et DECLARED sont des états terminaux (sortie : ARCHIVED seul)",
    TRANSITIONS.SUBMITTED.join() === "ARCHIVED" && TRANSITIONS.DECLARED.join() === "ARCHIVED",
  );
  check("EXPORTED est un état de sortie : UNDER_REVIEW ou ARCHIVED", TRANSITIONS.EXPORTED.join() === "UNDER_REVIEW,ARCHIVED");

  section("Refus des cibles réservées, depuis chaque état");
  let refusDeRefus = 0;
  for (const de of DDS_STATUSES) {
    for (const vers of ETATS_ACTION_SEULE) {
      const v = verifierTransitionManuelle(de, vers);
      if (v.admise) refusDeRefus += 1;
    }
  }
  check(
    "aucun état source ne mène à EXPORTED, SUBMITTED ou DECLARED par PATCH",
    refusDeRefus === 0,
    `${DDS_STATUSES.length * ETATS_ACTION_SEULE.length} couples testés, ${refusDeRefus} admis`,
  );
  const sub = verifierTransitionManuelle("UNDER_REVIEW", "SUBMITTED");
  check("SUBMITTED refusé avec un motif qui le nomme", !sub.admise && sub.motif.includes("SUBMITTED"));
  const dec = verifierTransitionManuelle("READY_FOR_DECLARATION", "DECLARED");
  check("DECLARED refusé avec un motif qui le nomme", !dec.admise && dec.motif.includes("DECLARED"));
  const exp = verifierTransitionManuelle("READY_FOR_DECLARATION", "EXPORTED");
  check(
    "EXPORTED refusé en PATCH, même depuis READY_FOR_DECLARATION (seule l'export le pose)",
    !exp.admise && exp.motif.includes("export"),
  );

  section("Export : seule transition vers EXPORTED");
  check("TRANSITION_EXPORT = READY_FOR_DECLARATION → EXPORTED", TRANSITION_EXPORT.de === "READY_FOR_DECLARATION" && TRANSITION_EXPORT.vers === "EXPORTED");
  check("EXPORTED figé", estFige("EXPORTED"));
  const depuisBrouillon = verifierTransitionManuelle("DRAFT", "READY_FOR_DECLARATION");
  check("DRAFT → READY_FOR_DECLARATION refusé (passage par la revue exigé)", !depuisBrouillon.admise);

  section("Enchaînements admis");
  check("UNDER_REVIEW → READY_FOR_DECLARATION admis", verifierTransitionManuelle("UNDER_REVIEW", "READY_FOR_DECLARATION").admise);
  check("EXPORTED → UNDER_REVIEW admis (export périmé, nouvelle revue)", verifierTransitionManuelle("EXPORTED", "UNDER_REVIEW").admise);
  check("READY_FOR_DECLARATION → UNDER_REVIEW admis", verifierTransitionManuelle("READY_FOR_DECLARATION", "UNDER_REVIEW").admise);
  check("ARCHIVED → DRAFT admis (comportement existant)", verifierTransitionManuelle("ARCHIVED", "DRAFT").admise);
  check("DRAFT → EXPORTED refusé", !verifierTransitionManuelle("DRAFT", "EXPORTED").admise);

  section("Dossier figé");
  check("les quatre états figés sont exactement ceux prévus", ETATS_FIGES.join() === "READY_FOR_DECLARATION,EXPORTED,SUBMITTED,DECLARED");
  check("UNDER_REVIEW n'est pas figé", !estFige("UNDER_REVIEW"));
  check("DRAFT n'est pas figé", !estFige("DRAFT"));

  section("Readiness cohérente avec l'état");
  check(
    "dossier complet EXPORTED → READY_FOR_DDS (et non COMPLETE)",
    evaluerReadiness(dossierComplet("EXPORTED")).etat === "READY_FOR_DDS",
    evaluerReadiness(dossierComplet("EXPORTED")).etat,
  );
  check(
    "dossier complet READY_FOR_DECLARATION → READY_FOR_DDS",
    evaluerReadiness(dossierComplet("READY_FOR_DECLARATION")).etat === "READY_FOR_DDS",
  );
  check(
    "dossier complet UNDER_REVIEW → READY_FOR_REVIEW (inchangé)",
    evaluerReadiness(dossierComplet("UNDER_REVIEW")).etat === "READY_FOR_REVIEW",
  );
  check(
    "un dossier EXPORTED qui perd sa pièce n'est plus READY_FOR_DDS",
    evaluerReadiness({ ...dossierComplet("EXPORTED"), documents: [] }).etat !== "READY_FOR_DDS",
    evaluerReadiness({ ...dossierComplet("EXPORTED"), documents: [] }).etat,
  );

  section("Libellés");
  check(
    "SUBMITTED et DECLARED se disent « non disponible », jamais « soumis » ou « déclaré » seuls",
    DDS_STATUS_LABELS.SUBMITTED.includes("non disponible") && DDS_STATUS_LABELS.DECLARED.includes("non disponible"),
  );
  check("EXPORTED se dit « non transmis »", DDS_STATUS_LABELS.EXPORTED.includes("non transmis"));

  console.log(`\n${passed} contrôles réussis, ${failures.length} échec(s).`);
  if (failures.length > 0) {
    console.log("Échecs :");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main();
