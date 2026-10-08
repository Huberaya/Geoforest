import "server-only";

import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { documents, dueDiligenceStatements, parcelAudits, products, suppliers } from "@/db/schema";
import type { TenantTx } from "@/lib/tenant";
import { evaluerReadiness, type ReadinessResult } from "@/lib/eudr/readiness";

/**
 * Chargement des faits d'un dossier et calcul de sa readiness, dans le contexte
 * RLS du tenant. Aucun champ n'est accepté du client : tout provient de la base.
 */

export interface DossierCharge {
  dds: typeof dueDiligenceStatements.$inferSelect;
  resultat: ReadinessResult;
}

export async function chargerDossier(
  tx: TenantTx,
  organizationId: string,
  ddsId: string,
  aujourdhui: string,
): Promise<DossierCharge | null> {
  const [dds] = await tx
    .select()
    .from(dueDiligenceStatements)
    .where(
      and(
        eq(dueDiligenceStatements.id, ddsId),
        eq(dueDiligenceStatements.organizationId, organizationId),
        isNull(dueDiligenceStatements.deletedAt),
      ),
    )
    .limit(1);
  if (!dds) return null;

  const [fournisseur] = dds.supplierId
    ? await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.id, dds.supplierId), eq(suppliers.organizationId, organizationId)))
        .limit(1)
    : [undefined];
  const [produit] = dds.productId
    ? await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, dds.productId), eq(products.organizationId, organizationId)))
        .limit(1)
    : [undefined];

  const analysesRows = await tx
    .select()
    .from(parcelAudits)
    .where(and(eq(parcelAudits.organizationId, organizationId), eq(parcelAudits.dueDiligenceId, ddsId)));

  const plotIds = analysesRows.map((a) => a.plotId).filter((x): x is string => Boolean(x));
  // Pièces du fournisseur du dossier, ou rattachées à l'une de ses parcelles analysées.
  const liens = [
    dds.supplierId ? eq(documents.supplierId, dds.supplierId) : undefined,
    plotIds.length ? inArray(documents.plotId, plotIds) : undefined,
  ].filter((x): x is NonNullable<typeof x> => x !== undefined);
  const documentsUniques = liens.length
    ? await tx
        .select()
        .from(documents)
        .where(and(eq(documents.organizationId, organizationId), isNull(documents.deletedAt), or(...liens)))
    : [];

  const resultat = evaluerReadiness({
    dossier: {
      status: dds.status,
      supplierId: dds.supplierId,
      productId: dds.productId,
      netWeightKg: dds.netWeightKg,
    },
    fournisseurPresent: Boolean(fournisseur),
    produitPresent: Boolean(produit),
    analyses: analysesRows.map((a) => ({
      id: a.id,
      plotId: a.plotId,
      parcelReference: a.parcelReference,
      status: a.status,
      compliant: a.compliant,
      analysisProbative: a.analysisProbative,
      analysisSource: a.analysisSource,
      countryRisk: a.countryRisk,
      lossYear: a.lossYear,
      areaHa: a.areaHa,
    })),
    documents: documentsUniques.map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      status: d.status,
      supplierId: d.supplierId,
      plotId: d.plotId,
      storageKey: d.storageKey,
      sha256: d.sha256,
      expiryDate: d.expiryDate,
    })),
    aujourdhui,
  });

  return { dds, resultat };
}

/**
 * Persiste les champs dénormalisés du dossier, **calculés** à partir des
 * analyses rattachées. Appelé après tout changement de rattachement.
 */
export async function recalculerDossier(
  tx: TenantTx,
  organizationId: string,
  ddsId: string,
  aujourdhui: string,
): Promise<ReadinessResult | null> {
  const charge = await chargerDossier(tx, organizationId, ddsId, aujourdhui);
  if (!charge) return null;
  const analyses = await tx
    .select({ areaHa: parcelAudits.areaHa })
    .from(parcelAudits)
    .where(and(eq(parcelAudits.organizationId, organizationId), eq(parcelAudits.dueDiligenceId, ddsId)));
  const surface = analyses.reduce((acc, a) => acc + (a.areaHa ?? 0), 0);

  await tx
    .update(dueDiligenceStatements)
    .set({
      riskLevel: charge.resultat.risque.niveau,
      completenessScore: charge.resultat.completude,
      plotsCount: analyses.length,
      totalAreaHa: Number(surface.toFixed(4)),
      updatedAt: new Date(),
    })
    .where(and(eq(dueDiligenceStatements.id, ddsId), eq(dueDiligenceStatements.organizationId, organizationId)));

  return charge.resultat;
}

/** Date de référence au format AAAA-MM-JJ, en UTC (même convention que le reste du produit). */
export function aujourdhuiIso(): string {
  return new Date().toISOString().slice(0, 10);
}
