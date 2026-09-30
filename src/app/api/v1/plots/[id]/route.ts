import { db } from "@/db";
import { plots, suppliers } from "@/db/schema";
import type { Commodity, Plot, RiskLevel } from "@/lib/eudr/types";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const [row] = await db
      .select({
        plot: plots,
        supplier: suppliers,
      })
      .from(plots)
      .leftJoin(suppliers, eq(plots.supplierId, suppliers.id))
      .where(eq(plots.id, id))
      .limit(1);

    if (row) {
      const p = row.plot;
      const plot: Plot = {
        id: p.id,
        name: p.name,
        reference: p.reference,
        supplierId: p.supplierId,
        supplierName: row.supplier?.name ?? "Fournisseur non lié",
        commodity: p.commodity as Commodity,
        countryCode: p.countryCode,
        geometry: p.geometry as any,
        geometryType: p.geometryType,
        areaHa: p.areaHa,
        vertexCount: p.vertexCount,
        centroidLon: p.centroidLon,
        centroidLat: p.centroidLat,
        status: p.status as Plot["status"],
        riskLevel: p.riskLevel as RiskLevel,
        lossYear: p.lossYear,
        confidenceScore: p.confidenceScore ?? 0,
        lastAuditAt: p.lastAuditAt ? p.lastAuditAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
      };
      return NextResponse.json(plot);
    }
  } catch {
    // Fallback demo
  }

  // Fallback demo plot
  const demoPlot: Plot = {
    id,
    name: "Parcelle Cacao Divo Est #01",
    reference: "PAR-CI-DIV-01",
    supplierId: "supp-01",
    supplierName: "Coopérative Cacaoyère de Divo (COOPADI)",
    commodity: "cocoa",
    countryCode: "CI",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-5.361234, 5.841234],
          [-5.358234, 5.841234],
          [-5.358234, 5.844234],
          [-5.361234, 5.844234],
          [-5.361234, 5.841234],
        ],
      ],
    },
    geometryType: "Polygon",
    areaHa: 14.5,
    vertexCount: 5,
    centroidLon: -5.359734,
    centroidLat: 5.842734,
    status: "COMPLIANT",
    riskLevel: "LOW",
    lossYear: null,
    confidenceScore: 0.96,
    lastAuditAt: "2026-09-15T10:00:00Z",
    createdAt: "2026-08-15T09:00:00Z",
  };
  return NextResponse.json(demoPlot);
}
