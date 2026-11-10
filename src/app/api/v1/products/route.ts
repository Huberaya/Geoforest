import { lireCorpsJson } from "@/lib/api/body";
import { products } from "@/db/schema";
import { COMMODITY_HS_CODES, type Commodity, type Product } from "@/lib/eudr/types";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { paysValide } from "@/lib/eudr/identite-operateur";
import { logAction } from "@/lib/api/audit-log";

export const dynamic = "force-dynamic";


export const GET = guard("product:read")(async (_request: Request, _ctx, { tx, organizationId }) => {
  const rows = await tx
    .select()
    .from(products)
    .where(eq(products.organizationId, organizationId))
    .orderBy(desc(products.createdAt));

  const result: Product[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    sku: r.sku,
    commodity: r.commodity as Commodity,
    hsCode: r.hsCode,
    countryOfOrigin: r.countryOfOrigin,
    annualVolumeKg: r.annualVolumeKg ?? 0,
    status: r.status as "ACTIVE" | "INACTIVE",
    createdAt: r.createdAt.toISOString(),
  }));

  return NextResponse.json(result);
});

/**
 * P0 — normalise un pays d'origine sans en inventer un.
 * Absent → `null`. Présent mais invalide (XX, « FRANCE », etc.) → refus 422.
 */
function countryOfOrigin(valeur: unknown): string | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  if (typeof valeur !== "string") throw new Error("countryOfOrigin doit être une chaîne");
  const code = valeur.trim().toUpperCase();
  if (!paysValide(code)) throw new Error(`countryOfOrigin « ${valeur} » n'est pas un code ISO à deux lettres`);
  return code;
}

export const POST = guard("product:write")(async (request: Request, _ctx, { tx, organizationId, session }) => {
  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  try {
    const body = lecture.value as Record<string, unknown>;
    if (!body.name || !body.commodity) {
      return NextResponse.json({ detail: "Nom et matière première requis" }, { status: 422 });
    }

    const commodity = body.commodity as Commodity;
    const newProduct: Product = {
      id: crypto.randomUUID(),
      name: String(body.name).trim(),
      sku: body.sku ? String(body.sku).trim().toUpperCase() : null,
      commodity,
      hsCode: body.hsCode ? String(body.hsCode).trim() : (COMMODITY_HS_CODES[commodity] ?? "0000"),
      // P0 — pas de pays par défaut : soit déclaré, soit absent (`null`).
      countryOfOrigin: countryOfOrigin(body.countryOfOrigin),
      annualVolumeKg: Number(body.annualVolumeKg) || 0,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };

    await tx.insert(products).values({
        organizationId,
        id: newProduct.id,
        name: newProduct.name,
        sku: newProduct.sku,
        commodity: newProduct.commodity,
        hsCode: newProduct.hsCode,
        countryOfOrigin: newProduct.countryOfOrigin,
        annualVolumeKg: newProduct.annualVolumeKg,
        status: newProduct.status,
      });

    // P1-10 — aucune création ne doit échapper au journal (cf. la lacune
    // mesurée sur les fournisseurs).
    await logAction(tx, organizationId, {
      userEmail: session.user.email,
      acteurId: session.user.id,
      acteurRole: session.user.role,
      action: "CREATE",
      entityType: "PRODUCT",
      entityId: newProduct.id,
      apres: newProduct as unknown as Record<string, unknown>,
    });

    return NextResponse.json(newProduct, { status: 201 });
  } catch (error) {
    // Un corps JSON illisible est une erreur client ; toute autre erreur
    // (contrainte de base, indisponibilité) est propagée : elle ne doit pas
    // être déguisée en 400 ni avalée (cf. P0-07).
    if (error instanceof SyntaxError) {
      return NextResponse.json({ detail: "Corps JSON invalide" }, { status: 400 });
    }
    // P0 — un pays d'origine invalide est une erreur client, pas une panne.
    if (error instanceof Error && error.message.startsWith("countryOfOrigin")) {
      return NextResponse.json(
        { detail: error.message, error: { code: "COUNTRY_OF_ORIGIN_INVALID" } },
        { status: 422 },
      );
    }
    throw error;
  }
});
