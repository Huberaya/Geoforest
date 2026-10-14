import { lireCorpsJson } from "@/lib/api/body";
import { complianceTasks, dueDiligenceStatements, products, suppliers } from "@/db/schema";
import { DDS_STATUSES, type Commodity, type DdsStatus, type RiskLevel } from "@/lib/eudr/types";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";
import { aujourdhuiIso, chargerDossier, recalculerDossier } from "@/lib/eudr/readiness-db";
import { estFige, TRANSITIONS, verifierTransitionManuelle } from "@/lib/eudr/dds-etats";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


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
  // P0 (recette 2026-10-08) — la readiness est calculée à partir des faits
  // rattachés, jamais lue dans un champ saisi à la main.
  const charge = await chargerDossier(tx, organizationId, id, aujourdhuiIso());
  return NextResponse.json({
    readiness: charge
      ? {
          etat: charge.resultat.etat,
          completude: charge.resultat.completude,
          risque: charge.resultat.risque,
          blocages: charge.resultat.blocages,
          manquants: charge.resultat.manquants,
          explication: charge.resultat.explication,
        }
      : null,
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

  // B-12 — un dossier figé (prêt, exporté, soumis, déclaré) ne change pas de données :
  // un brouillon exporté ne doit pas diverger du dossier. Repasser en revue d'abord.
  if ((body.title !== undefined || body.netWeightKg !== undefined) && estFige(current.status as DdsStatus)) {
    const issue =
      current.status === "READY_FOR_DECLARATION" || current.status === "EXPORTED"
        ? "Repassez-le en revue (statut « UNDER_REVIEW ») avant toute modification."
        : "Aucune modification n'est possible à ce stade.";
    return NextResponse.json(
      { detail: `Dossier figé (statut « ${current.status} ») : ses données ne se modifient pas. ${issue}` },
      { status: 409 },
    );
  }

  if (body.title !== undefined) {
    if (str(body.title).length < 2) return NextResponse.json({ detail: "Intitulé trop court" }, { status: 422 });
    patch.title = str(body.title);
  }
  // ------------------------------------------------------------ P0 (recette 2026-10-08)
  // Le niveau de risque et la complétude sont CALCULÉS à partir des analyses et
  // des pièces rattachées. Les accepter en saisie permettait d'afficher un
  // dossier « risque LOW, complétude 100 % » sans aucune donnée derrière.
  if (body.riskLevel !== undefined || body.completenessScore !== undefined) {
    return NextResponse.json(
      {
        detail:
          "Le niveau de risque et la complétude sont calculés à partir des parcelles analysées et des pièces " +
          "rattachées : ils ne se saisissent pas. Consultez GET /api/v1/due-diligence/{id} (readiness).",
      },
      { status: 409 },
    );
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
    // Refus explicite des cibles réservées (SUBMITTED, DECLARED, EXPORTED) et des
    // enchaînements non admis : voir src/lib/eudr/dds-etats.ts.
    const from = current.status as DdsStatus;
    const verdict = verifierTransitionManuelle(from, next as DdsStatus);
    if (!verdict.admise) {
      return NextResponse.json({ detail: verdict.motif }, { status: 409 });
    }
    if (next === "READY_FOR_DECLARATION") {
      // ---------------------------------------------------------- P0 : porte de sortie
      // Le passage à « prêt pour déclaration » exige une revue humaine (le dossier
      // est en UNDER_REVIEW) ET un moteur sans blocage ni donnée manquante.
      const charge = await chargerDossier(tx, organizationId, id, aujourdhuiIso());
      if (!charge) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });
      if (charge.resultat.etat !== "READY_FOR_REVIEW") {
        return NextResponse.json(
          {
            detail:
              `Passage refusé : le dossier n'est pas prêt (état « ${charge.resultat.etat} »). ` +
              charge.resultat.explication,
            readiness: {
              etat: charge.resultat.etat,
              blocages: charge.resultat.blocages,
              manquants: charge.resultat.manquants,
            },
          },
          { status: 409 },
        );
      }
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
  // Les champs calculés suivent toujours les faits, après chaque modification.
  await recalculerDossier(tx, organizationId, id, aujourdhuiIso());

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

  const relu = await chargerDossier(tx, organizationId, id, aujourdhuiIso());
  return NextResponse.json({
    id: row.id,
    reference: row.reference,
    status: row.status as DdsStatus,
    riskLevel: relu?.dds.riskLevel ?? (row.riskLevel as RiskLevel),
    completenessScore: relu?.dds.completenessScore ?? row.completenessScore,
    readiness: relu
      ? { etat: relu.resultat.etat, blocages: relu.resultat.blocages, manquants: relu.resultat.manquants }
      : null,
    updatedAt: row.updatedAt.toISOString(),
    transmissionStatus: "NOT_TRANSMITTED",
    allowed_transitions: TRANSITIONS[row.status as DdsStatus] ?? [],
  });
});
