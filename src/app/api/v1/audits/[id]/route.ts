import { parcelAudits } from "@/db/schema";
import { EUDR_CUTOFF_DATE, type AuditStatus, type Commodity, type GeometryValidationResult, type ParcelAuditResponse, type SatelliteCheckResult } from "@/lib/eudr/types";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = guard<{ params: Promise<{ id: string }> }>("dds:read")(async (_request: Request, context: { params: Promise<{ id: string }> }, { tx, organizationId }): Promise<NextResponse> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Audit introuvable" }, { status: 404 });

  const [row] = await tx
    .select()
    .from(parcelAudits)
    .where(and(eq(parcelAudits.id, id), eq(parcelAudits.organizationId, organizationId)))
    .limit(1);
  if (!row) return NextResponse.json({ detail: "Audit introuvable" }, { status: 404 });

  const validation = row.validation as GeometryValidationResult;
  const satellite = (row.satellite ?? null) as SatelliteCheckResult | null;
  const status = row.status as AuditStatus;
  const confidence =
    row.confidenceScore === null ? null : `${Math.round(row.confidenceScore * 100)} % de confiance`;
  const summary =
    status === "INVALID_GEOMETRY"
      ? `Dossier rejeté : ${validation.errors?.[0]?.message ?? "géométrie invalide"}`
      : status === "ANALYSIS_UNAVAILABLE"
        ? `Aucun verdict : l'analyse satellite n'a pas abouti. Ce dossier n'emporte aucune présomption de conformité (parcelle de ${row.areaHa.toFixed(2)} ha).`
        : status === "SIMULATED_NON_PROBATIVE"
          ? `Résultat simulé, non probant : aucune donnée satellite n'a été consultée. Ce dossier ne peut pas servir de preuve de conformité (parcelle de ${row.areaHa.toFixed(2)} ha).`
          : status === "NON_COMPLIANT"
            ? `NON CONFORME EUDR : déforestation détectée en ${row.lossYear} (après le 31/12/2020) sur une parcelle de ${row.areaHa.toFixed(2)} ha${confidence ? `, ${confidence}` : ""}.`
            : `CONFORME EUDR : aucune déforestation post-2020 détectée (parcelle de ${row.areaHa.toFixed(2)} ha, risque ${row.riskLevel}${confidence ? `, ${confidence}` : ""}).`;

  const response = {
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
    draft_reference: row.draftReference,
    draft_generated_at: row.draftGeneratedAt ? row.draftGeneratedAt.toISOString() : null,
    transmission_status: row.transmissionStatus,
  };

  return NextResponse.json(response);
});
