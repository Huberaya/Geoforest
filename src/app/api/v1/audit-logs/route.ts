import { auditLogs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * Journal d'audit du tenant.
 *
 * Le cloisonnement est assuré par la politique RLS sur `gf_audit_logs` et par
 * le filtre explicite ci-dessous : un tenant ne lit jamais les événements d'un
 * autre, même si le contexte de transaction était mal posé.
 */
export const GET = guard("audit:read")(async (request: Request, _ctx, { tx, organizationId }): Promise<Response> => {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "200") || 200, 1), 500);
  const action = url.searchParams.get("action")?.trim();

  const rows = await tx
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, organizationId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  const filtered = action ? rows.filter((r) => r.action === action) : rows;

  /**
   * ⚠️ P1-10 — l'identité de l'auteur est rendue **complète**, et l'avant /
   * l'après sont rendus tels quels.
   *
   * L'écran d'audit affichait « un utilisateur a modifié le fournisseur ».
   * Cela ne permet ni de savoir **qui** exactement (l'e-mail change, l'identifiant
   * non), ni **quoi** (la liste des champs n'est pas la valeur). Les deux sont
   * désormais dans la réponse.
   */
  return NextResponse.json(
    filtered.map((r) => ({
      id: r.id,
      userEmail: r.userEmail,
      acteurId: r.acteurId,
      acteurRole: r.acteurRole,
      requestId: r.requestId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      details: (r.details as Record<string, unknown> | null) ?? null,
      avant: (r.avant as Record<string, unknown> | null) ?? null,
      apres: (r.apres as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt.toISOString(),
      // Le rang dans la chaîne, et le fait que le condensat soit présent :
      // c'est ce qui permet à un lecteur de vérifier qu'aucune ligne n'a été
      // retirée entre deux numéros.
      sequence: r.sequence,
      chaine: r.hash ? "scellée" : "non_scellée",
    })),
  );
});
