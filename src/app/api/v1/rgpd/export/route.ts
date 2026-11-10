import { NextResponse } from "next/server";

import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";
import { exporterDonneesOrganisation } from "@/lib/rgpd/export-donnees";

export const dynamic = "force-dynamic";

/**
 * Export des données de l'organisation — art. 15 et 20 du RGPD.
 *
 * ⚠️ L'organisation n'est JAMAIS lue dans la requête.
 *
 *   Elle vient de la session (`organizationId` du garde), comme partout
 *   ailleurs. Un `?organizationId=` accepté ici rendrait l'export lui-même
 *   l'instrument de la fuite qu'il est censé permettre de constater.
 *
 * ⚠️ La demande est journalisée.
 *
 *   Un export de données personnelles est un traitement : il doit laisser une
 *   trace, comme les autres. La ligne ne contient pas les données exportées —
 *   seulement le fait qu'un export a eu lieu, par qui, et quand.
 *
 * ⚠️ Réservé aux administrateurs de l'organisation (`org:manage`).
 *
 *   Ce n'est pas une restriction de confort : l'export contient les données
 *   personnelles de tous les membres et de tous les fournisseurs. Un lecteur
 *   n'a pas à les recevoir en bloc.
 */
export const GET = guard("org:manage")(async (_request, _ctx, { tx, organizationId, session }): Promise<Response> => {
  const exportation = await exporterDonneesOrganisation(tx as never, organizationId);

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "EXPORT",
    entityType: "ORGANIZATION",
    entityId: organizationId,
    details: {
      objet: "export_rgpd",
      // Le VOLUME est consigné, pas le contenu : un journal qui recopierait
      // l'export deviendrait lui-même un second exemplaire des données
      // personnelles, et il est immuable.
      rubriques: Object.keys(exportation.donnees).length,
      non_exporte: exportation.non_exporte.length,
    },
  });

  return NextResponse.json(exportation, {
    status: 200,
    headers: {
      // Un export de données personnelles ne doit pas rester dans un cache
      // intermédiaire, ni être indexé.
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
});
