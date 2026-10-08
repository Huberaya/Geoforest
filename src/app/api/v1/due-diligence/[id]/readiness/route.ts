import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { aujourdhuiIso, chargerDossier } from "@/lib/eudr/readiness-db";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * P0 (recette 2026-10-08) — état de readiness détaillé d'un dossier : chaque
 * contrôle, chaque blocage, chaque manque, et le risque décomposé par facteur.
 */
export const GET = guard<{ params: Promise<{ id: string }> }>("dds:read")(async (
  _request: Request,
  context,
  { tx, organizationId },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });
  const charge = await chargerDossier(tx, organizationId, id, aujourdhuiIso());
  if (!charge) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });
  return NextResponse.json({
    dossier_id: id,
    reference: charge.dds.reference,
    statut_dossier: charge.dds.status,
    ...charge.resultat,
    transmission_status: "NOT_TRANSMITTED",
    avertissement:
      "« Prêt pour déclaration » signifie que le dossier est complet et validé en interne. " +
      "Aucune transmission au système d'information EUDR n'a été effectuée.",
  });
});
