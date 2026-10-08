import { lireCorpsJson } from "@/lib/api/body";
import { dueDiligenceStatements, parcelAudits } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";
import { aujourdhuiIso, recalculerDossier } from "@/lib/eudr/readiness-db";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * P0 (recette 2026-10-08) — rattachement d'une analyse de parcelle à un dossier.
 *
 * Seules les analyses rattachées comptent pour la readiness : une analyse
 * « orpheline » ne peut pas faire passer un dossier pour complet.
 */
export const POST = guard<{ params: Promise<{ id: string }> }>("dds:write")(async (
  request: Request,
  context,
  { tx, organizationId, session },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });

  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const auditId = typeof (lecture.value as { audit_id?: unknown }).audit_id === "string"
    ? ((lecture.value as { audit_id: string }).audit_id).trim()
    : "";
  if (!UUID_PATTERN.test(auditId)) return NextResponse.json({ detail: "audit_id invalide" }, { status: 422 });

  const [dds] = await tx
    .select()
    .from(dueDiligenceStatements)
    .where(and(eq(dueDiligenceStatements.id, id), eq(dueDiligenceStatements.organizationId, organizationId)))
    .limit(1);
  if (!dds) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });
  if (dds.status === "DECLARED" || dds.status === "READY_FOR_DECLARATION") {
    return NextResponse.json(
      {
        detail:
          "Dossier figé : il est validé (ou déclaré). Repassez-le en revue avant de modifier ses parcelles.",
      },
      { status: 409 },
    );
  }

  const [analyse] = await tx
    .select()
    .from(parcelAudits)
    .where(and(eq(parcelAudits.id, auditId), eq(parcelAudits.organizationId, organizationId)))
    .limit(1);
  // Même réponse pour « inexistante » et « d'une autre organisation ».
  if (!analyse) return NextResponse.json({ detail: "Analyse introuvable" }, { status: 404 });
  if (analyse.dueDiligenceId && analyse.dueDiligenceId !== id) {
    return NextResponse.json(
      { detail: "Cette analyse est déjà rattachée à un autre dossier. Détachez-la d'abord." },
      { status: 409 },
    );
  }
  if (analyse.dueDiligenceId === id) {
    return NextResponse.json({ detail: "Analyse déjà rattachée à ce dossier" }, { status: 409 });
  }

  await tx
    .update(parcelAudits)
    .set({ dueDiligenceId: id })
    .where(and(eq(parcelAudits.id, auditId), eq(parcelAudits.organizationId, organizationId)));

  await recalculerDossier(tx, organizationId, id, aujourdhuiIso());

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "UPDATE",
    entityType: "DDS",
    entityId: id,
    apres: { audit_rattache: auditId },
    details: { operation: "rattachement_analyse", audit_id: auditId },
  });

  return NextResponse.json({ due_diligence_id: id, audit_id: auditId, rattache: true }, { status: 201 });
});
