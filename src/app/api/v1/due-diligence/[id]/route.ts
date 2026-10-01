import { lireCorpsJson } from "@/lib/api/body";
import { complianceTasks, dueDiligenceStatements, products, suppliers } from "@/db/schema";
import { DDS_STATUSES, type Commodity, type DdsStatus, type RiskLevel } from "@/lib/eudr/types";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Transitions de statut autorisées pour un dossier de diligence raisonnée.
 *
 * ⚠️ P0-06 : `DECLARED` est délibérément **inatteignable**. Une déclaration
 * n'existe qu'après un accusé du système d'information EUDR, qu'aucun
 * composant de ce produit ne peut obtenir à ce jour.
 */
const TRANSITIONS: Record<DdsStatus, DdsStatus[]> = {
  DRAFT: ["MISSING_DATA", "IN_ANALYSIS", "ARCHIVED"],
  MISSING_DATA: ["DRAFT", "IN_ANALYSIS", "ARCHIVED"],
  IN_ANALYSIS: ["UNDER_REVIEW", "RISK_IDENTIFIED", "MISSING_DATA", "ARCHIVED"],
  UNDER_REVIEW: ["RISK_IDENTIFIED", "ACTION_REQUIRED", "READY_FOR_DECLARATION", "IN_ANALYSIS", "ARCHIVED"],
  RISK_IDENTIFIED: ["ACTION_REQUIRED", "UNDER_REVIEW", "ARCHIVED"],
  ACTION_REQUIRED: ["UNDER_REVIEW", "RISK_IDENTIFIED", "ARCHIVED"],
  READY_FOR_DECLARATION: ["UNDER_REVIEW", "ACTION_REQUIRED", "ARCHIVED"],
  DECLARED: ["ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

export const GET = guard<{ params: Promise<{ id: string }> }>("dds:read")(async (
  _request: Request,
  context,
  { tx, organizationId },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });

  const [row] = await tx
    .select({ dds: dueDiligenceStatements, supplierName: suppliers.name, productName: products.name })
    .from(dueDiligenceStatements)
    .leftJoin(suppliers, eq(suppliers.id, dueDiligenceStatements.supplierId))
    .leftJoin(products, eq(products.id, dueDiligenceStatements.productId))
    .where(and(eq(dueDiligenceStatements.id, id), eq(dueDiligenceStatements.organizationId, organizationId)))
    .limit(1);
  if (!row) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });

  const tasks = await tx
    .select()
    .from(complianceTasks)
    .where(and(eq(complianceTasks.organizationId, organizationId), eq(complianceTasks.diligenceId, id)))
    .orderBy(complianceTasks.createdAt);

  return NextResponse.json({
    id: row.dds.id,
    reference: row.dds.reference,
    title: row.dds.title,
    commodity: row.dds.commodity as Commodity,
    supplierId: row.dds.supplierId,
    supplierName: row.supplierName,
    productId: row.dds.productId,
    productName: row.productName,
    status: row.dds.status as DdsStatus,
    riskLevel: row.dds.riskLevel as RiskLevel,
    completenessScore: row.dds.completenessScore,
    plotsCount: row.dds.plotsCount,
    totalAreaHa: row.dds.totalAreaHa,
    netWeightKg: row.dds.netWeightKg,
    createdAt: row.dds.createdAt.toISOString(),
    updatedAt: row.dds.updatedAt.toISOString(),
    transmissionStatus: "NOT_TRANSMITTED",
    transmission_notice:
      "Aucune déclaration n'a été déposée : le dépôt dans le système d'information EUDR " +
      "reste à réaliser par l'opérateur.",
    allowed_transitions: TRANSITIONS[row.dds.status as DdsStatus] ?? [],
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      severity: t.severity,
      status: t.status,
      assignee: t.assignee,
      dueDate: t.dueDate,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

export const PATCH = guard<{ params: Promise<{ id: string }> }>("dds:validate")(async (
  request: Request,
  context,
  { tx, organizationId, session },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });

  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as Record<string, unknown>;

  const [current] = await tx
    .select()
    .from(dueDiligenceStatements)
    .where(and(eq(dueDiligenceStatements.id, id), eq(dueDiligenceStatements.organizationId, organizationId)))
    .limit(1);
  if (!current) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (body.title !== undefined) {
    if (str(body.title).length < 2) return NextResponse.json({ detail: "Intitulé trop court" }, { status: 422 });
    patch.title = str(body.title);
  }
  if (body.riskLevel !== undefined) {
    if (!["LOW", "STANDARD", "HIGH", "CRITICAL"].includes(str(body.riskLevel))) {
      return NextResponse.json({ detail: "Niveau de risque invalide" }, { status: 422 });
    }
    patch.riskLevel = str(body.riskLevel);
  }
  if (body.completenessScore !== undefined) {
    const score = Number(body.completenessScore);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return NextResponse.json({ detail: "Complétude invalide (0-100)" }, { status: 422 });
    }
    patch.completenessScore = Math.round(score);
  }
  if (body.netWeightKg !== undefined) {
    const weight = Number(body.netWeightKg);
    if (!Number.isFinite(weight) || weight < 0) {
      return NextResponse.json({ detail: "Poids net invalide" }, { status: 422 });
    }
    patch.netWeightKg = weight;
  }

  if (body.status !== undefined) {
    const next = str(body.status);
    if (!DDS_STATUSES.includes(next as DdsStatus)) {
      return NextResponse.json({ detail: "Statut inconnu" }, { status: 422 });
    }
    if (next === "DECLARED") {
      // Refus explicite plutôt qu'un statut vide de sens.
      return NextResponse.json(
        {
          detail:
            "Le statut « DECLARED » ne peut pas être attribué depuis cette application : " +
            "il suppose un accusé du système d'information EUDR, qu'aucun composant du " +
            "produit ne peut obtenir aujourd'hui.",
        },
        { status: 409 },
      );
    }
    const from = current.status as DdsStatus;
    if (!(TRANSITIONS[from] ?? []).includes(next as DdsStatus)) {
      return NextResponse.json(
        { detail: `Transition refusée : « ${from} » → « ${next} » n'est pas un enchaînement admis.` },
        { status: 409 },
      );
    }
    patch.status = next;
  }

  // ------------------------------------------------------------------ P1-10
  // L'état complet d'avant est lu avant l'écriture : une modification
  // consignée sous la forme « champ modifié » ne permet pas de répondre
  // « de quelle valeur à quelle valeur ? », qui est la seule question utile.
  const [avant] = await tx
    .select()
    .from(dueDiligenceStatements)
    .where(and(eq(dueDiligenceStatements.id, id), eq(dueDiligenceStatements.organizationId, organizationId)))
    .limit(1);

  const [row] = await tx
    .update(dueDiligenceStatements)
    .set(patch)
    .where(and(eq(dueDiligenceStatements.id, id), eq(dueDiligenceStatements.organizationId, organizationId)))
    .returning();
  if (!row) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: body.status !== undefined ? "VALIDATE" : "UPDATE",
    entityType: "DDS",
    entityId: id,
    avant: avant as unknown as Record<string, unknown> | null,
    apres: row as unknown as Record<string, unknown>,
    details: { fields: Object.keys(patch).filter((k) => k !== "updatedAt") },
  });

  return NextResponse.json({
    id: row.id,
    reference: row.reference,
    status: row.status as DdsStatus,
    riskLevel: row.riskLevel as RiskLevel,
    completenessScore: row.completenessScore,
    updatedAt: row.updatedAt.toISOString(),
    transmissionStatus: "NOT_TRANSMITTED",
    allowed_transitions: TRANSITIONS[row.status as DdsStatus] ?? [],
  });
});
