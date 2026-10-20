import { parcelAudits } from "@/db/schema";
import type { AuditStatus, AuditSummary, RiskLevel } from "@/lib/eudr/types";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { classerIdentiteOperateur } from "@/lib/eudr/identite-operateur";

export const dynamic = "force-dynamic";

export const GET = guard("dds:read")(async (request: Request, _ctx, { tx, organizationId }): Promise<NextResponse> => {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50") || 50, 1), 500);

  const rows = await tx
    .select()
    .from(parcelAudits)
    .where(eq(parcelAudits.organizationId, organizationId))
    .orderBy(desc(parcelAudits.createdAt))
    .limit(limit);

  const summaries: AuditSummary[] = rows.map((r) => ({
    audit_id: r.id,
    created_at: r.createdAt.toISOString(),
    operator_name: r.operatorName,
    // L'état accompagne le nom : un dossier hérité doit rester identifiable
    // comme tel, même s'il n'est pas listé pour être réécrit.
    operator_identity: classerIdentiteOperateur(r.operatorName, r.operatorEori).etat,
    commodity: r.commodity,
    hs_code: r.hsCode,
    harvest_date: r.harvestDate,
    area_ha: r.areaHa,
    geometry_type: r.geometryType,
    status: r.status as AuditStatus,
    compliant: r.compliant,
    loss_year: r.lossYear,
    risk_level: (r.compliant === false ? "HIGH" : "UNKNOWN") as RiskLevel,
    country_code: "XX",
  }));

  // P0-07 : plus de liste vide en cas d'incident. Une liste vide se lit comme
  // « vous n'avez aucun audit », ce qui est un mensonge par omission.
  return NextResponse.json(summaries);
});
