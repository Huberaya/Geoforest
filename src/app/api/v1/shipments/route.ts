import { lireCorpsJson } from "@/lib/api/body";
import { shipments, suppliers, products } from "@/db/schema";
import type { Commodity, Shipment } from "@/lib/eudr/types";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export const GET = guard("shipment:read")(async (_request: Request, _ctx, { tx, organizationId }) => {
  const rows = await tx
    .select({
      shipment: shipments,
      supplier: suppliers,
      product: products,
    })
    .from(shipments)
    .leftJoin(
      suppliers,
      and(eq(shipments.supplierId, suppliers.id), eq(suppliers.organizationId, organizationId)),
    )
    .leftJoin(
      products,
      and(eq(shipments.productId, products.id), eq(products.organizationId, organizationId)),
    )
    .where(eq(shipments.organizationId, organizationId))
    .orderBy(desc(shipments.createdAt));

  const result: Shipment[] = rows.map(({ shipment: s, supplier: sup, product: p }) => ({
    id: s.id,
    reference: s.reference,
    supplierId: s.supplierId,
    supplierName: sup?.name ?? undefined,
    productId: s.productId,
    productName: p?.name ?? undefined,
    netWeightKg: s.netWeightKg,
    harvestDate: s.harvestDate,
    customsDeclarationRef: s.customsDeclarationRef,
    status: s.status as "IN_PREPARATION" | "AUDITED" | "READY" | "SHIPPED",
    createdAt: s.createdAt.toISOString(),
  }));

  return NextResponse.json(result);
});

export const POST = guard("shipment:write")(async (request: Request, _ctx, { tx, organizationId, session }) => {
  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  try {
    const body = lecture.value as Record<string, unknown>;
    if (!body.reference || !body.harvestDate) {
      return NextResponse.json({ detail: "Référence et date de récolte requises" }, { status: 422 });
    }

    // B-8 — les références (fournisseur, produit) doivent appartenir à
    // l'organisation : une référence étrangère ne doit ni être enregistrée, ni
    // provoquer une erreur de contrainte (500) qui révélerait son existence.
    const supplierIdEntree = body.supplierId ? String(body.supplierId) : null;
    const productIdEntree = body.productId ? String(body.productId) : null;
    if (supplierIdEntree && !UUID_PATTERN.test(supplierIdEntree)) {
      return NextResponse.json({ detail: "Fournisseur invalide" }, { status: 422 });
    }
    if (productIdEntree && !UUID_PATTERN.test(productIdEntree)) {
      return NextResponse.json({ detail: "Produit invalide" }, { status: 422 });
    }
    if (supplierIdEntree) {
      const [owner] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.id, supplierIdEntree), eq(suppliers.organizationId, organizationId)))
        .limit(1);
      if (!owner) return NextResponse.json({ detail: "Fournisseur introuvable" }, { status: 404 });
    }
    if (productIdEntree) {
      const [owner] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, productIdEntree), eq(products.organizationId, organizationId)))
        .limit(1);
      if (!owner) return NextResponse.json({ detail: "Produit introuvable" }, { status: 404 });
    }

    const newShipment: Shipment = {
      id: crypto.randomUUID(),
      reference: String(body.reference).trim().toUpperCase(),
      supplierId: supplierIdEntree,
      productId: productIdEntree,
      netWeightKg: Number(body.netWeightKg) || 0,
      harvestDate: String(body.harvestDate),
      customsDeclarationRef: body.customsDeclarationRef ? String(body.customsDeclarationRef).trim() : null,
      status: "IN_PREPARATION",
      plotsCount: Number(body.plotsCount) || 1,
      createdAt: new Date().toISOString(),
    };

    await tx.insert(shipments).values({
        organizationId,
        id: newShipment.id,
        reference: newShipment.reference,
        supplierId: newShipment.supplierId,
        productId: newShipment.productId,
        netWeightKg: newShipment.netWeightKg,
        harvestDate: newShipment.harvestDate,
        customsDeclarationRef: newShipment.customsDeclarationRef,
        status: newShipment.status,
      });

    // P1-10 — id. Un lot expédié est une pièce d'un dossier de diligence :
    // son absence du journal rendrait la chaîne de traçabilité incomplète
    // précisément là où elle compte.
    await logAction(tx, organizationId, {
      userEmail: session.user.email,
      acteurId: session.user.id,
      acteurRole: session.user.role,
      action: "CREATE",
      entityType: "SHIPMENT",
      entityId: newShipment.id,
      apres: newShipment as unknown as Record<string, unknown>,
    });

    return NextResponse.json(newShipment, { status: 201 });
  } catch (error) {
    // Un corps JSON illisible est une erreur client ; toute autre erreur
    // (contrainte de base, indisponibilité) est propagée : elle ne doit pas
    // être déguisée en 400 ni avalée (cf. P0-07).
    if (error instanceof SyntaxError) {
      return NextResponse.json({ detail: "Corps JSON invalide" }, { status: 400 });
    }
    throw error;
  }
});
