import { dueDiligenceStatements, parcelAudits } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";
import { aujourdhuiIso, recalculerDossier } from "@/lib/eudr/readiness-db";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** P0 (recette 2026-10-08) — détachement d'une analyse d'un dossier. L'analyse n'est pas effacée. */
export const DELETE = guard<{ params: Promise<{ id: string; auditId: string }> }>("dds:write")(async (
  _request: Request,
  context,
  { tx, organizationId, session },
): Promise<Response> => {
  const { id, auditId } = await context.params;
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(auditId)) {
    return NextResponse.json({ detail: "Rattachement introuvable" }, { status: 404 });
  }

  const [dds] = await tx
    .select()
    .from(dueDiligenceStatements)
    .where(and(eq(dueDiligenceStatements.id, id), eq(dueDiligenceStatements.organizationId, organizationId)))
    .limit(1);
  if (!dds) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });
  if (dds.status === "DECLARED" || dds.status === "READY_FOR_DECLARATION") {
    return NextResponse.json(
      { detail: "Dossier figé : repassez-le en revue avant de modifier ses parcelles." },
      { status: 409 },
    );
  }

  const detached = await tx
    .update(parcelAudits)
    .set({ dueDiligenceId: null })
    .where(
      and(
        eq(parcelAudits.id, auditId),
        eq(parcelAudits.organizationId, organizationId),
        eq(parcelAudits.dueDiligenceId, id),
      ),
    )
    .returning({ id: parcelAudits.id });
  if (detached.length === 0) return NextResponse.json({ detail: "Rattachement introuvable" }, { status: 404 });

  await recalculerDossier(tx, organizationId, id, aujourdhuiIso());

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "UPDATE",
    entityType: "DDS",
    entityId: id,
    apres: { audit_detache: auditId },
    details: { operation: "detachement_analyse", audit_id: auditId },
  });

  return new Response(null, { status: 204 });
});
