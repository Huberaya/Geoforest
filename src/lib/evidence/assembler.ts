import "server-only";

import { and, desc, eq, inArray, or } from "drizzle-orm";

import { auditLogs, dueDiligenceStatements, parcelAudits, products, suppliers } from "@/db/schema";
import type { TenantTx } from "@/lib/tenant";
import { stockageCourant } from "@/lib/storage";
import { chargerDossier, lireDocumentsDuDossier } from "@/lib/eudr/readiness-db";
import { FORMAT_PACK, NOM_LISEZMOI, NOM_MANIFESTE, PREFIXE_PIECES, sha256Hex, type FichierPack } from "@/lib/evidence/pack";

/**
 * Assemblage du pack de preuves d'un dossier (B-10, chantier 4).
 *
 * ⚠️ Règle centrale : une pièce **déclarée** dont le fichier est absent du support, ou
 *   dont le contenu ne correspond plus à l'empreinte déposée, fait échouer le pack.
 *   On ne l'exporte pas en silence, et on ne la remplace pas par une mention « absent » :
 *   c'est un incident d'exploitation, qu'il faut traiter avant de produire une preuve.
 *   À l'inverse, une pièce **jamais déposée** (aucun fichier) n'est pas un incident : elle
 *   figure dans le pack comme manquante, parce que c'est un fait du dossier.
 */

export class IncidentPack extends Error {
  constructor(
    message: string,
    readonly piece: string,
  ) {
    super(message);
    this.name = "IncidentPack";
  }
}

export interface Acteur {
  id: string;
  role: string;
  email: string;
}

export interface PackAssemble {
  fichiers: FichierPack[];
  resume: {
    pieces: number;
    piecesSansFichier: number;
    analyses: number;
    entreesJournal: number;
  };
}

function nettoyerNom(nom: string): string {
  return nom.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^\.+/, "").slice(0, 150) || "piece";
}

const encoder = new TextEncoder();
const json = (valeur: unknown): Uint8Array => encoder.encode(`${JSON.stringify(valeur, null, 2)}\n`);

export async function assemblerPack(
  tx: TenantTx,
  organizationId: string,
  ddsId: string,
  aujourdhui: string,
  acteur: Acteur,
): Promise<PackAssemble | null> {
  const charge = await chargerDossier(tx, organizationId, ddsId, aujourdhui);
  if (!charge) return null;
  const dds = charge.dds;

  const [fournisseur] = dds.supplierId
    ? await tx
        .select({ name: suppliers.name, eori: suppliers.eori, country: suppliers.country })
        .from(suppliers)
        .where(and(eq(suppliers.id, dds.supplierId), eq(suppliers.organizationId, organizationId)))
        .limit(1)
    : [undefined];
  const [produit] = dds.productId
    ? await tx
        .select({ name: products.name, commodity: products.commodity, hsCode: products.hsCode })
        .from(products)
        .where(and(eq(products.id, dds.productId), eq(products.organizationId, organizationId)))
        .limit(1)
    : [undefined];

  const analyses = await tx
    .select()
    .from(parcelAudits)
    .where(and(eq(parcelAudits.organizationId, organizationId), eq(parcelAudits.dueDiligenceId, ddsId)));
  const plotIds = analyses.map((a) => a.plotId).filter((x): x is string => Boolean(x));

  const documents = await lireDocumentsDuDossier(tx, organizationId, dds.supplierId, plotIds);

  // ----------------------------------------------------------------- Pièces
  const fichiers: FichierPack[] = [];
  const pieces: Record<string, unknown>[] = [];
  for (const d of documents) {
    if (!d.storageKey || !d.sha256) {
      pieces.push({
        document_id: d.id,
        titre: d.title,
        categorie: d.category,
        statut: d.status,
        scan_status: d.scanStatus,
        date_expiration: d.expiryDate,
        version: d.version,
        fichier: null,
        sha256: null,
        taille: null,
        type_reel: null,
        sans_fichier: true,
      });
      continue;
    }
    const contenu = await stockageCourant().lire(d.storageKey);
    if (contenu === null) {
      throw new IncidentPack(
        "Pack refusé : une pièce est déclarée en base mais absente du support. Incident à traiter avant tout export de preuve.",
        d.id,
      );
    }
    if (sha256Hex(contenu) !== d.sha256) {
      throw new IncidentPack(
        "Pack refusé : le contenu d'une pièce ne correspond plus à l'empreinte déposée. Incident à traiter, la pièce n'est pas exportée.",
        d.id,
      );
    }
    if (d.sizeBytes !== null && d.sizeBytes !== contenu.byteLength) {
      throw new IncidentPack("Pack refusé : taille d'une pièce différente de la taille déposée.", d.id);
    }
    const chemin = `${PREFIXE_PIECES}${d.id}-v${d.version}-${nettoyerNom(d.fileName)}`;
    fichiers.push({ chemin, contenu });
    pieces.push({
      document_id: d.id,
      titre: d.title,
      categorie: d.category,
      statut: d.status,
      scan_status: d.scanStatus,
      date_expiration: d.expiryDate,
      version: d.version,
      fichier: chemin,
      sha256: d.sha256,
      taille: contenu.byteLength,
      type_reel: d.mimeDetected,
      sans_fichier: false,
    });
  }

  // ------------------------------------------------------------- Journal
  const idsAnalyses = analyses.map((a) => a.id);
  const idsDocuments = documents.map((d) => d.id);
  const conditions = [
    and(eq(auditLogs.entityType, "DDS"), eq(auditLogs.entityId, ddsId)),
    idsAnalyses.length ? and(eq(auditLogs.entityType, "AUDIT"), inArray(auditLogs.entityId, idsAnalyses)) : undefined,
    idsDocuments.length ? and(eq(auditLogs.entityType, "DOCUMENT"), inArray(auditLogs.entityId, idsDocuments)) : undefined,
  ].filter((x): x is NonNullable<typeof x> => x !== undefined);
  const lignesFiltrees = await tx
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, organizationId), or(...conditions)))
    .orderBy(auditLogs.sequence);

  const [ancre] = await tx
    .select({ sequence: auditLogs.sequence, hash: auditLogs.hash, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, organizationId))
    .orderBy(desc(auditLogs.sequence))
    .limit(1);

  const journal = lignesFiltrees.map((l) => ({
    sequence: l.sequence,
    created_at: l.createdAt.toISOString(),
    action: l.action,
    entity_type: l.entityType,
    entity_id: l.entityId,
    user_email: l.userEmail,
    acteur_id: l.acteurId,
    acteur_role: l.acteurRole,
    request_id: l.requestId,
    details: l.details,
    avant: l.avant,
    apres: l.apres,
    hash_precedent: l.hashPrecedent,
    hash: l.hash,
  }));

  // ------------------------------------------------- Ce qui n'est pas vérifié
  const nonVerifie: string[] = [];
  const sansFichier = pieces.filter((p) => p.sans_fichier === true).length;
  const nonScannees = pieces.filter((p) => p.scan_status !== "CLEAN" && p.scan_status !== "INFECTED").length;
  if (pieces.length > 0 && nonScannees > 0) {
    nonVerifie.push(
      `${nonScannees} pièce(s) sans analyse antivirus (statut NOT_SCANNED) : aucun moteur antivirus n'est installé. Cela ne garantit pas l'absence de logiciel malveillant.`,
    );
  }
  if (sansFichier > 0) {
    nonVerifie.push(`${sansFichier} pièce(s) déclarée(s) sans fichier déposé : elles ne comptent pas comme preuve.`);
  }
  const nonProbantes = analyses.filter((a) => !a.analysisProbative);
  if (nonProbantes.length > 0) {
    nonVerifie.push(
      `${nonProbantes.length} analyse(s) non probante(s) (simulation, source indisponible ou géométrie invalide) : elles n'établissent aucune conformité.`,
    );
  }
  const sourcesNonOfficielles = analyses.filter((a) => a.analysisProbative && a.analysisSource !== "gfw-umd-loss-gain");
  if (sourcesNonOfficielles.length > 0) {
    const sources = [...new Set(sourcesNonOfficielles.map((a) => a.analysisSource ?? "inconnue"))].join(", ");
    nonVerifie.push(
      `${sourcesNonOfficielles.length} analyse(s) marquée(s) probante(s) avec une source autre que le service officiel (${sources}). Vérifier avant toute déclaration.`,
    );
  }
  nonVerifie.push(
    "Aucune transmission au système TRACES NT n'a été effectuée : ce pack est une preuve interne.",
    "Aucune signature externe ni horodatage qualifié n'est apposé : l'intégrité repose sur les condensats SHA-256 de SHA256SUMS.txt.",
    "Le journal est un extrait du dossier, avec l'ancre de l'organisation. La chaîne complète se vérifie côté base (scripts/verifier-chaine.ts).",
  );

  const manifeste = {
    format: FORMAT_PACK,
    genere_le: new Date().toISOString(),
    genere_par: { id: acteur.id, role: acteur.role },
    organisation_id: organizationId,
    dossier: {
      id: dds.id,
      reference: dds.reference,
      titre: dds.title,
      produit_base: dds.commodity,
      statut: dds.status,
      niveau_risque: charge.resultat.risque.niveau,
      poids_net_kg: dds.netWeightKg,
      surface_totale_ha: dds.totalAreaHa,
      nombre_parcelles: analyses.length,
    },
    readiness: {
      etat: charge.resultat.etat,
      explication: charge.resultat.explication,
      completude: charge.resultat.completude,
      blocages: charge.resultat.blocages,
      manquants: charge.resultat.manquants,
    },
    pieces,
    analyses: analyses.map((a) => ({
      id: a.id,
      parcelle_ref: a.parcelReference,
      statut: a.status,
      probante: a.analysisProbative,
      source: a.analysisSource,
    })),
    journal: {
      entrees_dossier: journal.length,
      ancre_organisation: ancre
        ? { sequence: ancre.sequence, hash: ancre.hash, created_at: ancre.createdAt.toISOString() }
        : null,
    },
    non_verifie: nonVerifie,
  };

  const dossierJson = {
    id: dds.id,
    reference: dds.reference,
    titre: dds.title,
    produit_base: dds.commodity,
    statut: dds.status,
    fournisseur: fournisseur ?? null,
    produit: produit ?? null,
    poids_net_kg: dds.netWeightKg,
    cree_le: dds.createdAt.toISOString(),
    modifie_le: dds.updatedAt.toISOString(),
    readiness: charge.resultat,
  };

  const analysesJson = analyses.map((a) => ({
    id: a.id,
    parcelle_ref: a.parcelReference,
    plot_id: a.plotId,
    statut: a.status,
    conforme: a.compliant,
    probante: a.analysisProbative,
    source: a.analysisSource,
    methode: a.analysisMethod,
    version_methode: a.analysisVersion,
    parametres: a.analysisParams,
    limites: a.analysisLimits,
    preuves_analyse: a.analysisEvidence,
    annee_perte: a.lossYear,
    confiance: a.confidenceScore,
    pays: a.countryCode,
    risque_pays: a.countryRisk,
    surface_ha: a.areaHa,
    date_recolte: a.harvestDate,
    geometrie: a.geometry,
    cree_le: a.createdAt.toISOString(),
  }));

  const fichiersComplets: FichierPack[] = [
    { chemin: NOM_MANIFESTE, contenu: json(manifeste) },
    { chemin: "dossier.json", contenu: json(dossierJson) },
    { chemin: "analyses.json", contenu: json(analysesJson) },
    { chemin: "journal.json", contenu: json(journal) },
    { chemin: NOM_LISEZMOI, contenu: encoder.encode(texteLisezmoi(dds.reference)) },
    ...fichiers,
  ];

  return {
    fichiers: fichiersComplets,
    resume: {
      pieces: pieces.length - sansFichier,
      piecesSansFichier: sansFichier,
      analyses: analyses.length,
      entreesJournal: journal.length,
    },
  };
}

function texteLisezmoi(reference: string): string {
  return [
    `Pack de preuves du dossier ${reference}`,
    "",
    "Contenu :",
    `  ${NOM_MANIFESTE}   : description du dossier, de la readiness, des pièces et de ce qui n'est pas vérifié`,
    "  dossier.json      : dossier, fournisseur, produit, readiness détaillée",
    "  analyses.json     : analyses de parcelles avec leur provenance (méthode, source, probante, limites)",
    "  journal.json      : extrait du journal d'audit concernant ce dossier, avec les condensats",
    `  ${PREFIXE_PIECES}        : pièces justificatives, telles que déposées`,
    "  SHA256SUMS.txt    : condensat SHA-256 de chaque fichier ci-dessus",
    "",
    "Vérification : exécuter `npx tsx scripts/verifier-pack.ts <archive.zip>` depuis le dépôt,",
    "ou recalculer les condensats de SHA256SUMS.txt avec un outil indépendant.",
    "",
    "Ce pack n'est pas une déclaration. Il ne vaut pas attestation de conformité.",
    "",
  ].join("\n");
}
