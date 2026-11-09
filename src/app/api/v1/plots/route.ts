import { lireCorpsJson } from "@/lib/api/body";
import { plots, suppliers } from "@/db/schema";
import type { Commodity, Plot, RiskLevel } from "@/lib/eudr/types";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";
import { validateGeometry } from "@/lib/eudr/gis-validator";
import { bboxDeGeometrie, comparerParcelles, type Bbox } from "@/lib/eudr/chevauchement";

export const dynamic = "force-dynamic";

/**
 * P0-08 — liste et création des parcelles.
 *
 * ⚠️ Aucune donnée de démonstration : une base vide renvoie une liste vide.
 * ⚠️ Aucune erreur de persistance avalée (P0-07).
 */

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

export const GET = guard("plot:read")(async (request: Request, _ctx, { tx, organizationId }): Promise<Response> => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "200") || 200, 1), 500);

  const filters = [eq(plots.organizationId, organizationId)];
  if (q) {
    const like = `%${q}%`;
    filters.push(or(ilike(plots.name, like), ilike(plots.reference, like))!);
  }
  if (status) filters.push(eq(plots.status, status));

  const rows = await tx
    .select({
      plot: plots,
      supplierName: suppliers.name,
    })
    .from(plots)
    .leftJoin(suppliers, eq(suppliers.id, plots.supplierId))
    .where(and(...filters))
    .orderBy(desc(plots.createdAt))
    .limit(limit);

  return NextResponse.json(rows.map((r) => toPlot(r.plot, r.supplierName)));
});

export const POST = guard("plot:write")(async (request: Request, _ctx, { tx, organizationId, session }): Promise<Response> => {
  // Le texte brut du corps est conservé : la précision des coordonnées se
  // mesure sur les littéraux envoyés par le client, pas sur une
  // re-sérialisation. Un simple `JSON.stringify(body.geometry)` détruirait les
  // zéros finaux (-5.500000 → -5.5) et provoquerait un rejet à tort — c'est
  // précisément le défaut corrigé au chantier P0-05.
  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const rawText = lecture.texte;
  const body = lecture.value as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const name = str(body.name);
  if (name.length < 2) return NextResponse.json({ detail: "Nom de parcelle requis (≥ 2 caractères)" }, { status: 422 });

  const countryCode = str(body.countryCode).toUpperCase() || "XX";
  if (!/^[A-Z]{2}$/.test(countryCode)) return NextResponse.json({ detail: "Code pays invalide" }, { status: 422 });

  const commodity = str(body.commodity);
  if (!commodity) return NextResponse.json({ detail: "Matière première requise" }, { status: 422 });

  const supplierId = str(body.supplierId);
  if (supplierId && !UUID_PATTERN.test(supplierId)) {
    return NextResponse.json({ detail: "Fournisseur invalide" }, { status: 422 });
  }
  if (supplierId) {
    // Le fournisseur doit appartenir au tenant : jamais une simple confiance
    // dans l'identifiant fourni (P0-02).
    const [owner] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, organizationId)))
      .limit(1);
    if (!owner) return NextResponse.json({ detail: "Fournisseur introuvable" }, { status: 404 });
  }

  // La géométrie peut être transmise sous forme de **texte brut**
  // (`geometry_text`), ce qui préserve les décimales écrites par
  // l'utilisateur. Un objet JSON re-sérialisé les détruit : `-5.500000`
  // devient `-5.5`, et la règle des 6 décimales rejetterait alors une
  // géométrie parfaitement conforme (faux rejet, cf. P0-05).
  let geometry: unknown = body.geometry;
  let precisionSource = rawText;
  if (typeof body.geometry_text === "string" && body.geometry_text.trim()) {
    precisionSource = body.geometry_text;
    try {
      geometry = JSON.parse(body.geometry_text);
    } catch {
      return NextResponse.json({ detail: "Géométrie invalide : texte GeoJSON illisible" }, { status: 422 });
    }
  }
  if (!geometry || typeof geometry !== "object") {
    return NextResponse.json({ detail: "Géométrie requise (geometry ou geometry_text)" }, { status: 422 });
  }

  const validation = validateGeometry(geometry as never, { rawText: precisionSource });
  if (!validation.valid || !validation.normalized_geometry) {
    return NextResponse.json(
      {
        detail: validation.errors[0]?.message ?? "Géométrie invalide",
        errors: validation.errors,
        warnings: validation.warnings,
      },
      { status: 422 },
    );
  }
  // Contrôle de nullité fait ci-dessus, mais le compilateur ne le suit pas
  // à travers la garde : on réaffirme explicitement.
  const normalized = validation.normalized_geometry;
  if (!normalized) {
    return NextResponse.json({ detail: "Géométrie non exploitable", errors: validation.errors }, { status: 422 });
  }

  // ------------------------------------------------------------------- C8
  //
  // ⚠️ Le chevauchement est détecté AVANT l'insertion, mais n'empêche pas
  //   l'insertion. Décision assumée : deux parcelles voisines partagent une
  //   clôture, et refuser en 422 sur un simple contact bloquerait un découpage
  //   parfaitement légitime. Ce que le produit doit faire, c'est CONSTATER et
  //   RENDRE VISIBLE — pas trancher à la place de l'exploitant.
  //
  //   Le contrôle porte sur toute l'organisation, pas sur le seul fournisseur :
  //   un doublon entre deux fournisseurs est exactement le cas qu'on veut
  //   attraper, et la RLS borne déjà la lecture à l'organisation.
  //
  //   Limite écrite (docs/EUDR_COMPLIANCE_GUIDE.md) : deux organisations
  //   clientes différentes ne se voient pas. Deux exploitations voisines
  //   peuvent donc se recouvrir sans que le produit le sache.
  const bbox: Bbox | null = bboxDeGeometrie(normalized);
  const recoupements: Array<{ id: string; name: string; verdict: string }> = [];
  if (bbox) {
    // Pré-filtre en SQL sur le cadre englobant : une parcelle dont le cadre ne
    // recoupe pas le nôtre ne peut pas le chevaucher, et les exclure ici évite
    // de charger des géométries inutiles.
    const candidates = await tx
      .select({ id: plots.id, name: plots.name, geometry: plots.geometry, bboxMinLon: plots.bboxMinLon, bboxMinLat: plots.bboxMinLat, bboxMaxLon: plots.bboxMaxLon, bboxMaxLat: plots.bboxMaxLat })
      .from(plots)
      .where(
        and(
          eq(plots.organizationId, organizationId),
          isNull(plots.deletedAt),
          sql`${plots.bboxMaxLon} is not null`,
          sql`${plots.bboxMinLon} <= ${bbox[2]}`,
          sql`${plots.bboxMaxLon} >= ${bbox[0]}`,
          sql`${plots.bboxMinLat} <= ${bbox[3]}`,
          sql`${plots.bboxMaxLat} >= ${bbox[1]}`,
        ),
      )
      .limit(200);

    for (const c of candidates) {
      const verdict = comparerParcelles(normalized, c.geometry);
      // Le CONTACT est écarté : c'est le cas normal d'une limite partagée. Ne
      // remonter que le recouvrement est ce qui rend l'alerte crédible — un
      // signal qui se déclenche sur les cas normaux n'est plus lu.
      if (verdict === "RECOUVREMENT") recoupements.push({ id: c.id, name: c.name, verdict });
    }
  }

  const [row] = await tx
    .insert(plots)
    .values({
      organizationId,
      supplierId: supplierId || null,
      name,
      reference: str(body.reference) || null,
      commodity,
      countryCode,
      geometry: normalized,
      geometryType: normalized.type,
      areaHa: validation.area_ha,
      vertexCount: validation.vertex_count,
      centroidLon: validation.centroid?.[0] ?? 0,
      centroidLat: validation.centroid?.[1] ?? 0,
      bboxMinLon: bbox?.[0] ?? null,
      bboxMinLat: bbox?.[1] ?? null,
      bboxMaxLon: bbox?.[2] ?? null,
      bboxMaxLat: bbox?.[3] ?? null,
      status: "PENDING",
    })
    .returning();

  // Le compteur dénormalisé doit refléter la réalité : sans cela, un
  // fournisseur rattaché à des parcelles continue d'apparaître comme
  // « sans parcelle » dans les alertes et dans la complétude.
  if (supplierId) {
    await tx
      .update(suppliers)
      .set({ plotsCount: sql`${suppliers.plotsCount} + 1`, updatedAt: new Date() })
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, organizationId)));
  }

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "CREATE",
    entityType: "PLOT",
    entityId: row.id,
    apres: row as unknown as Record<string, unknown>,
    details: {
      name,
      areaHa: validation.area_ha,
      geometryType: normalized.type,
      // ⚠️ Le recoupement est JOURNALISÉ, pas seulement renvoyé dans la
      //   réponse. Un avertissement qui n'existe que dans un corps HTTP est
      //   perdu dès que l'écran ne l'affiche pas — c'est le défaut du
      //   `completenessScore` reçu du client, corrigé en C7. Le journal, lui,
      //   reste relisible après coup.
      recoupements: recoupements.map((r) => ({ id: r.id, name: r.name })),
    },
  });

  return NextResponse.json({ ...toPlot(row, null), recoupements }, { status: 201 });
});
