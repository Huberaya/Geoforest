import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
    if (row) {
      return NextResponse.json({
        ...row,
        plots: [
          { id: "plot-1", name: "Parcelle Divo Est #01", areaHa: 14.5, status: "COMPLIANT", riskLevel: "LOW" },
          { id: "plot-2", name: "Parcelle Divo Ouest #02", areaHa: 8.2, status: "COMPLIANT", riskLevel: "LOW" },
        ],
        documents: [
          { id: "doc-1", title: "Certificat de propriété foncière", category: "LAND_TENURE", status: "VALID", expiryDate: "2027-12-31" },
          { id: "doc-2", title: "Autorisation d'exploitation agricole", category: "HARVEST_PERMIT", status: "VALID", expiryDate: "2026-11-30" },
        ],
        missingData: [],
      });
    }
  } catch {
    // Fallback demo detail
  }

  return NextResponse.json({
    id,
    name: "Coopérative Cacaoyère de Divo (COOPADI)",
    eori: "CI00192837465",
    country: "CI",
    commodity: "cocoa",
    contactName: "Kouamé Konan",
    contactEmail: "direction@coopadi.ci",
    contactPhone: "+225 07 08 09 10",
    completenessScore: 95,
    riskLevel: "LOW",
    status: "ACTIVE",
    plotsCount: 18,
    createdAt: "2026-08-12T09:00:00Z",
    plots: [
      { id: "plot-1", name: "Parcelle Divo Est #01", areaHa: 14.5, status: "COMPLIANT", riskLevel: "LOW" },
      { id: "plot-2", name: "Parcelle Divo Ouest #02", areaHa: 8.2, status: "COMPLIANT", riskLevel: "LOW" },
    ],
    documents: [
      { id: "doc-1", title: "Certificat de propriété foncière", category: "LAND_TENURE", status: "VALID", expiryDate: "2027-12-31" },
      { id: "doc-2", title: "Autorisation d'exploitation agricole", category: "HARVEST_PERMIT", status: "VALID", expiryDate: "2026-11-30" },
    ],
    missingData: [],
  });
}
