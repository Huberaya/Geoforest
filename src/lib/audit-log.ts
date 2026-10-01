import "server-only";

import { dbAdmin as db } from "@/db/admin";
import { auditLogs } from "@/db/schema";

export interface AuditEvent {
  organizationId?: string | null;
  userEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
}

/**
 * Journal d'audit applicatif.
 *
 * ⚠️ L'écriture du journal ne doit jamais faire échouer l'opération métier,
 * mais elle ne doit pas non plus être silencieuse : un échec est tracé.
 * (Le journal inaltérable append-only reste à construire — cf. P1-10.)
 */
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      organizationId: event.organizationId ?? null,
      userEmail: event.userEmail,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      details: event.details ?? null,
    });
  } catch (error) {
    console.error("[audit] échec d'écriture du journal", {
      action: event.action,
      entityId: event.entityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
