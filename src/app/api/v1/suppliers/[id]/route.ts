import { documents, plots, suppliers } from "@/db/schema";
import { missingCompletenessCriteria, supplierCompleteness } from "@/lib/eudr/completeness";
import type { Commodity, RiskLevel, SupplierDetail } from "@/lib/eudr/types";
import { and, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * ⚠️ P0-09 — cette route ne fabrique plus de fournisseur.
 *
 * L'écran de détail se repliait autrefois, en cas d'absence de réponse, sur un
 * fournisseur imaginaire : une coopérative ivoirienne inventée, avec un EORI,
 * un contact et un numéro de téléphone écrits dans le code, un score de
 * complétude de 95 %, deux pièces de légalité marquées « valides » et deux
 * parcelles déclarées conformes. Rien de tout cela ne venait de la base.
 *
 * Désormais un identifiant inconnu répond **404**, et un fournisseur réel mais
 * incomplet répond avec ses données réelles — y compris ses vides.
 */
export const GET = guard<{ params: Promise<{ id: string }> }>("supplier:read")(async (
  _req: Request,
  context: { params: Promise<{ id: string }> },
  { tx, organizationId },
) => {
  const { id } = await context.params;

  const [row] = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
      eori: suppliers.eori,
      country: suppliers.country,
      commodity: suppliers.commodity,
      contactName: suppliers.contactName,
      contactEmail: suppliers.contactEmail,
      contactPhone: suppliers.contactPhone,
      riskLevel: suppliers.riskLevel,
      status: suppliers.status,
      createdAt: suppliers.createdAt,
      updatedAt: suppliers.updatedAt,
      plotsCount: sql<number>`count(${plots.id})`,
    })
    .from(suppliers)
    .leftJoin(plots, eq(plots.supplierId, suppliers.id))
    .where(and(eq(suppliers.id, id), eq(suppliers.organizationId, organizationId)))
    .groupBy(suppliers.id)
    .limit(1);

  if (!row) {
    return NextResponse.json({ detail: "Fournisseur introuvable" }, { status: 404 });
  }

  // Parcelles et documents réellement rattachés, jamais reconstitués.
  const plotRows = await tx
    .select({
      id: plots.id,
      name: plots.name,
      reference: plots.reference,
      areaHa: plots.areaHa,
      status: plots.status,
      riskLevel: plots.riskLevel,
      geometryType: plots.geometryType,
      countryCode: plots.countryCode,
    })
    .from(plots)
    .where(and(eq(plots.supplierId, id), eq(plots.organizationId, organizationId)))
    .orderBy(desc(plots.createdAt));

  const docRows = await tx
    .select({
      id: documents.id,
      title: documents.title,
      category: documents.category,
      status: documents.status,
      expiryDate: documents.expiryDate,
      notes: documents.notes,
    })
    .from(documents)
    .where(and(eq(documents.supplierId, id), eq(documents.organizationId, organizationId)))
    .orderBy(desc(documents.createdAt));

  const plotsCount = Number(row.plotsCount ?? 0);

  const detail: SupplierDetail = {
    id: row.id,
    name: row.name,
    eori: row.eori,
    country: row.country,
    commodity: row.commodity as Commodity,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    completenessScore: supplierCompleteness({ ...row, plotsCount }),
    riskLevel: row.riskLevel as RiskLevel,
    status: row.status as "ACTIVE" | "PENDING_INVITE" | "SUSPENDED",
    plotsCount,
    createdAt: row.createdAt.toISOString(),
    // `missingData` : critères de complétude non satisfaits, énumérés pour que
    // l'écran dise ce qui manque au lieu d'afficher un pourcentage nu.
    missingData: missingCompletenessCriteria({ ...row, plotsCount }),
    plots: plotRows.map((p) => ({
      id: p.id,
      name: p.name,
      reference: p.reference,
      areaHa: p.areaHa,
      status: p.status,
      riskLevel: p.riskLevel,
      geometryType: p.geometryType,
      countryCode: p.countryCode,
    })),
    documents: docRows.map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      status: d.status,
      expiryDate: d.expiryDate,
    })),
  };

  return NextResponse.json(detail);
});
