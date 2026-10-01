import { dueDiligenceStatements, products, suppliers } from "@/db/schema";
import type { Commodity, DdsStatus, RiskLevel } from "@/lib/eudr/types";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * Déclarations (anciennement « Déclarations TRACES »).
 *
 * ⚠️ P0-06 — l'onglet a été renommé, et son contenu avec lui.
 *
 * Cet écran **ne transmet rien** et ne prétend rien transmettre. Il rassemble
 * les dossiers parvenus au stade « prêt à déclarer » et les brouillons générés,
 * en rappelant pour chacun que le dépôt dans le système d'information EUDR
 * reste à réaliser par l'opérateur.
 *
 * Le produit ne peut pas établir de statut « déclaré » : aucun client EUDR-IS
 * n'est implémenté.
 */
export const GET = guard("dds:read")(async (_request: Request, _ctx, { tx, organizationId }): Promise<Response> => {
  const rows = await tx
    .select({
      dds: dueDiligenceStatements,
      supplierName: suppliers.name,
      productName: products.name,
    })
    .from(dueDiligenceStatements)
    .leftJoin(suppliers, eq(suppliers.id, dueDiligenceStatements.supplierId))
    .leftJoin(products, eq(products.id, dueDiligenceStatements.productId))
    .where(eq(dueDiligenceStatements.organizationId, organizationId))
    .orderBy(desc(dueDiligenceStatements.updatedAt))
    .limit(200);

  return NextResponse.json({
    transmission_capability: {
      available: false,
      reason:
        "Aucun client du système d'information EUDR n'est implémenté. Le produit ne peut " +
        "ni déposer une déclaration, ni en recevoir un accusé.",
    },
    declarations: rows.map((r) => ({
      id: r.dds.id,
      reference: r.dds.reference,
      title: r.dds.title,
      commodity: r.dds.commodity as Commodity,
      supplierName: r.supplierName,
      productName: r.productName,
      status: r.dds.status as DdsStatus,
      riskLevel: r.dds.riskLevel as RiskLevel,
      completenessScore: r.dds.completenessScore,
      netWeightKg: r.dds.netWeightKg,
      updatedAt: r.dds.updatedAt.toISOString(),
      // Toujours NOT_TRANSMITTED : voir l'avertissement ci-dessus.
      transmission_status: "NOT_TRANSMITTED",
    })),
    ready: rows
      .filter((r) => r.dds.status === "READY_FOR_DECLARATION")
      .map((r) => ({ id: r.dds.id, reference: r.dds.reference })),
    notice:
      "Aucun dossier listé ici n'a été déposé auprès d'une autorité. Le dépôt d'une " +
      "déclaration de diligence raisonnée dans le système d'information EUDR est une " +
      "étape distincte, réalisée par l'opérateur.",
  });
});
