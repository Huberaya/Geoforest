import { db } from "@/db";
import { plots, suppliers } from "@/db/schema";
import { validateGeometry } from "@/lib/eudr/gis-validator";
import { checkDeforestationRisk } from "@/lib/eudr/satellite-checker";
import { isCommodity, type Commodity, type GeoJsonInput, type Plot, type RiskLevel } from "@/lib/eudr/types";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SEEDED_PLOTS: Plot[] = [
  {
    id: "plot-01",
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
  },
  {
    id: "plot-02",
    name: "Parcelle Palmier Riau Nord #04",
    reference: "PAR-ID-RIAU-04",
    supplierId: "supp-02",
    supplierName: "PT Sawit Riau Lestari",
    commodity: "palm_oil",
    countryCode: "ID",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [101.441234, 0.541234],
          [101.448234, 0.541234],
          [101.448234, 0.548234],
          [101.441234, 0.548234],
          [101.441234, 0.541234],
        ],
      ],
    },
    geometryType: "Polygon",
    areaHa: 58.2,
    vertexCount: 5,
    centroidLon: 101.444734,
    centroidLat: 0.544734,
    status: "NON_COMPLIANT",
    riskLevel: "HIGH",
    lossYear: 2022,
    confidenceScore: 0.92,
    lastAuditAt: "2026-09-18T14:30:00Z",
    createdAt: "2026-08-22T11:00:00Z",
  },
  {
    id: "plot-03",
    name: "Parcelle Soja Pará Sud #12",
    reference: "PAR-BR-PARA-12",
    supplierId: "supp-03",
    supplierName: "Fazenda Santa Maria do Pará",
    commodity: "soya",
    countryCode: "BR",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-48.511234, -1.451234],
          [-48.502234, -1.451234],
          [-48.502234, -1.460234],
          [-48.511234, -1.460234],
          [-48.511234, -1.451234],
        ],
      ],
    },
    geometryType: "Polygon",
    areaHa: 102.4,
    vertexCount: 5,
    centroidLon: -48.506734,
    centroidLat: -1.455734,
    status: "NON_COMPLIANT",
    riskLevel: "CRITICAL",
    lossYear: 2023,
    confidenceScore: 0.95,
    lastAuditAt: "2026-09-20T16:00:00Z",
    createdAt: "2026-09-02T13:00:00Z",
  },
  {
    id: "plot-04",
    name: "Parcelle Café Huila Altitude #08",
    reference: "PAR-CO-HUI-08",
    supplierId: "supp-04",
    supplierName: "Coopérative Caféière Huila (ASOCAFE)",
    commodity: "coffee",
    countryCode: "CO",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-75.291234, 2.931234],
          [-75.286234, 2.931234],
          [-75.286234, 2.936234],
          [-75.291234, 2.936234],
          [-75.291234, 2.931234],
        ],
      ],
    },
    geometryType: "Polygon",
    areaHa: 3.4,
    vertexCount: 5,
    centroidLon: -75.288734,
    centroidLat: 2.933734,
    status: "COMPLIANT",
    riskLevel: "LOW",
    lossYear: null,
    confidenceScore: 0.98,
    lastAuditAt: "2026-09-22T09:15:00Z",
    createdAt: "2026-09-10T08:30:00Z",
  },
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const commodity = url.searchParams.get("commodity");
  const status = url.searchParams.get("status");

  try {
    const rows = await db
      .select({
        plot: plots,
        supplier: suppliers,
      })
      .from(plots)
      .leftJoin(suppliers, eq(plots.supplierId, suppliers.id))
      .orderBy(desc(plots.createdAt));

    if (rows && rows.length > 0) {
      let result: Plot[] = rows.map(({ plot: p, supplier: sup }) => ({
        id: p.id,
        name: p.name,
        reference: p.reference,
        supplierId: p.supplierId,
        supplierName: sup?.name ?? "Fournisseur non lié",
        commodity: p.commodity as Commodity,
        countryCode: p.countryCode,
        geometry: p.geometry as GeoJsonInput,
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
      }));

      if (commodity) result = result.filter((p) => p.commodity === commodity);
      if (status) result = result.filter((p) => p.status === status);
      return NextResponse.json(result);
    }
  } catch {
    // Fallback seeded list
  }

  let result = [...SEEDED_PLOTS];
  if (commodity) result = result.filter((p) => p.commodity === commodity);
  if (status) result = result.filter((p) => p.status === status);
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.name || !body.geojson) {
      return NextResponse.json({ detail: "Nom et géométrie GeoJSON requis" }, { status: 422 });
    }

    const commodity = isCommodity(body.commodity) ? body.commodity : "cocoa";
    const harvestDate = typeof body.harvest_date === "string" ? body.harvest_date : new Date().toISOString().slice(0, 10);
    const declaredArea = Number(body.declared_area_ha) || null;

    // Validate geometry
    const validation = validateGeometry(body.geojson as GeoJsonInput, declaredArea);

    // Check deforestation risk
    let satellite = null;
    let status: Plot["status"] = "INVALID_GEOMETRY";
    if (validation.valid && validation.normalized_geometry) {
      satellite = await checkDeforestationRisk(validation.normalized_geometry, harvestDate, body.geojson as GeoJsonInput);
      status = satellite.compliant ? "COMPLIANT" : "NON_COMPLIANT";
    }

    const newPlot: Plot = {
      id: crypto.randomUUID(),
      name: String(body.name).trim(),
      reference: body.reference ? String(body.reference).trim().toUpperCase() : `PAR-${Date.now().toString().slice(-6)}`,
      supplierId: body.supplierId ?? null,
      commodity,
      countryCode: satellite?.country_code ?? body.countryCode ?? "XX",
      geometry: validation.normalized_geometry ?? body.geojson,
      geometryType: validation.geometry_type ?? "Unknown",
      areaHa: validation.area_ha,
      vertexCount: validation.vertex_count,
      centroidLon: validation.centroid?.[0] ?? 0,
      centroidLat: validation.centroid?.[1] ?? 0,
      status,
      riskLevel: (satellite?.risk_level as RiskLevel) ?? "STANDARD",
      lossYear: satellite?.loss_year ?? null,
      confidenceScore: satellite?.confidence_score ?? 0,
      lastAuditAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    try {
      await db.insert(plots).values({
        id: newPlot.id,
        name: newPlot.name,
        reference: newPlot.reference,
        supplierId: newPlot.supplierId,
        commodity: newPlot.commodity,
        countryCode: newPlot.countryCode,
        geometry: newPlot.geometry,
        geometryType: newPlot.geometryType,
        areaHa: newPlot.areaHa,
        vertexCount: newPlot.vertexCount,
        centroidLon: newPlot.centroidLon,
        centroidLat: newPlot.centroidLat,
        status: newPlot.status,
        riskLevel: newPlot.riskLevel,
        lossYear: newPlot.lossYear,
        confidenceScore: newPlot.confidenceScore,
        lastAuditAt: new Date(),
      });
    } catch (e) {
      console.warn("DB insert plot fallback:", e);
    }

    return NextResponse.json(newPlot, { status: 201 });
  } catch {
    return NextResponse.json({ detail: "Corps JSON invalide" }, { status: 400 });
  }
}
