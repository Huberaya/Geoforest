import "server-only";

import { auditLogs } from "@/db/schema";
import { sql } from "drizzle-orm";
import { contexteCourant } from "@/lib/observability/contexte";
import type { TenantTx } from "@/lib/tenant";

/**
 * Journal d'audit.
 *
 * ⚠️ Deux pièges, tous deux rencontrés et corrigés ici :
 *
 * 1. **L'organisation doit être fournie explicitement.** La politique RLS de
 *    `gf_audit_logs` exige `organization_id = current_org()`. Un insert sans
 *    organisation est rejeté — et, l'erreur étant avalée, la transaction
 *    entière était annulée : la route renvoyait 201 alors que RIEN n'était
 *    enregistré. C'est exactement le défaut du chantier P0-07.
 *    L'identifiant vient donc du contexte de la session, jamais du corps de
 *    requête.
 *
 * 2. **La journalisation ne doit pas empoisonner la transaction.** Une erreur
 *    dans une transaction PostgreSQL la place en état « aborted » : toute
 *    instruction suivante échoue, et le COMMIT final annule tout. On encadre
 *    donc l'écriture d'un point de sauvegarde : si le journal échoue, on
 *    revient au point de sauvegarde et l'action métier aboutit quand même.
 *
 * ⚠️ P1-10 — ce que le journal doit contenir pour être opposable.
 *   Consigner « le fournisseur a été modifié » ne répond à aucune question :
 *   un contrôleur demande **quoi**, **par qui**, et **de quelle valeur à quelle
 *   valeur**. Chaque ligne porte donc l'avant, l'après, l'identité de l'auteur
 *   (et pas seulement son e-mail, qui peut changer), son rôle au moment des
 *   faits, et l'identifiant de corrélation qui la relie au journal applicatif.
 */

export interface AuditAction {
  userEmail: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "AUDIT" | "EXPORT" | "VALIDATE" | "LOGIN" | "ACCESS_DENIED" | "PURGE";
  entityType: "SUPPLIER" | "PRODUCT" | "SHIPMENT" | "PLOT" | "DOCUMENT" | "DDS" | "TASK" | "SETTINGS" | "SESSION" | "AUDIT";
  entityId: string;
  details?: Record<string, unknown>;
  /**
   * État **complet** de l'entité avant l'opération.
   *
   * ⚠️ Complet, pas « les champs modifiés » : savoir quels champs ont bougé
   *   suppose de savoir lesquels existaient. Une liste de noms de champs
   *   (`{"fields":["name"]}`) est ce que produisait l'ancienne version, et
   *   elle ne permet pas de répondre « quelle était la valeur d'avant ? ».
   */
  avant?: Record<string, unknown> | null;
  /** État complet de l'entité après l'opération. */
  apres?: Record<string, unknown> | null;
  /** Identifiant de l'utilisateur, quand il est connu. */
  acteurId?: string | null;
  /** Rôle au moment de l'action : la même personne n'a pas les mêmes droits selon son rôle. */
  acteurRole?: string | null;
}

/**
 * Clés qui ne doivent **jamais** atteindre le journal, même dans un avant/après.
 *
 * ⚠️ Un avant/après est, par nature, une copie de la ligne entière : c'est
 *   justement ce qui le rend utile, et c'est aussi ce qui le rend dangereux.
 *   La moindre clé sensible oubliée finirait par y être écrite en clair — et
 *   dans une table qu'on ne peut plus ni modifier ni effacer.
 */
const CLES_SENSIBLES = /^(password|password_hash|mot_de_passe|token|refresh|secret|authorization|cookie|api_?key|mfa_secret|mfa_recovery_codes|recovery_codes|passwordhash)$/i;
const MOTIFS_SENSIBLES = /(password|passwd|secret|token|apikey|api_key|authorization|cookie)/i;

const MASQUE = "[masqué]";

/**
 * Copie défensive et nettoyée d'un enregistrement.
 *
 * ⚠️ Deux bornes, sans lesquelles une ligne métier suffirait à saturer le
 *   journal : la profondeur, et la taille des chaînes. Une géométrie de
 *   parcelle compte des dizaines de milliers de sommets — la recopier dans
 *   chaque avant/après d'un dossier rendrait le journal plus gros que les
 *   données qu'il décrit.
 */
function nettoyer(valeur: unknown, profondeur = 0): unknown {
  if (valeur === null || valeur === undefined) return null;
  if (profondeur > 6) return "[tronqué]";

  if (valeur instanceof Date) return valeur.toISOString();
  if (typeof valeur === "string") return valeur.length > 2000 ? valeur.slice(0, 2000) + "…" : valeur;
  if (typeof valeur === "number" || typeof valeur === "boolean") return valeur;

  if (Array.isArray(valeur)) {
    // ⚠️ Une géométrie est un tableau de sommets : on en garde la forme et le
    //   volume, jamais le détail. Le condensat permet de prouver qu'elle n'a
    //   pas changé sans la recopier.
    if (valeur.length > 100) {
      return { __resume: `${valeur.length} élément(s)`, __tronque: true };
    }
    return valeur.slice(0, 100).map((v) => nettoyer(v, profondeur + 1));
  }

  if (typeof valeur === "object") {
    const source = valeur as Record<string, unknown>;
    const sortie: Record<string, unknown> = {};
    for (const [cle, v] of Object.entries(source)) {
      if (CLES_SENSIBLES.test(cle) || MOTIFS_SENSIBLES.test(cle)) {
        sortie[cle] = MASQUE;
      } else {
        sortie[cle] = nettoyer(v, profondeur + 1);
      }
    }
    return sortie;
  }

  return String(valeur);
}

/**
 * Réduit un avant et un après à la liste des champs **qui ont changé**.
 *
 * Renvoie `{ champ: { avant, apres } }`. Les champs identiques n'y figurent pas :
 * c'est ce qui rend une relecture exploitable — un contrôleur voit les trois
 * champs qui ont bougé, pas les trente qui n'ont pas bougé.
 */
export function diffChamps(
  avant: Record<string, unknown> | null | undefined,
  apres: Record<string, unknown> | null | undefined,
): Record<string, { avant: unknown; apres: unknown }> {
  const a = (avant ?? {}) as Record<string, unknown>;
  const b = (apres ?? {}) as Record<string, unknown>;
  const sortie: Record<string, { avant: unknown; apres: unknown }> = {};
  for (const cle of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = JSON.stringify(a[cle] ?? null);
    const vb = JSON.stringify(b[cle] ?? null);
    if (va !== vb) sortie[cle] = { avant: a[cle] ?? null, apres: b[cle] ?? null };
  }
  return sortie;
}

/**
 * Consigne un événement dans le journal du tenant.
 *
 * @param organizationId Organisation de la session — jamais une valeur
 *   provenant du client.
 */
export async function logAction(tx: TenantTx, organizationId: string, entry: AuditAction): Promise<void> {
  await tx.execute(sql`savepoint audit_log_write`);
  try {
    const avant = entry.avant ? (nettoyer(entry.avant) as Record<string, unknown>) : null;
    const apres = entry.apres ? (nettoyer(entry.apres) as Record<string, unknown>) : null;

    // ⚠️ Les champs réellement modifiés sont consignés avec l'avant et l'après,
    //   à côté des informations propres à la route. Les recalculer à la lecture
    //   obligerait chaque lecteur à refaire la comparaison — donc à pouvoir se
    //   tromper, et à la refaire différemment selon l'endroit.
    let details = entry.details ?? null;
    if (avant || apres) {
      const changements = diffChamps(avant, apres);
      if (Object.keys(changements).length > 0) {
        details = { ...(details ?? {}), changements };
      }
    }

    await tx.insert(auditLogs).values({
      organizationId,
      userEmail: entry.userEmail,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      details,
      avant,
      apres,
      acteurId: entry.acteurId ?? null,
      acteurRole: entry.acteurRole ?? null,
      // Corrélation avec le journal applicatif (P1-06) : une ligne d'audit se
      // relie ainsi à toutes les traces de la requête qui l'a produite.
      requestId: contexteCourant()?.requestId ?? null,
    });

    await tx.execute(sql`release savepoint audit_log_write`);
  } catch (error) {
    await tx.execute(sql`rollback to savepoint audit_log_write`);
    // L'échec est signalé côté serveur : il ne doit pas passer inaperçu, mais
    // il ne doit pas non plus faire échouer l'action métier en cours.
    console.error("Journal d'audit : écriture impossible, action non journalisée.", error);
  }
}

/**
 * Journalise la suppression **logique** d'une entité.
 *
 * ⚠️ P1-10 — la ligne n'est pas détruite : elle est marquée, et c'est la
 *   politique RLS qui la retire de la vue de l'application. Ce qui est
 *   consigné ici n'est donc pas un souvenir de la ligne effacée, mais
 *   l'attestation qu'elle a été retirée, par qui, et dans quel état elle se
 *   trouvait — l'état complet est conservé pour pouvoir répondre à « que
 *   contenait ce dossier au moment où il a été retiré ? ».
 */
export function actionSuppression(
  session: { user: { id: string; email: string; role: string } },
  entityType: AuditAction["entityType"],
  entityId: string,
  avant: Record<string, unknown>,
): AuditAction {
  return {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "DELETE",
    entityType,
    entityId,
    avant,
    apres: null,
    details: { suppression: "logique", deletedAt: new Date().toISOString() },
  };
}
