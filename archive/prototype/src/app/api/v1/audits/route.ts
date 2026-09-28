import { db } from "@/db";
import { parcelAudits } from "@/db/schema";
import type { AuditStatus, AuditSummary, RiskLevel } from "@/lib/eudr/types";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50") || 50, 1), 500);

  const rows = await db.select().from(parcelAudits).orderBy(desc(parcelAudits.createdAt)).limit(limit);

  const summaries: AuditSummary[] = rows.map((r) => ({
    audit_id: r.id,
    created_at: r.createdAt.toISOString(),
    operator_name: r.operatorName,
    commodity: r.commodity,
    hs_code: r.hsCode,
    harvest_date: r.harvestDate,
    area_ha: r.areaHa,
    geometry_type: r.geometryType,
    status: r.status as AuditStatus,
    compliant: r.compliant,
    loss_year: r.lossYear,
    risk_level: r.riskLevel as RiskLevel,
    country_code: r.countryCode,
  }));

  return NextResponse.json(summaries);
}
