import { lireCorpsJson } from "@/lib/api/body";
import { parcelAudits, plots, suppliers } from "@/db/schema";
import type { Commodity, Plot, RiskLevel } from "@/lib/eudr/types";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { actionSuppression, logAction } from "@/lib/api/audit-log";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toPlot(row: typeof plots.$inferSelect, supplierName: string | null): Plot {
  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierName,
    name: row.name,
    reference: row.reference,
    commodity: row.commodity as Commodity,
    countryCode: row.countryCode,
    geometry: row.geometry as Plot["geometry"],
    geometryType: row.geometryType,
    areaHa: row.areaHa,
    vertexCount: row.vertexCount,
    centroidLon: row.centroidLon,
    centroidLat: row.centroidLat,
    status: row.status as Plot["status"],
    riskLevel: row.riskLevel as RiskLevel,
    lossYear: row.lossYear,
    confidenceScore: row.confidenceScore,
    lastAuditAt: row.lastAuditAt ? row.lastAuditAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const GET = guard<{ params: Promise<{ id: string }> }>("plot:read")(async (
  _request: Request,
  context,
  { tx, organizationId },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Parcelle introuvable" }, { status: 404 });

  const [row] = await tx
    .select({ plot: plots, supplierName: suppliers.name })
    .from(plots)
    .leftJoin(suppliers, eq(suppliers.id, plots.supplierId))
    .where(and(eq(plots.id, id), eq(plots.organizationId, organizationId)))
    .limit(1);
  if (!row) return NextResponse.json({ detail: "Parcelle introuvable" }, { status: 404 });

  // Les audits sont rattachés à la parcelle par sa référence : le schéma
  // d'audit ne porte pas d'identifiant de parcelle. Une parcelle sans
  // référence n'a donc aucun audit — ce qui est exact, pas une approximation.
  const reference = row.plot.reference;
  const audits = reference
    ? await tx
        .select({
          id: parcelAudits.id,
          status: parcelAudits.status,
          compliant: parcelAudits.compliant,
          lossYear: parcelAudits.lossYear,
          riskLevel: parcelAudits.riskLevel,
          analysisSource: parcelAudits.analysisSource,
          analysisProbative: parcelAudits.analysisProbative,
          createdAt: parcelAudits.createdAt,
        })
        .from(parcelAudits)
        .where(and(eq(parcelAudits.organizationId, organizationId), eq(parcelAudits.parcelReference, reference)))
        .orderBy(desc(parcelAudits.createdAt))
        .limit(50)
    : [];

  return NextResponse.json({
    ...toPlot(row.plot, row.supplierName),
    audits,
    // Dit clairement ce qu'il en est du rattachement, plutôt que de laisser
    // croire à une liste vide par manque de chance.
    audits_linked_by: reference ? "reference" : "aucune_référence",
  });
});

export const PATCH = guard<{ params: Promise<{ id: string }> }>("plot:write")(async (
  request: Request,
  context,
  { tx, organizationId, session },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Parcelle introuvable" }, { status: 404 });

  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as Record<string, unknown>;

  const patch: { name?: string; reference?: string | null; supplierId?: string | null; countryCode?: string } = {};
  if (typeof body.name === "string") {
    if (body.name.trim().length < 2) return NextResponse.json({ detail: "Nom trop court" }, { status: 422 });
    patch.name = body.name.trim();
  }
  if (body.reference !== undefined) patch.reference = typeof body.reference === "string" && body.reference.trim() ? body.reference.trim() : null;
  if (body.countryCode !== undefined) {
    const code = String(body.countryCode).toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return NextResponse.json({ detail: "Code pays invalide" }, { status: 422 });
    patch.countryCode = code;
  }
  if (body.supplierId !== undefined) {
    const sid = typeof body.supplierId === "string" ? body.supplierId : "";
    if (sid) {
      const [owner] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.id, sid), eq(suppliers.organizationId, organizationId)))
        .limit(1);
      if (!owner) return NextResponse.json({ detail: "Fournisseur introuvable" }, { status: 404 });
      patch.supplierId = sid;
    } else {
      patch.supplierId = null;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ detail: "Aucune modification transmise" }, { status: 422 });
  }

  // ------------------------------------------------------------------ P1-10
  // ⚠️ L'état **complet** d'avant est lu avant l'écriture. Consigner
  //   seulement les champs modifiés empêcherait de répondre à « quelle était
  //   la valeur précédente ? » — c'est-à-dire à la seule question qu'un
  //   contrôle pose réellement.
  // Le rattachement pouvant changer, l'ancien fournisseur perd la parcelle
  // et le nouveau la gagne — sinon les deux compteurs deviennent faux.
  const [avant] = await tx
    .select()
    .from(plots)
    .where(and(eq(plots.id, id), eq(plots.organizationId, organizationId)))
    .limit(1);

  const [row] = await tx
    .update(plots)
    .set(patch)
    .where(and(eq(plots.id, id), eq(plots.organizationId, organizationId)))
    .returning();
  if (!row) return NextResponse.json({ detail: "Parcelle introuvable" }, { status: 404 });

  const ancien = avant?.supplierId ?? null;
  const nouveau = row.supplierId ?? null;
  if (ancien !== nouveau) {
    if (ancien) {
      await tx
        .update(suppliers)
        .set({ plotsCount: sql`greatest(${suppliers.plotsCount} - 1, 0)`, updatedAt: new Date() })
        .where(and(eq(suppliers.id, ancien), eq(suppliers.organizationId, organizationId)));
    }
    if (nouveau) {
      await tx
        .update(suppliers)
        .set({ plotsCount: sql`${suppliers.plotsCount} + 1`, updatedAt: new Date() })
        .where(and(eq(suppliers.id, nouveau), eq(suppliers.organizationId, organizationId)));
    }
  }

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "UPDATE",
    entityType: "PLOT",
    entityId: id,
    avant: (avant ?? null) as unknown as Record<string, unknown> | null,
    apres: row as unknown as Record<string, unknown>,
    details: { fields: Object.keys(patch) },
  });

  return NextResponse.json(toPlot(row, null));
});

export const DELETE = guard<{ params: Promise<{ id: string }> }>("plot:write")(async (
  _request: Request,
  context,
  { tx, organizationId, session },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Parcelle introuvable" }, { status: 404 });

  // ------------------------------------------------------------------ P1-10
  // ⚠️ La parcelle n'est pas détruite : elle est marquée. Une parcelle
  //   effacée emporterait avec elle la géométrie déclarée, les audits qui s'y
  //   rattachent par sa référence, et jusqu'à la possibilité de dire qu'elle a
  //   existé. C'est la politique RLS qui la retire de la vue du produit ; la
  //   ligne demeure, et le privilège `DELETE` est retiré au rôle applicatif
  //   pour qu'aucune route ne puisse l'effacer par inadvertance.
  //
  // ⚠️ L'écriture passe par `gf_marquer_suppression()` et non par un simple
  //   `update`, et c'est une contrainte du moteur, pas un choix de style :
  //   PostgreSQL applique la clause `using` des politiques `select` à la
  //   **nouvelle** ligne d'un `update`. Comme la politique de lecture masque
  //   les lignes effacées (`deleted_at is null`), écrire `deleted_at` par un
  //   `update` ordinaire échoue — « new row violates row-level security
  //   policy ». Mesuré sur l'instance : la route répondait 500. La fonction
  //   `security definer` rétablit le cloisonnement à la main, et c'est le
  //   prix assumé de la garantie « aucune suppression physique ».
  const [avant] = await tx
    .select()
    .from(plots)
    .where(and(eq(plots.id, id), eq(plots.organizationId, organizationId)))
    .limit(1);
  if (!avant) return NextResponse.json({ detail: "Parcelle introuvable" }, { status: 404 });

  const marque = await tx.execute(
    sql`select gf_marquer_suppression('gf_plots'::regclass, ${id}::uuid, ${session.user.email}) as ligne`,
  );
  const ligne = (marque.rows[0] as { ligne: Record<string, unknown> } | undefined)?.ligne;
  // ⚠️ `null` recouvre trois cas volontairement indistinguables : la parcelle
  //   n'existe pas, elle est d'une autre organisation, ou elle est déjà
  //   marquée. Répondre différemment renseignerait sur ce qui existe ailleurs.
  if (!ligne) return NextResponse.json({ detail: "Parcelle introuvable" }, { status: 404 });

  const fournisseurId = (ligne.supplier_id as string | null) ?? null;
  if (fournisseurId) {
    await tx
      .update(suppliers)
      .set({ plotsCount: sql`greatest(${suppliers.plotsCount} - 1, 0)`, updatedAt: new Date() })
      .where(and(eq(suppliers.id, fournisseurId), eq(suppliers.organizationId, organizationId)));
  }

  await logAction(
    tx,
    organizationId,
    actionSuppression(session, "PLOT", id, ligne),
  );

  return new Response(null, {
    status: 204,
    headers: {
      // Le produit répond 204 comme avant ; il dit néanmoins ce qu'il a fait,
      // car « supprimé » recouvre deux réalités que l'exploitant doit
      // distinguer : la ligne n'existe plus, ou elle n'est plus visible.
      "X-GeoForest-Deletion": "logique",
    },
  });
});
