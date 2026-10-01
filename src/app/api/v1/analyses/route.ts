import { parcelAudits } from "@/db/schema";
import type { Commodity } from "@/lib/eudr/types";
import { and, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * Analyses de parcelles (audits).
 *
 * ⚠️ P0-04 : une analyse n'est **probante** que si elle repose sur des données
 * réellement mesurées. Les compteurs ci-dessous distinguent donc systématiquement
 * les analyses probantes des autres : additionner les deux produirait un
 * indicateur de conformité faux.
 */
export const GET = guard("analysis:read")(async (request: Request, _ctx, { tx, organizationId }): Promise<Response> => {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "100") || 100, 1), 500);
  const probativeOnly = url.searchParams.get("probative") === "true";

  const filters = [eq(parcelAudits.organizationId, organizationId)];
  if (probativeOnly) filters.push(eq(parcelAudits.analysisProbative, true));

  const rows = await tx
    .select()
    .from(parcelAudits)
    .where(and(...filters))
    .orderBy(desc(parcelAudits.createdAt))
    .limit(limit);

  const [totals] = await tx
    .select({
      total: sql<number>`count(*)`,
      probatives: sql<number>`count(*) filter (where ${parcelAudits.analysisProbative} = true)`,
      conformes: sql<number>`count(*) filter (where ${parcelAudits.compliant} = true)`,
      nonConformes: sql<number>`count(*) filter (where ${parcelAudits.compliant} = false)`,
      indisponibles: sql<number>`count(*) filter (where ${parcelAudits.status} = 'ANALYSIS_UNAVAILABLE')`,
      simulees: sql<number>`count(*) filter (where ${parcelAudits.status} = 'SIMULATED_NON_PROBATIVE')`,
    })
    .from(parcelAudits)
    .where(eq(parcelAudits.organizationId, organizationId));

  return NextResponse.json({
    analyses: rows.map((r) => ({
      audit_id: r.id,
      created_at: r.createdAt.toISOString(),
      parcel_reference: r.parcelReference,
      commodity: r.commodity as Commodity,
      area_ha: r.areaHa,
      geometry_type: r.geometryType,
      country_code: r.countryCode,
      status: r.status,
      compliant: r.compliant,
      loss_year: r.lossYear,
      risk_level: r.riskLevel,
      analysis_source: r.analysisSource,
      analysis_probative: r.analysisProbative,
      confidence_score: r.confidenceScore,
      draft_reference: r.draftReference,
    })),
    summary: {
      total: Number(totals?.total ?? 0),
      probative: Number(totals?.probatives ?? 0),
      compliant: Number(totals?.conformes ?? 0),
      non_compliant: Number(totals?.nonConformes ?? 0),
      unavailable: Number(totals?.indisponibles ?? 0),
      simulated: Number(totals?.simulees ?? 0),
    },
    // Rappel : sans clé GFW configurée, aucune analyse n'est probante et
    // l'indicateur de conformité n'a pas de valeur (P0-04).
    notice:
      Number(totals?.probatives ?? 0) === 0
        ? "Aucune analyse probante : les résultats affichés n'emportent aucune présomption de conformité."
        : null,
  });
});
