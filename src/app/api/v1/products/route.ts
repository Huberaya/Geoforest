import { db } from "@/db";
import { products } from "@/db/schema";
import { COMMODITY_HS_CODES, type Commodity, type Product } from "@/lib/eudr/types";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SEEDED_PRODUCTS: Product[] = [
  {
    id: "prod-01",
    name: "Fèves de Cacao Brutes Grade 1",
    sku: "CAC-CI-G1",
    commodity: "cocoa",
    hsCode: "1801",
    countryOfOrigin: "CI",
    annualVolumeKg: 450000,
    status: "ACTIVE",
    createdAt: "2026-08-01T10:00:00Z",
  },
  {
    id: "prod-02",
    name: "Café Arabica Lavé Supérieur",
    sku: "CAF-CO-SUP",
    commodity: "coffee",
    hsCode: "0901",
    countryOfOrigin: "CO",
    annualVolumeKg: 280000,
    status: "ACTIVE",
    createdAt: "2026-08-05T11:00:00Z",
  },
  {
    id: "prod-03",
    name: "Huile de Palme Brute CPO Durable",
    sku: "PALM-ID-CPO",
    commodity: "palm_oil",
    hsCode: "1511",
    countryOfOrigin: "ID",
    annualVolumeKg: 1200000,
    status: "ACTIVE",
    createdAt: "2026-08-15T09:30:00Z",
  },
  {
    id: "prod-04",
    name: "Graines de Soja Non-OGM",
    sku: "SOY-BR-NON-GMO",
    commodity: "soya",
    hsCode: "1201",
    countryOfOrigin: "BR",
    annualVolumeKg: 850000,
    status: "ACTIVE",
    createdAt: "2026-09-02T14:00:00Z",
  },
];

export async function GET() {
  try {
    const rows = await db.select().from(products).orderBy(desc(products.createdAt));
    if (rows && rows.length > 0) {
      const result: Product[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        sku: r.sku,
        commodity: r.commodity as Commodity,
        hsCode: r.hsCode,
        countryOfOrigin: r.countryOfOrigin,
        annualVolumeKg: r.annualVolumeKg ?? 0,
        status: r.status as "ACTIVE" | "INACTIVE",
        createdAt: r.createdAt.toISOString(),
      }));
      return NextResponse.json(result);
    }
  } catch {
    // Fallback seeded list
  }
  return NextResponse.json(SEEDED_PRODUCTS);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.name || !body.commodity) {
      return NextResponse.json({ detail: "Nom et matière première requis" }, { status: 422 });
    }

    const commodity = body.commodity as Commodity;
    const newProduct: Product = {
      id: crypto.randomUUID(),
      name: String(body.name).trim(),
      sku: body.sku ? String(body.sku).trim().toUpperCase() : null,
      commodity,
      hsCode: body.hsCode ? String(body.hsCode).trim() : (COMMODITY_HS_CODES[commodity] ?? "0000"),
      countryOfOrigin: body.countryOfOrigin ? String(body.countryOfOrigin).trim().toUpperCase() : "FR",
      annualVolumeKg: Number(body.annualVolumeKg) || 0,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };

    try {
      await db.insert(products).values({
        id: newProduct.id,
        name: newProduct.name,
        sku: newProduct.sku,
        commodity: newProduct.commodity,
        hsCode: newProduct.hsCode,
        countryOfOrigin: newProduct.countryOfOrigin,
        annualVolumeKg: newProduct.annualVolumeKg,
        status: newProduct.status,
      });
    } catch (e) {
      console.warn("DB insert product fallback:", e);
    }

    return NextResponse.json(newProduct, { status: 201 });
  } catch {
    return NextResponse.json({ detail: "Corps JSON invalide" }, { status: 400 });
  }
}
