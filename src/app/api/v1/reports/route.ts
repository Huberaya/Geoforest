import { documents, dueDiligenceStatements, organizations, parcelAudits, plots, suppliers } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * Rapport de conformité — uniquement des valeurs **calculées**.
 *
 * ⚠️ Un indicateur qui ne peut pas être calculé est renvoyé `null`, jamais
 * approximé ni remplacé par une constante. Le tableau de bord affichait « 91 %
 * de conformité » et « 1 248,5 ha » de façon permanente (P0-09) ; cette route
 * est construite pour que cela ne soit pas possible.
 */
export const GET = guard("dds:read")(async (_request: Request, _ctx, { tx, organizationId }): Promise<Response> => {
  const [org] = await tx
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const [counts] = await tx
    .select({
      suppliers: sql<number>`(select count(*) from ${suppliers} where ${suppliers.organizationId} = ${organizationId})`,
      plots: sql<number>`(select count(*) from ${plots} where ${plots.organizationId} = ${organizationId})`,
      documents: sql<number>`(select count(*) from ${documents} where ${documents.organizationId} = ${organizationId})`,
      statements: sql<number>`(select count(*) from ${dueDiligenceStatements} where ${dueDiligenceStatements.organizationId} = ${organizationId})`,
      audits: sql<number>`(select count(*) from ${parcelAudits} where ${parcelAudits.organizationId} = ${organizationId})`,
      areaHa: sql<number>`(select coalesce(sum(${plots.areaHa}), 0) from ${plots} where ${plots.organizationId} = ${organizationId})`,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));

  const [auditStats] = await tx
    .select({
      probative: sql<number>`count(*) filter (where ${parcelAudits.analysisProbative} = true)`,
      compliant: sql<number>`count(*) filter (where ${parcelAudits.compliant} = true)`,
      nonCompliant: sql<number>`count(*) filter (where ${parcelAudits.compliant} = false)`,
    })
    .from(parcelAudits)
    .where(eq(parcelAudits.organizationId, organizationId));

  const docRows = await tx
    .select({ status: documents.status, n: sql<number>`count(*)` })
    .from(documents)
    .where(eq(documents.organizationId, organizationId))
    .groupBy(documents.status);

  const ddsRows = await tx
    .select({ status: dueDiligenceStatements.status, n: sql<number>`count(*)` })
    .from(dueDiligenceStatements)
    .where(eq(dueDiligenceStatements.organizationId, organizationId))
    .groupBy(dueDiligenceStatements.status);

  const probative = Number(auditStats?.probative ?? 0);

  return NextResponse.json({
    organizationName: org?.name ?? null,
    generatedAt: new Date().toISOString(),
    counts: {
      suppliers: Number(counts?.suppliers ?? 0),
      plots: Number(counts?.plots ?? 0),
      documents: Number(counts?.documents ?? 0),
      statements: Number(counts?.statements ?? 0),
      audits: Number(counts?.audits ?? 0),
    },
    auditedPlots: Number(counts?.audits ?? 0),
    probativeAudits: probative,
    // NULL = non calculable : on ne divise pas par zéro, on ne devine pas.
    compliantAudits: probative > 0 ? Number(auditStats?.compliant ?? 0) : null,
    nonCompliantAudits: probative > 0 ? Number(auditStats?.nonCompliant ?? 0) : null,
    documentsByStatus: Object.fromEntries(docRows.map((r) => [r.status, Number(r.n)])),
    statementsByStatus: Object.fromEntries(ddsRows.map((r) => [r.status, Number(r.n)])),
    areaHa: Number(counts?.areaHa ?? 0),
    notice:
      probative === 0
        ? "Aucune analyse probante : le taux de conformité n'est pas calculable et n'est donc pas affiché."
        : null,
  });

});
