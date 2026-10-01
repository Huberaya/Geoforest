import { lireCorpsJson } from "@/lib/api/body";
import { complianceTasks, dueDiligenceStatements, products, suppliers } from "@/db/schema";
import type { Commodity, DdsStatus, RiskLevel } from "@/lib/eudr/types";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ⚠️ P0-06 : le statut `DECLARED` n'est jamais attribué par cette route. Il
 * figure dans l'énumération pour refléter l'état d'un dossier réellement
 * déposé ; rien dans ce produit ne peut l'établir aujourd'hui, faute de client
 * EUDR-IS. Un dossier « prêt à déclarer » porte `READY_FOR_DECLARATION` et
 * `transmissionStatus = NOT_TRANSMITTED`.
 */

export const GET = guard("dds:read")(async (request: Request, _ctx, { tx, organizationId }): Promise<Response> => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "200") || 200, 1), 500);

  const filters = [eq(dueDiligenceStatements.organizationId, organizationId)];
  if (q) {
    const like = `%${q}%`;
    filters.push(or(ilike(dueDiligenceStatements.title, like), ilike(dueDiligenceStatements.reference, like))!);
  }
  if (status) filters.push(eq(dueDiligenceStatements.status, status));

  const rows = await tx
    .select({
      dds: dueDiligenceStatements,
      supplierName: suppliers.name,
      productName: products.name,
    })
    .from(dueDiligenceStatements)
    .leftJoin(suppliers, eq(suppliers.id, dueDiligenceStatements.supplierId))
    .leftJoin(products, eq(products.id, dueDiligenceStatements.productId))
    .where(and(...filters))
    .orderBy(desc(dueDiligenceStatements.updatedAt))
    .limit(limit);

  if (rows.length === 0) return NextResponse.json([]);

  const ids = rows.map((r) => r.dds.id);
  const openTasks = await tx
    .select({ diligenceId: complianceTasks.diligenceId, open: count() })
    .from(complianceTasks)
    .where(
      and(
        eq(complianceTasks.organizationId, organizationId),
        sql`${complianceTasks.diligenceId} in ${ids}`,
        sql`${complianceTasks.status} in ('TO_HANDLE','IN_PROGRESS')`,
      ),
    )
    .groupBy(complianceTasks.diligenceId);
  const openBy = new Map(openTasks.map((t) => [t.diligenceId, Number(t.open)]));

  return NextResponse.json(
    rows.map((r) => ({
      id: r.dds.id,
      reference: r.dds.reference,
      title: r.dds.title,
      commodity: r.dds.commodity as Commodity,
      supplierId: r.dds.supplierId,
      supplierName: r.supplierName,
      productId: r.dds.productId,
      productName: r.productName,
      status: r.dds.status as DdsStatus,
      riskLevel: r.dds.riskLevel as RiskLevel,
      completenessScore: r.dds.completenessScore,
      plotsCount: r.dds.plotsCount,
      totalAreaHa: r.dds.totalAreaHa,
      netWeightKg: r.dds.netWeightKg,
      createdAt: r.dds.createdAt.toISOString(),
      updatedAt: r.dds.updatedAt.toISOString(),
      transmissionStatus: "NOT_TRANSMITTED",
      tasksOpen: openBy.get(r.dds.id) ?? 0,
    })),
  );
});

export const POST = guard("dds:write")(async (request: Request, _ctx, { tx, organizationId, session }): Promise<Response> => {
  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const title = str(body.title);
  if (title.length < 2) return NextResponse.json({ detail: "Intitulé requis (≥ 2 caractères)" }, { status: 422 });

  const commodity = str(body.commodity);
  if (!commodity) return NextResponse.json({ detail: "Matière première requise" }, { status: 422 });

  if (str(body.supplierId) && !UUID_PATTERN.test(str(body.supplierId))) {
    return NextResponse.json({ detail: "Fournisseur invalide" }, { status: 422 });
  }
  if (str(body.productId) && !UUID_PATTERN.test(str(body.productId))) {
    return NextResponse.json({ detail: "Produit invalide" }, { status: 422 });
  }

  const year = new Date().getFullYear();
  const [row] = await tx
    .insert(dueDiligenceStatements)
    .values({
      organizationId,
      reference: `DDS-${year}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      title,
      commodity,
      supplierId: str(body.supplierId) || null,
      productId: str(body.productId) || null,
      status: "DRAFT",
    })
    .returning();

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "CREATE",
    entityType: "DDS",
    entityId: row.id,
    apres: row as unknown as Record<string, unknown>,
    details: { reference: row.reference, title },
  });

  return NextResponse.json(
    {
      id: row.id,
      reference: row.reference,
      title: row.title,
      commodity: row.commodity as Commodity,
      supplierId: row.supplierId,
      productId: row.productId,
      status: row.status as DdsStatus,
      riskLevel: row.riskLevel as RiskLevel,
      completenessScore: row.completenessScore,
      plotsCount: row.plotsCount,
      totalAreaHa: row.totalAreaHa,
      netWeightKg: row.netWeightKg,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      transmissionStatus: "NOT_TRANSMITTED",
      tasksOpen: 0,
    },
    { status: 201 },
  );
});
