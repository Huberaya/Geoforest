import { lireCorpsJson } from "@/lib/api/body";
import { plots, suppliers } from "@/db/schema";
import { supplierCompleteness, UNKNOWN_COUNTRY } from "@/lib/eudr/completeness";
import type { Commodity, RiskLevel, Supplier } from "@/lib/eudr/types";
import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";

export const dynamic = "force-dynamic";

/**
 * ⚠️ P0-09 — la complétude affichée est **calculée**, jamais stockée ni
 * estimée. Avant ce chantier, tout fournisseur créé recevait un score de 30,
 * sans rapport avec les données réellement saisies.
 *
 * Le nombre de parcelles est compté par jointure, et non lu depuis la colonne
 * `plots_count` : cette colonne n'était tenue à jour que par le portail
 * fournisseur, si bien qu'une parcelle créée depuis l'écran Parcelles ne
 * s'y reflétait pas (et déclenchait à tort l'alerte « aucune parcelle »).
 *
 * NB : une sous-requête corrélée écrite avec le template `sql` de Drizzle est
 * rendue sans qualification de table (`"supplier_id" = "id"`), et `"id"` s'y
 * résout alors en `gf_plots.id` — le comptage tombait toujours à zéro. La
 * jointure explicite évite ce piège.
 */

export const GET = guard("supplier:read")(async (request: Request, _ctx, { tx, organizationId }) => {
  const url = new URL(request.url);
  const commodity = url.searchParams.get("commodity");
  const country = url.searchParams.get("country");
  const risk = url.searchParams.get("risk");

  // Cloisonnement : aucune requête ne sort du périmètre de l'organisation.
  const rows = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
      eori: suppliers.eori,
      country: suppliers.country,
      commodity: suppliers.commodity,
      contactName: suppliers.contactName,
      contactEmail: suppliers.contactEmail,
      contactPhone: suppliers.contactPhone,
      riskLevel: suppliers.riskLevel,
      status: suppliers.status,
      plotsCount: sql<number>`count(${plots.id})`,
      createdAt: suppliers.createdAt,
    })
    .from(suppliers)
    .leftJoin(plots, eq(plots.supplierId, suppliers.id))
    .where(eq(suppliers.organizationId, organizationId))
    .groupBy(suppliers.id)
    .orderBy(desc(suppliers.createdAt));

  let result: Supplier[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    eori: r.eori,
    country: r.country,
    commodity: r.commodity as Commodity,
    contactName: r.contactName,
    contactEmail: r.contactEmail,
    contactPhone: r.contactPhone,
    completenessScore: supplierCompleteness({ ...r, plotsCount: Number(r.plotsCount ?? 0) }),
    riskLevel: r.riskLevel as RiskLevel,
    status: r.status as "ACTIVE" | "PENDING_INVITE" | "SUSPENDED",
    plotsCount: Number(r.plotsCount ?? 0),
    createdAt: r.createdAt.toISOString(),
  }));

  if (commodity) result = result.filter((s) => s.commodity === commodity);
  if (country) result = result.filter((s) => s.country === country);
  if (risk) result = result.filter((s) => s.riskLevel === risk);
  return NextResponse.json(result);
});

export const POST = guard("supplier:write")(async (request: Request, _ctx, { tx, organizationId, session }) => {
  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  try {
    const body = lecture.value as Record<string, unknown>;
    if (!body.name || !body.commodity) {
      return NextResponse.json({ detail: "Nom et matière première requis" }, { status: 422 });
    }

    // Le pays n'est **pas** deviné : à défaut de saisie, il reste non renseigné
    // (`XX`) et l'écran le signale. L'ancienne valeur par défaut « CI » faisait
    // apparaître la Côte d'Ivoire pour des fournisseurs dont on ignorait
    // l'origine — une donnée de conformité inventée.
    const country = body.country ? String(body.country).trim().toUpperCase() : UNKNOWN_COUNTRY;

    const newSupplier = {
      id: crypto.randomUUID(),
      name: String(body.name).trim(),
      eori: body.eori ? String(body.eori).trim().toUpperCase() : null,
      country,
      commodity: body.commodity as Commodity,
      contactName: body.contactName ? String(body.contactName).trim() : null,
      contactEmail: body.contactEmail ? String(body.contactEmail).trim() : null,
      contactPhone: body.contactPhone ? String(body.contactPhone).trim() : null,
      // Complétude calculée sur les champs réellement fournis, pas une constante.
      completenessScore: supplierCompleteness({
        name: String(body.name).trim(),
        country,
        eori: body.eori ? String(body.eori).trim().toUpperCase() : null,
        contactName: body.contactName ? String(body.contactName).trim() : null,
        contactEmail: body.contactEmail ? String(body.contactEmail).trim() : null,
        contactPhone: body.contactPhone ? String(body.contactPhone).trim() : null,
        plotsCount: 0,
      }),
      riskLevel: "STANDARD" as RiskLevel,
      status: "ACTIVE" as const,
      plotsCount: 0,
      createdAt: new Date().toISOString(),
    };

    await tx.insert(suppliers).values({
      organizationId,
      id: newSupplier.id,
      name: newSupplier.name,
      eori: newSupplier.eori,
      country: newSupplier.country,
      commodity: newSupplier.commodity,
      contactName: newSupplier.contactName,
      contactEmail: newSupplier.contactEmail,
      contactPhone: newSupplier.contactPhone,
      completenessScore: newSupplier.completenessScore,
      riskLevel: newSupplier.riskLevel,
      status: newSupplier.status,
      plotsCount: 0,
    });

    // ---------------------------------------------------------------- P1-10
    // ⚠️ Un fournisseur créé sans laisser de trace est un fournisseur dont
    //   rien n'atteste l'origine : impossible de dire qui l'a déclaré, ni
    //   quand. C'est la lacune mesurée au début du chantier (création en 201,
    //   journal vide).
    await logAction(tx, organizationId, {
      userEmail: session.user.email,
      acteurId: session.user.id,
      acteurRole: session.user.role,
      action: "CREATE",
      entityType: "SUPPLIER",
      entityId: newSupplier.id,
      apres: newSupplier as unknown as Record<string, unknown>,
      details: { pays: country, matiere: newSupplier.commodity },
    });

    return NextResponse.json(newSupplier, { status: 201 });
  } catch (error) {
    // Un corps JSON illisible est une erreur client ; toute autre erreur
    // (contrainte de base, indisponibilité) est propagée : elle ne doit pas
    // être déguisée en 400 ni avalée (cf. P0-07).
    if (error instanceof SyntaxError) {
      return NextResponse.json({ detail: "Corps JSON invalide" }, { status: 400 });
    }
    throw error;
  }
});
