/**
 * Examine un dossier de diligence raisonnée et dit, manque par manque, ce qui
 * l'empêche d'être déclaré « prêt à déclarer ».
 *
 * ⚠️ Pourquoi ce module existe (défaut C7 mesuré le 06/11/2026).
 *
 *   La route `PATCH /api/v1/due-diligence/[id]` n'avait qu'un filtre : la table
 *   `TRANSITIONS`. Un dossier créé par `POST` — `plotsCount: 0`,
 *   `completenessScore: 0`, aucune tâche, aucun fournisseur — pouvait donc
 *   passer `READY_FOR_DECLARATION` en un clic, et recevoir
 *   `completenessScore: 100` dans la même requête. Le produit enregistrait une
 *   affirmation de l'utilisateur ; il ne constatait rien.
 *
 * ⚠️ Fonction PURE, sans accès à la base.
 *
 *   Elle reçoit ce qu'on a lu et rend un verdict. Deux raisons, et la seconde
 *   est la plus importante :
 *     1. elle est éprouvable sans PostgreSQL, donc dans un contrôle de CI ;
 *     2. un verdict réglementaire qui dépendrait d'une requête ne pourrait pas
 *        être relu après coup. Ici, le même dossier et les mêmes données
 *        produisent toujours le même verdict — ce qui est la condition pour
 *        qu'une décision soit opposable.
 *
 * ⚠️ Ce module ne dit PAS si le produit peut être mis sur le marché. Il dit si
 *   le dossier est assez étayé pour que l'opérateur puisse le déclarer. La
 *   décision réglementaire reste la sienne ; le logiciel ne la prend pas.
 */
import { verifierOrigineExportable } from "./origine-exportable";
import type { StatutResolution } from "./resolution-pays";
import { EUDR_CUTOFF_DATE } from "./types";

/** Gravité d'un manque. Décide de l'ordre de lecture, jamais du verdict. */
export type Gravite = "bloquant" | "majeur" | "mineur";

export interface Manque {
  /** Code stable, pour qu'un test ou un écran puisse s'y accrocher. */
  code: string;
  gravite: Gravite;
  /** Constat, en clair, sans jargon. */
  detail: string;
  /** Ce qu'il faut faire pour le lever. */
  action: string;
}

/** Une parcelle rattachée au dossier, telle que lue en base. */
export interface ParcelleDuDossier {
  id: string;
  name: string;
  /** Statut de la parcelle : COMPLIANT, NON_COMPLIANT, INVALID_GEOMETRY, PENDING. */
  status: string;
  /** Code ISO du pays de production, `XX` quand il n'est pas établi. */
  countryCode: string;
  /** Statut de résolution du pays : RESOLU, CONFLIT, HORS_COUVERTURE. */
  countryStatut: string | null;
  /** Surface en hectares, telle que calculée à l'ingestion. */
  areaHa: number;
  /** Analyse satellite la plus récente, `null` si aucune. */
  derniereAnalyse: {
    /** Provenance : gfw-live, simulated, unavailable. */
    analysisSource: string;
    /** Vrai si l'analyse repose sur des données réelles et est exploitable. */
    analysisProbative: boolean;
    /** Statut de l'audit, dont INVALID_GEOMETRY. */
    status: string;
    /** Date de récolte au format ISO, `null` si non renseignée. */
    harvestDate: string | null;
  } | null;
  /** Pièces justificatives rattachées à cette parcelle. */
  documents: Array<{ id: string; category: string; status: string; expiryDate: string | null }>;
}

export interface DossierAExaminer {
  id: string;
  status: string;
  supplierId: string | null;
  productId: string | null;
  commodity: string;
  parcelles: ParcelleDuDossier[];
  /** Tâches d'atténuation du dossier. */
  taches: Array<{ id: string; status: string; severity: string }>;
}

export interface ExamenDossier {
  /** Vrai si et seulement si aucun manque bloquant ne subsiste. */
  complet: boolean;
  manques: Manque[];
  /** Score calculé, jamais reçu du client. 0 à 100. */
  score: number;
  /** Ce sur quoi le score a été calculé — pour que le chiffre soit explicable. */
  baseDeCalcul: {
    parcelles: number;
    surfaceHa: number;
    categoriesDePiece: string[];
  };
}

/**
 * Catégories de pièces sans lesquelles la légalité de la production ne peut pas
 * être établie (art. 10(2)(b) : « la production a-t-elle eu lieu en violation
 * des législations pertinentes du pays de production ? »).
 *
 * ⚠️ Cette liste est un PLANCHER, pas un barème. Un pays peut exiger d'autres
 * pièces ; le produit ne les connaît pas et ne doit pas prétendre le contraire.
 * Ce qu'il fait ici : refuser de considérer comme étayé un dossier qui ne
 * présente aucune pièce de légalité du tout.
 */
const CATEGORIES_LEGALITE = ["LAND_TENURE", "HARVEST_PERMIT", "TAX_CLEARANCE"] as const;

/** Une pièce est utilisable si elle est validée et non expirée. */
function pieceUtilisable(
  doc: { status: string; expiryDate: string | null },
  aujourdhui: string,
): boolean {
  if (doc.status !== "VALID") return false;
  // Pas de date d'expiration : la pièce reste utilisable. Une date passée, en
  // revanche, la rend caduque — et ce n'est pas un détail de forme : une
  // autorisation expirée ne couvre pas la production en cours.
  if (doc.expiryDate && doc.expiryDate < aujourdhui) return false;
  return true;
}

/**
 * Examine un dossier.
 *
 * @param dossier   Ce qui a été lu en base.
 * @param aujourdhui Date du jour au format ISO (YYYY-MM-DD). Injectée plutôt que
 *                   lue de l'horloge : un examen dont le résultat dépend du
 *                   moment où on l'exécute ne peut pas être rejoué à l'identique
 *                   lors d'un contrôle. C'est la même exigence que pour les
 *                   audit dont on relit la méthode des années plus tard.
 */
export function examinerDossier(dossier: DossierAExaminer, aujourdhui: string): ExamenDossier {
  const manques: Manque[] = [];
  const ajouter = (m: Manque): void => {
    manques.push(m);
  };

  /* --- 1. Le dossier a-t-il un objet ? ---------------------------------- */

  if (!dossier.supplierId && !dossier.productId) {
    ajouter({
      code: "SANS_OBJET",
      gravite: "bloquant",
      detail:
        "Le dossier n'est rattaché ni à un fournisseur ni à un produit : il ne porte sur aucune marchandise.",
      action: "Rattacher le dossier à un fournisseur ou à un produit avant de le soumettre.",
    });
  }

  if (dossier.parcelles.length === 0) {
    ajouter({
      code: "SANS_PARCELLE",
      gravite: "bloquant",
      detail:
        "Aucune parcelle n'est rattachée au dossier : la géolocalisation exigée par l'article 9(1)(d) n'existe pas.",
      action: "Rattacher les parcelles de production, avec leur polygone géolocalisé.",
    });
  }

  /* --- 2. Chaque parcelle est-elle géolocalisée et conforme ? ----------- */

  const parcellesGeometrieInvalide = dossier.parcelles.filter((p) => p.status === "INVALID_GEOMETRY");
  if (parcellesGeometrieInvalide.length > 0) {
    ajouter({
      code: "GEOMETRIE_INVALIDE",
      gravite: "bloquant",
      detail:
        `${parcellesGeometrieInvalide.length} parcelle(s) ont une géométrie invalide : ` +
        parcellesGeometrieInvalide.map((p) => p.name).join(", ") +
        ". Une géométrie invalide ne localise rien.",
      action: "Corriger le tracé de ces parcelles puis relancer l'analyse.",
    });
  }

  const parcellesNonConformes = dossier.parcelles.filter((p) => p.status === "NON_COMPLIANT");
  if (parcellesNonConformes.length > 0) {
    ajouter({
      code: "PARCELLE_NON_CONFORME",
      gravite: "bloquant",
      detail:
        `${parcellesNonConformes.length} parcelle(s) sont déclarées non conformes : ` +
        parcellesNonConformes.map((p) => p.name).join(", ") +
        `. Une déclaration ne peut pas couvrir une parcelle dont l'analyse a conclu à une déforestation après le ${EUDR_CUTOFF_DATE}.`,
      action:
        "Retirer ces parcelles du dossier, ou documenter une analyse contraire avant de le soumettre.",
    });
  }

  /* --- 3. L'analyse satellite est-elle probante ? ----------------------- */

  // ⚠️ C'est le contrôle qui empêche une simulation de démonstration d'entrer
  //   dans un dossier déclaré. L'export le faisait déjà (P0-04) ; le dossier,
  //   non. Une parcelle sans analyse est traitée comme une parcelle non
  //   analysée, pas comme une parcelle saine.
  const sansAnalyseProbante = dossier.parcelles.filter(
    (p) => p.status !== "INVALID_GEOMETRY" && (p.derniereAnalyse === null || !p.derniereAnalyse.analysisProbative),
  );
  if (sansAnalyseProbante.length > 0) {
    const simulees = sansAnalyseProbante.filter((p) => p.derniereAnalyse?.analysisSource === "simulated");
    const absentes = sansAnalyseProbante.length - simulees.length;
    ajouter({
      code: "ANALYSE_NON_PROBANTE",
      gravite: "bloquant",
      detail:
        `${sansAnalyseProbante.length} parcelle(s) n'ont pas d'analyse probante` +
        (simulees.length > 0 ? `, dont ${simulees.length} en simulation de démonstration` : "") +
        (absentes > 0 ? `, dont ${absentes} sans analyse disponible` : "") +
        ". Une simulation ou une absence d'analyse ne constitue pas une preuve d'absence de déforestation.",
      action:
        "Configurer un accès à une source satellite réelle puis relancer l'analyse sur ces parcelles.",
    });
  }

  /* --- 4. L'origine est-elle établie ? --------------------------------- */

  // ⚠️ Réutilise `verifierOrigineExportable` : le même verdict réglementaire ne
  //   doit pas exister en deux exemplaires, sinon les deux divergent un jour
  //   sans que personne ne s'en aperçoive.
  const originesNonEtablies = dossier.parcelles.filter((p) => {
    const verdict = verifierOrigineExportable((p.countryStatut as StatutResolution) ?? null, p.countryCode);
    return !verdict.exportable;
  });
  if (originesNonEtablies.length > 0) {
    ajouter({
      code: "ORIGINE_NON_ETABLIE",
      gravite: "bloquant",
      detail:
        `${originesNonEtablies.length} parcelle(s) n'ont pas d'origine établie : ` +
        originesNonEtablies.map((p) => p.name).join(", ") +
        ". Un pays de production inconnu rend la déclaration inclassable.",
      action:
        "Corriger la géolocalisation (le point doit tomber à l'intérieur d'un pays) puis relancer l'audit.",
    });
  }

  /* --- 5. La période de production est-elle établie ? ------------------ */

  // ⚠️ Art. 9(1)(f). C'est la condition qui rend la date butoir du 31/12/2020
  //   vérifiable : sans date de production, on ne sait pas de quelle période
  //   on parle. Le champ existe aujourd'hui sur l'audit (`harvest_date`), pas
  //   sur la parcelle ni sur le dossier — d'où la lecture par la dernière
  //   analyse. Un dossier dont la date manque n'est pas « probablement
  //   conforme » : il n'est pas instruisible.
  const sansDateProduction = dossier.parcelles.filter(
    (p) => p.status !== "INVALID_GEOMETRY" && !p.derniereAnalyse?.harvestDate,
  );
  if (sansDateProduction.length > 0) {
    ajouter({
      code: "PERIODE_PRODUCTION_ABSENTE",
      gravite: "bloquant",
      detail:
        `${sansDateProduction.length} parcelle(s) n'ont pas de date de production : ` +
        sansDateProduction.map((p) => p.name).join(", ") +
        `. Sans elle, la condition du ${EUDR_CUTOFF_DATE} (art. 9(1)(f)) n'est pas vérifiable.`,
      action: "Renseigner la date ou la période de récolte de ces parcelles.",
    });
  }

  const dateProductionFuture = dossier.parcelles.filter((p) => {
    const date = p.derniereAnalyse?.harvestDate;
    return Boolean(date) && date! > aujourdhui;
  });
  if (dateProductionFuture.length > 0) {
    ajouter({
      code: "PERIODE_PRODUCTION_FUTURE",
      gravite: "bloquant",
      detail:
        `${dateProductionFuture.length} parcelle(s) déclarent une production à venir : ` +
        dateProductionFuture.map((p) => p.name).join(", ") +
        ". Une marchandise non encore produite ne peut pas faire l'objet d'une déclaration.",
      action: "Corriger la date de récolte déclarée.",
    });
  }

  /* --- 6. La légalité est-elle étayée ? -------------------------------- */

  // ⚠️ On raisonne au niveau du DOSSIER et non de chaque parcelle : une
  //   autorisation d'exploitation couvre souvent plusieurs parcelles, et
  //   l'exiger parcelle par parcelle produirait des manques que l'utilisateur
  //   ne pourrait pas lever. Ce choix est consigné (D-005) plutôt que laissé
  //   dans le code.
  const piecesUtilisables = dossier.parcelles.flatMap((p) =>
    p.documents.filter((d) => pieceUtilisable(d, aujourdhui)),
  );
  const categoriesPresentes = new Set(piecesUtilisables.map((d) => d.category));
  const categoriesLegalitePresentes = CATEGORIES_LEGALITE.filter((c) => categoriesPresentes.has(c));

  if (categoriesLegalitePresentes.length === 0) {
    ajouter({
      code: "LEGALITE_NON_ETAYEE",
      gravite: "bloquant",
      detail:
        "Aucune pièce de légalité utilisable (foncier, autorisation de récolte, quittance fiscale) : " +
        "la légalité de la production ne peut pas être établie (art. 10(2)(b)).",
      action:
        "Déposer au moins une pièce de légalité validée et non expirée, rattachée à une parcelle du dossier.",
    });
  }

  /* --- 7. La déforestation et la dégradation ont-elles été évaluées ? --- */

  // ⚠️ Depuis C6d, `riskLevel` est nullable : « pas analysé » n'est pas
  //   « risque faible ». Un dossier dont une parcelle n'a pas de niveau de
  //   risque n'a pas été évalué, quel que soit le niveau du pays.
  const sansNiveauRisque = dossier.parcelles.filter(
    (p) => p.status !== "INVALID_GEOMETRY" && !p.derniereAnalyse?.analysisProbative,
  );
  if (sansNiveauRisque.length > 0 && sansAnalyseProbante.length === 0) {
    // Cas de bord : ne peut pas arriver aujourd'hui (les deux conditions
    // portent sur la même donnée), conservé pour que l'ajout futur d'un champ
    // de risque distinct ne rende pas ce contrôle silencieusement faux.
    ajouter({
      code: "RISQUE_NON_EVALUE",
      gravite: "bloquant",
      detail: `${sansNiveauRisque.length} parcelle(s) n'ont pas de niveau de risque établi.`,
      action: "Mener l'évaluation des risques sur ces parcelles.",
    });
  }

  /* --- 8. Les mesures d'atténuation sont-elles closes ? ---------------- */

  const tachesOuvertes = dossier.taches.filter((t) => t.status !== "RESOLVED" && t.status !== "VALIDATED");
  if (tachesOuvertes.length > 0) {
    ajouter({
      code: "ATTENUATION_INCOMPLETE",
      gravite: "bloquant",
      detail:
        `${tachesOuvertes.length} mesure(s) d'atténuation ne sont pas closes : ` +
        `${tachesOuvertes.filter((t) => t.severity === "HIGH" || t.severity === "CRITICAL").length} de gravité haute ou critique. ` +
        "Une déclaration ne peut pas être établie tant que les risques identifiés ne sont pas traités.",
      action: "Clore ou valider les mesures d'atténuation restantes.",
    });
  }

  /* --- Score calculé ---------------------------------------------------- */

  // ⚠️ Le score n'est PAS un pourcentage de manques levés : il serait alors
  //   possible d'atteindre 90 % avec le seul manque bloquant restant. Il est
  //   plafonné par la présence d'un manque bloquant, et ne sert qu'à ordonner
  //   le travail — jamais à décider.
  const bloquants = manques.filter((m) => m.gravite === "bloquant").length;
  const majeurs = manques.filter((m) => m.gravite === "majeur").length;
  const mineurs = manques.filter((m) => m.gravite === "mineur").length;
  const brut = 100 - (bloquants * 20 + majeurs * 10 + mineurs * 3);
  const score = bloquants > 0 ? Math.min(brut, 49) : Math.max(brut, 50);

  return {
    complet: bloquants === 0,
    manques,
    score: Math.max(0, Math.min(100, Math.round(score))),
    baseDeCalcul: {
      parcelles: dossier.parcelles.length,
      surfaceHa: Math.round(dossier.parcelles.reduce((s, p) => s + (Number.isFinite(p.areaHa) ? p.areaHa : 0), 0) * 100) / 100,
      categoriesDePiece: [...categoriesPresentes].sort(),
    },
  };
}

/** Catégories de légalité admises — exposées pour que le contrôle les vérifie. */
export const CATEGORIES_LEGALITE_EXPORTEES = CATEGORIES_LEGALITE;
