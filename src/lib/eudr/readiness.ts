/**
 * Moteur de readiness d'un dossier de diligence raisonnée (DDS).
 *
 * ⚠️ Pourquoi ce module existe (recette du 2026-10-08).
 *
 * Avant ce module, la route de dossier acceptait n'importe quel statut — y
 * compris `READY_FOR_DECLARATION` — et des valeurs de risque et de complétude
 * saisies à la main, sans qu'aucune parcelle, aucune analyse ni aucune pièce
 * ne soit rattachée au dossier. Un dossier vide pouvait donc être présenté
 * comme prêt. C'est une fausse conformité par construction.
 *
 * Ce module ne fait qu'un calcul, sans accès à la base : il reçoit les faits
 * (analyses rattachées, pièces, fournisseur, produit) et rend un verdict
 * EXPLIQUÉ. Chaque blocage et chaque manque est nommé, et le risque est
 * décomposé par facteur — jamais un score opaque.
 *
 * États possibles :
 *   · BLOCKED           — un blocage établi (déforestation, analyse non probante,
 *                         pièce obligatoire expirée). Rien ne peut être déclaré.
 *   · INCOMPLETE        — des données obligatoires manquent. Rien de bloquant
 *                         en revanche : le dossier se complète.
 *   · COMPLETE          — toutes les données sont là, aucun blocage ; le dossier
 *                         n'a pas encore été soumis à revue humaine.
 *   · READY_FOR_REVIEW  — COMPLETE et dossier en revue (UNDER_REVIEW).
 *   · READY_FOR_DDS     — COMPLETE et dossier validé (READY_FOR_DECLARATION).
 *
 * « READY_FOR_DDS » ne signifie PAS « déclaré » : aucune transmission au système
 * d'information EUDR n'existe dans ce produit (cf. P0-06).
 */

export type ReadinessState = "BLOCKED" | "INCOMPLETE" | "COMPLETE" | "READY_FOR_REVIEW" | "READY_FOR_DDS";
export type RiskTier = "LOW" | "STANDARD" | "HIGH" | "CRITICAL";

/** Catégories de pièces tenues pour obligatoires : leur expiration bloque le dossier. */
export const CATEGORIES_OBLIGATOIRES = ["LAND_TENURE", "HARVEST_PERMIT"] as const;

export interface ReadinessAudit {
  id: string;
  plotId: string | null;
  parcelReference: string | null;
  status: string;
  compliant: boolean | null;
  analysisProbative: boolean;
  analysisSource: string;
  countryRisk: string;
  lossYear: number | null;
  areaHa: number;
}

export interface ReadinessDocument {
  id: string;
  title: string;
  category: string;
  status: string;
  supplierId: string | null;
  plotId: string | null;
  storageKey: string | null;
  sha256: string | null;
  expiryDate: string | null;
}

export interface ReadinessInput {
  dossier: {
    status: string;
    supplierId: string | null;
    productId: string | null;
    netWeightKg: number;
  };
  /** Fournisseur rattaché au dossier, s'il existe (vérifié côté base). */
  fournisseurPresent: boolean;
  produitPresent: boolean;
  analyses: ReadinessAudit[];
  documents: ReadinessDocument[];
  /** Date de référence, AAAA-MM-JJ. Injectée pour rendre le calcul reproductible. */
  aujourdhui: string;
}

export interface ReadinessCheck {
  code: string;
  libelle: string;
  ok: boolean;
  /** BLOCAGE : empêche la déclaration. MANQUANT : donnée à compléter. Null si satisfait. */
  gravite: "BLOCAGE" | "MANQUANT" | null;
  detail: string;
}

export interface RiskFactor {
  facteur: string;
  niveau: RiskTier | "INCONNU";
  raison: string;
}

export interface ReadinessResult {
  etat: ReadinessState;
  controles: ReadinessCheck[];
  blocages: string[];
  manquants: string[];
  /** Score de complétude : part des contrôles satisfaits, de 0 à 100. */
  completude: number;
  risque: { niveau: RiskTier; facteurs: RiskFactor[] };
  explication: string;
}

const ORDRE_RISQUE: Record<RiskTier, number> = { LOW: 0, STANDARD: 1, HIGH: 2, CRITICAL: 3 };

function plusGrave(a: RiskTier, b: RiskTier): RiskTier {
  return ORDRE_RISQUE[a] >= ORDRE_RISQUE[b] ? a : b;
}

/** Vrai si la pièce est exploitable comme preuve : déposée, condensat calculé, validée, non expirée. */
export function pieceValide(doc: ReadinessDocument, aujourdhui: string): boolean {
  if (doc.status !== "VALID") return false;
  if (!doc.storageKey || !doc.sha256) return false;
  if (doc.expiryDate && doc.expiryDate < aujourdhui) return false;
  return true;
}

/** Calcule l'état de readiness et le risque expliqué d'un dossier. Pur : aucun accès externe. */
export function evaluerReadiness(input: ReadinessInput): ReadinessResult {
  const { dossier, analyses, documents, aujourdhui } = input;
  const controles: ReadinessCheck[] = [];

  const ajouter = (c: ReadinessCheck) => controles.push(c);

  // 1. Fournisseur.
  ajouter({
    code: "fournisseur",
    libelle: "Fournisseur rattaché au dossier",
    ok: input.fournisseurPresent,
    gravite: input.fournisseurPresent ? null : "MANQUANT",
    detail: input.fournisseurPresent ? "Fournisseur présent." : "Aucun fournisseur rattaché.",
  });

  // 2. Produit.
  ajouter({
    code: "produit",
    libelle: "Produit / matière première rattaché",
    ok: input.produitPresent,
    gravite: input.produitPresent ? null : "MANQUANT",
    detail: input.produitPresent ? "Produit présent." : "Aucun produit rattaché.",
  });

  // 3. Poids net.
  const poidsOk = Number.isFinite(dossier.netWeightKg) && dossier.netWeightKg > 0;
  ajouter({
    code: "poids_net",
    libelle: "Poids net de la marchandise",
    ok: poidsOk,
    gravite: poidsOk ? null : "MANQUANT",
    detail: poidsOk ? `${dossier.netWeightKg} kg.` : "Poids net non renseigné.",
  });

  // 4. Au moins une parcelle analysée.
  const parcellesOk = analyses.length > 0;
  ajouter({
    code: "parcelles_analysees",
    libelle: "Parcelles analysées rattachées au dossier",
    ok: parcellesOk,
    gravite: parcellesOk ? null : "MANQUANT",
    detail: parcellesOk
      ? `${analyses.length} analyse(s) rattachée(s).`
      : "Aucune analyse satellite rattachée : lancez l'audit de chaque parcelle puis rattachez-le.",
  });

  // 5. Géométrie exploitable.
  const invalides = analyses.filter((a) => a.status === "INVALID_GEOMETRY");
  ajouter({
    code: "geometries",
    libelle: "Géométrie des parcelles valide",
    ok: invalides.length === 0,
    gravite: invalides.length === 0 ? null : "MANQUANT",
    detail:
      invalides.length === 0
        ? "Toutes les géométries sont valides."
        : `Géométrie invalide : ${invalides.map((a) => a.parcelReference ?? a.id).join(", ")}.`,
  });

  // 6. Analyses probantes. Une analyse non probante (indisponible, simulée) n'est
  //    pas un verdict : elle bloque la déclaration tant qu'elle n'est pas refaite.
  const nonProbantes = analyses.filter((a) => a.status !== "INVALID_GEOMETRY" && !a.analysisProbative);
  ajouter({
    code: "analyses_probantes",
    libelle: "Analyses satellites probantes",
    ok: nonProbantes.length === 0,
    gravite: nonProbantes.length === 0 ? null : "BLOCAGE",
    detail:
      nonProbantes.length === 0
        ? "Toutes les analyses reposent sur des données réelles."
        : `Analyse non probante (${nonProbantes
            .map((a) => `${a.parcelReference ?? a.id} : ${a.analysisSource === "simulated" ? "simulée" : "indisponible"}`)
            .join(", ")}). Aucun verdict : relancer l'analyse avec une source satellite officielle.`,
  });

  // 7. Déforestation établie.
  const nonConformes = analyses.filter((a) => a.compliant === false || a.status === "NON_COMPLIANT");
  ajouter({
    code: "deforestation",
    libelle: "Aucune déforestation post-31/12/2020",
    ok: nonConformes.length === 0,
    gravite: nonConformes.length === 0 ? null : "BLOCAGE",
    detail:
      nonConformes.length === 0
        ? "Aucune perte de couvert détectée après la date butoir."
        : `Déforestation post-2020 établie : ${nonConformes
            .map((a) => `${a.parcelReference ?? a.id}${a.lossYear ? ` (${a.lossYear})` : ""}`)
            .join(", ")}. Dossier non déclarable en l'état.`,
  });

  // 8. Pièces de conformité : au moins une pièce valide, liée au fournisseur ou aux parcelles.
  const plotIds = new Set(analyses.map((a) => a.plotId).filter((x): x is string => Boolean(x)));
  const liees = documents.filter(
    (d) => (input.dossier.supplierId && d.supplierId === input.dossier.supplierId) || (d.plotId && plotIds.has(d.plotId)),
  );
  const valides = liees.filter((d) => pieceValide(d, aujourdhui));
  ajouter({
    code: "pieces_valides",
    libelle: "Pièce justificative valide (déposée, condensat calculé, validée)",
    ok: valides.length > 0,
    gravite: valides.length > 0 ? null : "MANQUANT",
    detail:
      valides.length > 0
        ? `${valides.length} pièce(s) valide(s).`
        : liees.length === 0
          ? "Aucune pièce rattachée au fournisseur ni aux parcelles."
          : "Aucune pièce n'est à la fois déposée, condensée, validée et non expirée.",
  });

  // 9. Pièces obligatoires expirées : bloquant.
  const expirees = liees.filter(
    (d) =>
      (CATEGORIES_OBLIGATOIRES as readonly string[]).includes(d.category) &&
      d.status !== "REJECTED" &&
      Boolean(d.expiryDate) &&
      (d.expiryDate as string) < aujourdhui,
  );
  ajouter({
    code: "pieces_expirees",
    libelle: "Pièces obligatoires non expirées",
    ok: expirees.length === 0,
    gravite: expirees.length === 0 ? null : "BLOCAGE",
    detail:
      expirees.length === 0
        ? "Aucune pièce obligatoire expirée."
        : `DOCUMENT_EXPIRED : ${expirees.map((d) => `« ${d.title} » (échéance ${d.expiryDate})`).join(", ")}.`,
  });

  // ---------------------------------------------------------------- État
  const blocages = controles.filter((c) => c.gravite === "BLOCAGE").map((c) => c.detail);
  const manquants = controles.filter((c) => c.gravite === "MANQUANT").map((c) => c.detail);
  const satisfaits = controles.filter((c) => c.ok).length;
  const completude = Math.round((satisfaits / controles.length) * 100);

  let etat: ReadinessState;
  if (blocages.length > 0) etat = "BLOCKED";
  else if (manquants.length > 0) etat = "INCOMPLETE";
  else if (dossier.status === "READY_FOR_DECLARATION") etat = "READY_FOR_DDS";
  else if (dossier.status === "UNDER_REVIEW") etat = "READY_FOR_REVIEW";
  else etat = "COMPLETE";

  // ---------------------------------------------------------------- Risque
  const facteurs: RiskFactor[] = [];

  // Risque géographique : benchmark pays de la parcelle la plus exposée.
  const pays = analyses.map((a) => a.countryRisk);
  const geo: RiskTier = pays.includes("HIGH") ? "HIGH" : pays.includes("STANDARD") ? "STANDARD" : pays.length ? "LOW" : "HIGH";
  facteurs.push({
    facteur: "Risque géographique",
    niveau: geo,
    raison: pays.length === 0
      ? "Aucune parcelle rattachée : pays inconnu, traité comme risque élevé."
      : `Benchmark pays le plus exposé du dossier : ${geo}.`,
  });

  // Risque de déforestation : établi, inconnu, ou absent.
  let deforestation: RiskTier | "INCONNU";
  let raisonDef: string;
  if (nonConformes.length > 0) {
    deforestation = "CRITICAL";
    raisonDef = `Perte de couvert post-2020 détectée sur ${nonConformes.length} parcelle(s).`;
  } else if (nonProbantes.length > 0 || analyses.length === 0) {
    deforestation = "HIGH";
    raisonDef = "Aucun verdict satellite probant : le risque n'est pas établi comme faible.";
  } else {
    deforestation = "LOW";
    raisonDef = "Analyses probantes, aucune perte post-2020 détectée.";
  }
  facteurs.push({ facteur: "Risque de déforestation", niveau: deforestation, raison: raisonDef });

  // Risque documentaire.
  const documentaire: RiskTier = expirees.length > 0 ? "HIGH" : valides.length > 0 ? "LOW" : "HIGH";
  facteurs.push({
    facteur: "Risque documentaire",
    niveau: documentaire,
    raison:
      expirees.length > 0
        ? "Pièce obligatoire expirée."
        : valides.length > 0
          ? "Pièce valide présente."
          : "Aucune pièce valide : légalité non démontrée.",
  });

  // Traçabilité : géométrie et rattachement.
  const tracabilite: RiskTier = invalides.length > 0 ? "HIGH" : analyses.length === 0 ? "HIGH" : "LOW";
  facteurs.push({
    facteur: "Risque de traçabilité",
    niveau: tracabilite,
    raison:
      invalides.length > 0
        ? "Au moins une géométrie est invalide."
        : analyses.length === 0
          ? "Aucune parcelle rattachée : origine non démontrée."
          : "Géométries valides et rattachées.",
  });

  // Complétude des données.
  facteurs.push({
    facteur: "Complétude des données",
    niveau: completude === 100 ? "LOW" : completude >= 60 ? "STANDARD" : "HIGH",
    raison: `${satisfaits}/${controles.length} contrôle(s) satisfait(s).`,
  });

  const niveau = facteurs.reduce<RiskTier>(
    (acc, f) => (f.niveau === "INCONNU" ? acc : plusGrave(acc, f.niveau)),
    "LOW",
  );

  const explication = expliquer(etat, niveau, blocages, manquants);

  return {
    etat,
    controles,
    blocages,
    manquants,
    completude,
    risque: { niveau, facteurs },
    explication,
  };
}

function expliquer(etat: ReadinessState, niveau: RiskTier, blocages: string[], manquants: string[]): string {
  switch (etat) {
    case "BLOCKED":
      return `Dossier bloqué (risque ${niveau}). ${blocages.join(" ")}`;
    case "INCOMPLETE":
      return `Dossier incomplet (risque ${niveau}). À compléter : ${manquants.join(" ")}`;
    case "COMPLETE":
      return `Dossier complet, aucun blocage (risque ${niveau}). Soumettre à revue humaine avant toute déclaration.`;
    case "READY_FOR_REVIEW":
      return `Dossier complet en revue (risque ${niveau}). Validation humaine requise pour passer à « prêt pour déclaration ».`;
    case "READY_FOR_DDS":
      return `Dossier validé et complet (risque ${niveau}). Préparé pour soumission officielle — aucune transmission n'a été effectuée.`;
  }
}
