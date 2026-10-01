import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";

/** Type de la transaction fournie aux handlers. */
export type TenantTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TenantContext {
  /** Organisation de la session — jamais issue du corps de requête. */
  organizationId: string;
  /** Transaction avec le contexte RLS posé. */
  tx: TenantTx;
}

/**
 * Exécute une opération dans le contexte d'un tenant.
 *
 * Pose `app.current_org` en variable de session **locale à la transaction** :
 * les politiques RLS s'appliquent alors automatiquement à toutes les requêtes
 * de la transaction, même celles qui oublieraient un filtre.
 *
 * La clause `where organization_id = …` explicite reste exigée dans les routes
 * (défense en profondeur) : la RLS est le filet, pas la stratégie.
 */
export async function withTenant<T>(
  organizationId: string,
  fn: (tx: TenantTx) => Promise<T>,
  options: { isolationLevel?: "read committed" | "repeatable read" | "serializable" } = {},
): Promise<T> {
  return db.transaction(
    async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${organizationId}, true)`);
      return fn(tx);
    },
    options.isolationLevel ? { isolationLevel: options.isolationLevel } : undefined,
  );
}
