import { complianceTasks, documents } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * Compteurs de la navigation.
 *
 * ⚠️ P0-09 : les badges affichaient « 3 à revoir », « 2 critiques » et « 2 » de
 * façon permanente, quel que soit le contenu de la base. Ils sont désormais
 * calculés. Un compteur nul n'est pas affiché : l'absence de badge doit
 * signifier l'absence d'élément, pas un oubli d'affichage.
 */
export const GET = guard()(async (_request: Request, _ctx, { tx, organizationId }): Promise<Response> => {
  const [row] = await tx
    .select({
      documentsToReview: sql<number>`count(*) filter (where ${documents.status} = 'TO_VERIFY')`,
    })
    .from(documents)
    .where(eq(documents.organizationId, organizationId));

  const counts: Record<string, number> = {
    "/documents": Number(row?.documentsToReview ?? 0),
  };

  // Les compteurs suivants exigent des permissions que l'appelant peut ne pas
  // avoir : on ne les calcule que si c'est pertinent, et un échec de permission
  // donne 0 plutôt qu'une erreur — un badge n'est pas une donnée critique.
  try {
    const [tasks] = await tx
      .select({ critical: sql<number>`count(*) filter (where ${complianceTasks.severity} = 'CRITICAL')` })
      .from(complianceTasks)
      .where(
        and(
          eq(complianceTasks.organizationId, organizationId),
          sql`${complianceTasks.status} in ('TO_HANDLE','IN_PROGRESS')`,
        ),
      );
    counts["/risks"] = Number(tasks?.critical ?? 0);
  } catch {
    counts["/risks"] = 0;
  }

  return NextResponse.json({ counts });
});
