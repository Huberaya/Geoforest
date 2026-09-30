import { db } from "@/db";
import { suppliers } from "@/db/schema";
import type { Commodity, RiskLevel, Supplier } from "@/lib/eudr/types";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SEEDED_SUPPLIERS: Supplier[] = [
  {
    id: "supp-01",
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
  },
  {
    id: "supp-02",
    name: "PT Sawit Riau Lestari",
    eori: "ID99283741029",
    country: "ID",
    commodity: "palm_oil",
    contactName: "Budi Santoso",
    contactEmail: "budi.s@sawitriau.co.id",
    contactPhone: "+62 812 3456 7890",
    completenessScore: 60,
    riskLevel: "HIGH",
    status: "ACTIVE",
    plotsCount: 8,
    createdAt: "2026-08-20T14:30:00Z",
  },
  {
    id: "supp-03",
    name: "Fazenda Santa Maria do Pará",
    eori: "BR10293847561",
    country: "BR",
    commodity: "soya",
    contactName: "Rodrigo Silva",
    contactEmail: "rodrigo@fazendasantamaria.com.br",
    contactPhone: "+55 91 98765-4321",
    completenessScore: 45,
    riskLevel: "CRITICAL",
    status: "ACTIVE",
    plotsCount: 6,
    createdAt: "2026-09-01T11:15:00Z",
  },
  {
    id: "supp-04",
    name: "Coopérative Caféière Huila (ASOCAFE)",
    eori: "CO88392019482",
    country: "CO",
    commodity: "coffee",
    contactName: "Mateo Gomez",
    contactEmail: "contacto@asocafehuila.co",
    contactPhone: "+57 310 987 6543",
    completenessScore: 100,
    riskLevel: "LOW",
    status: "ACTIVE",
    plotsCount: 10,
    createdAt: "2026-09-10T16:45:00Z",
  },
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const commodity = url.searchParams.get("commodity");
  const country = url.searchParams.get("country");
  const risk = url.searchParams.get("risk");

  try {
    const rows = await db.select().from(suppliers).orderBy(desc(suppliers.createdAt));
    if (rows && rows.length > 0) {
      let result: Supplier[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        eori: r.eori,
        country: r.country,
        commodity: r.commodity as Commodity,
        contactName: r.contactName,
        contactEmail: r.contactEmail,
        contactPhone: r.contactPhone,
        completenessScore: r.completenessScore,
        riskLevel: r.riskLevel as RiskLevel,
        status: r.status as "ACTIVE" | "PENDING_INVITE" | "SUSPENDED",
        plotsCount: r.plotsCount,
        createdAt: r.createdAt.toISOString(),
      }));

      if (commodity) result = result.filter((s) => s.commodity === commodity);
      if (country) result = result.filter((s) => s.country === country);
      if (risk) result = result.filter((s) => s.riskLevel === risk);
      return NextResponse.json(result);
    }
  } catch {
    // Fallback to seeded demo list
  }

  let result = [...SEEDED_SUPPLIERS];
  if (commodity) result = result.filter((s) => s.commodity === commodity);
  if (country) result = result.filter((s) => s.country === country);
  if (risk) result = result.filter((s) => s.riskLevel === risk);
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.name || !body.commodity) {
      return NextResponse.json({ detail: "Nom et matière première requis" }, { status: 422 });
    }

    const newSupplier = {
      id: crypto.randomUUID(),
      name: String(body.name).trim(),
      eori: body.eori ? String(body.eori).trim().toUpperCase() : null,
      country: body.country ? String(body.country).trim().toUpperCase() : "CI",
      commodity: body.commodity as Commodity,
      contactName: body.contactName ? String(body.contactName).trim() : null,
      contactEmail: body.contactEmail ? String(body.contactEmail).trim() : null,
      contactPhone: body.contactPhone ? String(body.contactPhone).trim() : null,
      completenessScore: 30, // initial score
      riskLevel: "STANDARD" as RiskLevel,
      status: "ACTIVE" as const,
      plotsCount: 0,
      createdAt: new Date().toISOString(),
    };

    try {
      await db.insert(suppliers).values({
        id: newSupplier.id,
        name: newSupplier.name,
        eori: newSupplier.eori,
        country: newSupplier.country,
        commodity: newSupplier.commodity,
        contactName: newSupplier.contactName,
        contactEmail: newSupplier.contactEmail,
        contactPhone: newSupplier.contactPhone,
        completenessScore: newSupplier.completenessScore,
        riskLevel: newSupplier.riskLevel,
        status: newSupplier.status,
        plotsCount: 0,
      });
    } catch (e) {
      console.warn("DB insert fallback:", e);
    }

    return NextResponse.json(newSupplier, { status: 201 });
  } catch {
    return NextResponse.json({ detail: "Corps JSON invalide" }, { status: 400 });
  }
}
