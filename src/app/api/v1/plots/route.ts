import { lireCorpsJson } from "@/lib/api/body";
import { plots, suppliers } from "@/db/schema";
import type { Commodity, Plot, RiskLevel } from "@/lib/eudr/types";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";
import { validateGeometry } from "@/lib/eudr/gis-validator";

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
    details: { name, areaHa: validation.area_ha, geometryType: normalized.type },
  });

  return NextResponse.json(toPlot(row, null), { status: 201 });
});
