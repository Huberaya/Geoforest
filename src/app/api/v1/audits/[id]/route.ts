import { db } from "@/db";
import { parcelAudits } from "@/db/schema";
import { EUDR_CUTOFF_DATE, type AuditStatus, type Commodity, type GeometryValidationResult, type ParcelAuditResponse, type SatelliteCheckResult } from "@/lib/eudr/types";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Audit introuvable" }, { status: 404 });

  const [row] = await db.select().from(parcelAudits).where(eq(parcelAudits.id, id)).limit(1);
  if (!row) return NextResponse.json({ detail: "Audit introuvable" }, { status: 404 });

  const validation = row.validation as GeometryValidationResult;
  const satellite = (row.satellite ?? null) as SatelliteCheckResult | null;
  const status = row.status as AuditStatus;
  const summary =
    status === "INVALID_GEOMETRY"
      ? `Dossier rejeté : ${validation.errors?.[0]?.message ?? "géométrie invalide"}`
      : status === "NON_COMPLIANT"
        ? `NON CONFORME EUDR : déforestation détectée en ${row.lossYear} (après le 31/12/2020) sur une parcelle de ${row.areaHa.toFixed(2)} ha.`
        : `CONFORME EUDR : aucune déforestation post-2020 détectée (parcelle de ${row.areaHa.toFixed(2)} ha, risque ${row.riskLevel}, confiance ${Math.round(row.confidenceScore * 100)} %).`;

  const response: ParcelAuditResponse & { traces_reference: string | null; exported_at: string | null } = {
    audit_id: row.id,
    created_at: row.createdAt.toISOString(),
    status,
    commodity: row.commodity as Commodity,
    hs_code: row.hsCode,
    harvest_date: row.harvestDate,
    validation,
    satellite,
    eudr_cutoff_date: EUDR_CUTOFF_DATE,
    summary,
    traces_reference: row.tracesReference,
    exported_at: row.exportedAt ? row.exportedAt.toISOString() : null,
  };
  return NextResponse.json(response);
}
