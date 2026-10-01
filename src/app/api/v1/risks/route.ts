import { lireCorpsJson } from "@/lib/api/body";
import { complianceTasks, dueDiligenceStatements } from "@/db/schema";
import type { Alert, ComplianceTask } from "@/lib/eudr/types";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const STATUSES = ["TO_HANDLE", "IN_PROGRESS", "RESOLVED", "VALIDATED"] as const;

function toTask(row: typeof complianceTasks.$inferSelect, ddsReference: string | null): ComplianceTask {
  return {
    id: row.id,
    diligenceId: row.diligenceId,
    ddsReference,
    title: row.title,
    description: row.description,
    severity: row.severity as ComplianceTask["severity"],
    status: row.status as ComplianceTask["status"],
    assignee: row.assignee,
    dueDate: row.dueDate,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Risques et actions.
 *
 * ⚠️ Aucun risque n'est inventé : cette route expose les tâches réellement
 * enregistrées. Un tenant sans tâche obtient une liste vide, pas un jeu de
 * démonstration. Les alertes dérivées (documents expirés, analyses non
 * concluantes) sont calculées, jamais simulées — voir `/api/v1/alerts`.
 */
export const GET = guard("risk:read")(async (request: Request, _ctx, { tx, organizationId }): Promise<Response> => {
  const url = new URL(request.url);
  const status = url.searchParams.get("status")?.trim() ?? "";
  const severity = url.searchParams.get("severity")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "200") || 200, 1), 500);

  const filters = [eq(complianceTasks.organizationId, organizationId)];
  if (status) filters.push(eq(complianceTasks.status, status));
  if (severity) filters.push(eq(complianceTasks.severity, severity));

  const rows = await tx
    .select({ task: complianceTasks, ddsReference: dueDiligenceStatements.reference })
    .from(complianceTasks)
    .leftJoin(dueDiligenceStatements, eq(dueDiligenceStatements.id, complianceTasks.diligenceId))
    .where(and(...filters))
    .orderBy(desc(complianceTasks.createdAt))
    .limit(limit);

  return NextResponse.json(rows.map((r) => toTask(r.task, r.ddsReference)));
});

export const POST = guard("risk:write")(async (request: Request, _ctx, { tx, organizationId, session }): Promise<Response> => {
  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const title = str(body.title);
  if (title.length < 2) return NextResponse.json({ detail: "Intitulé requis (≥ 2 caractères)" }, { status: 422 });

  const severity = str(body.severity) || "MEDIUM";
  if (!SEVERITIES.includes(severity as (typeof SEVERITIES)[number])) {
    return NextResponse.json({ detail: "Sévérité invalide" }, { status: 422 });
  }

  const dueDate = str(body.dueDate);
  if (dueDate && !DATE_PATTERN.test(dueDate)) {
    return NextResponse.json({ detail: "Échéance invalide (AAAA-MM-JJ)" }, { status: 422 });
  }

  let diligenceId: string | null = null;
  if (str(body.diligenceId)) {
    if (!UUID_PATTERN.test(str(body.diligenceId))) {
      return NextResponse.json({ detail: "Dossier invalide" }, { status: 422 });
    }
    const [owner] = await tx
      .select({ id: dueDiligenceStatements.id })
      .from(dueDiligenceStatements)
      .where(and(eq(dueDiligenceStatements.id, str(body.diligenceId)), eq(dueDiligenceStatements.organizationId, organizationId)))
      .limit(1);
    if (!owner) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });
    diligenceId = owner.id;
  }

  const [row] = await tx
    .insert(complianceTasks)
    .values({
      organizationId,
      diligenceId,
      title,
      description: str(body.description) || null,
      severity,
      status: "TO_HANDLE",
      assignee: str(body.assignee) || null,
      dueDate: dueDate || null,
    })
    .returning();

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "CREATE",
    entityType: "TASK",
    entityId: row.id,
    apres: row as unknown as Record<string, unknown>,
    details: { title, severity },
  });

  return NextResponse.json(toTask(row, null), { status: 201 });
});

export const PATCH = guard("risk:write")(async (request: Request, _ctx, { tx, organizationId, session }): Promise<Response> => {
  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as Record<string, unknown>;

  const id = typeof body.id === "string" ? body.id : "";
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Tâche invalide" }, { status: 422 });

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(str(body.status) as (typeof STATUSES)[number])) {
      return NextResponse.json({ detail: "Statut invalide" }, { status: 422 });
    }
    patch.status = str(body.status);
  }
  if (body.severity !== undefined) {
    if (!SEVERITIES.includes(str(body.severity) as (typeof SEVERITIES)[number])) {
      return NextResponse.json({ detail: "Sévérité invalide" }, { status: 422 });
    }
    patch.severity = str(body.severity);
  }
  if (body.assignee !== undefined) patch.assignee = str(body.assignee) || null;
  if (body.dueDate !== undefined) {
    const due = str(body.dueDate);
    if (due && !DATE_PATTERN.test(due)) return NextResponse.json({ detail: "Échéance invalide" }, { status: 422 });
    patch.dueDate = due || null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ detail: "Aucune modification transmise" }, { status: 422 });
  }

  // ------------------------------------------------------------------ P1-10
  // L'état complet d'avant est lu avant l'écriture : une modification
  // consignée sous la forme « champ modifié » ne permet pas de répondre
  // « de quelle valeur à quelle valeur ? », qui est la seule question utile.
  const [avant] = await tx
    .select()
    .from(complianceTasks)
    .where(and(eq(complianceTasks.id, id), eq(complianceTasks.organizationId, organizationId)))
    .limit(1);

  const [row] = await tx
    .update(complianceTasks)
    .set(patch)
    .where(and(eq(complianceTasks.id, id), eq(complianceTasks.organizationId, organizationId)))
    .returning();
  if (!row) return NextResponse.json({ detail: "Tâche introuvable" }, { status: 404 });

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "UPDATE",
    entityType: "TASK",
    entityId: id,
    avant: avant as unknown as Record<string, unknown> | null,
    apres: row as unknown as Record<string, unknown>,
    details: { fields: Object.keys(patch) },
  });

  return NextResponse.json(toTask(row, null));
});

export type { Alert };
