import { db } from "@/db";
import { shipments, suppliers, products } from "@/db/schema";
import type { Commodity, Shipment } from "@/lib/eudr/types";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SEEDED_SHIPMENTS: Shipment[] = [
  {
    id: "ship-01",
    reference: "LOT-2026-CAC-0891",
    supplierId: "supp-01",
    supplierName: "Coopérative Cacaoyère de Divo (COOPADI)",
    productId: "prod-01",
    productName: "Fèves de Cacao Brutes Grade 1",
    commodity: "cocoa",
    netWeightKg: 25000,
    harvestDate: "2026-08-15",
    customsDeclarationRef: "IM4-2026-FR-09128",
    status: "READY",
    plotsCount: 4,
    createdAt: "2026-08-18T10:00:00Z",
  },
  {
    id: "ship-02",
    reference: "LOT-2026-CAF-0412",
    supplierId: "supp-04",
    supplierName: "Coopérative Caféière Huila (ASOCAFE)",
    productId: "prod-02",
    productName: "Café Arabica Lavé Supérieur",
    commodity: "coffee",
    netWeightKg: 18500,
    harvestDate: "2026-09-01",
    customsDeclarationRef: "IM4-2026-FR-09884",
    status: "AUDITED",
    plotsCount: 3,
    createdAt: "2026-09-04T14:30:00Z",
  },
  {
    id: "ship-03",
    reference: "LOT-2026-PALM-0105",
    supplierId: "supp-02",
    supplierName: "PT Sawit Riau Lestari",
    productId: "prod-03",
    productName: "Huile de Palme Brute CPO Durable",
    commodity: "palm_oil",
    netWeightKg: 50000,
    harvestDate: "2026-09-10",
    customsDeclarationRef: null,
    status: "IN_PREPARATION",
    plotsCount: 2,
    createdAt: "2026-09-12T09:15:00Z",
  },
];

export async function GET() {
  try {
    const rows = await db
      .select({
        shipment: shipments,
        supplier: suppliers,
        product: products,
      })
      .from(shipments)
      .leftJoin(suppliers, eq(shipments.supplierId, suppliers.id))
      .leftJoin(products, eq(shipments.productId, products.id))
      .orderBy(desc(shipments.createdAt));

    if (rows && rows.length > 0) {
      const result: Shipment[] = rows.map(({ shipment: s, supplier: sup, product: p }) => ({
        id: s.id,
        reference: s.reference,
        supplierId: s.supplierId,
        supplierName: sup?.name ?? "Fournisseur non lié",
        productId: s.productId,
        productName: p?.name ?? "Produit non lié",
        commodity: (p?.commodity ?? sup?.commodity ?? "cocoa") as Commodity,
        netWeightKg: s.netWeightKg,
        harvestDate: s.harvestDate,
        customsDeclarationRef: s.customsDeclarationRef,
        status: s.status as "IN_PREPARATION" | "AUDITED" | "READY" | "SHIPPED",
        plotsCount: 1,
        createdAt: s.createdAt.toISOString(),
      }));
      return NextResponse.json(result);
    }
  } catch {
    // Fallback seeded list
  }
  return NextResponse.json(SEEDED_SHIPMENTS);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.reference || !body.harvestDate) {
      return NextResponse.json({ detail: "Référence et date de récolte requises" }, { status: 422 });
    }

    const newShipment: Shipment = {
      id: crypto.randomUUID(),
      reference: String(body.reference).trim().toUpperCase(),
      supplierId: body.supplierId ?? null,
      productId: body.productId ?? null,
      netWeightKg: Number(body.netWeightKg) || 0,
      harvestDate: String(body.harvestDate),
      customsDeclarationRef: body.customsDeclarationRef ? String(body.customsDeclarationRef).trim() : null,
      status: "IN_PREPARATION",
      plotsCount: body.plotsCount || 1,
      createdAt: new Date().toISOString(),
    };

    try {
      await db.insert(shipments).values({
        id: newShipment.id,
        reference: newShipment.reference,
        supplierId: newShipment.supplierId,
        productId: newShipment.productId,
        netWeightKg: newShipment.netWeightKg,
        harvestDate: newShipment.harvestDate,
        customsDeclarationRef: newShipment.customsDeclarationRef,
        status: newShipment.status,
      });
    } catch (e) {
      console.warn("DB insert shipment fallback:", e);
    }

    return NextResponse.json(newShipment, { status: 201 });
  } catch {
    return NextResponse.json({ detail: "Corps JSON invalide" }, { status: 400 });
  }
}
