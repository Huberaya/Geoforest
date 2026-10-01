import type { Alert } from "@/lib/eudr/types";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { countAlerts, deriveAlerts } from "@/lib/api/alerts";

export const dynamic = "force-dynamic";

/**
 * Alertes **calculées** à partir des données réelles du tenant.
 *
 * ⚠️ Aucune alerte n'est codée en dur. Un tenant sans donnée obtient une liste
 * vide — ce qui est une information exacte, pas une absence de fonctionnalité.
 * Le tableau de bord affichait auparavant « 2 alertes critiques » de façon
 * permanente, quel que soit le contenu de la base (P0-09).
 */
export const GET = guard("risk:read")(async (_request: Request, _ctx, { tx, organizationId }): Promise<Response> => {
  const alerts: Alert[] = await deriveAlerts(tx, organizationId);

  return NextResponse.json({
    alerts,
    counts: countAlerts(alerts),
    // Dit ce qui est calculé et ce qui ne l'est pas.
    derived_from: ["documents", "parcel_audits (analyses probantes)", "compliance_tasks", "suppliers", "plots"],
  });
});
