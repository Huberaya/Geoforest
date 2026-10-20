/**
 * Consommation atomique d'un jeton de rafraîchissement.
 *
 * ⚠️ Pourquoi cette fonction existe séparément.
 *
 *   La rotation lisait la session, vérifiait `revoked_at`, puis écrivait la
 *   révocation — trois étapes séparées. Deux requêtes simultanées portant le
 *   **même** jeton passaient toutes les deux la vérification avant qu'aucune
 *   n'ait écrit : chacune recevait une session neuve, et la détection de rejeu
 *   ne se déclenchait jamais. C'est exactement le scénario qu'un attaquant
 *   cherche lorsqu'il a volé un jeton : rejouer en parallèle pour conserver
 *   l'accès.
 *
 *   La consommation est donc une **seule** instruction `UPDATE … RETURNING`,
 *   dont la clause `WHERE` porte les trois conditions (jeton, non révoqué,
 *   non expiré). PostgreSQL sérialise les écritures concurrentes sur la ligne :
 *   une seule requête peut la faire passer de « active » à « consommée ».
 *   La seconde ne trouve plus rien, et c'est cette absence qui déclenche la
 *   révocation de la famille.
 *
 * Le module ne dépend ni de `next/headers`, ni de `server-only` : il est
 * testable contre une base réelle (PGlite) sans monter l'application.
 */
import { sql, type SQL } from "drizzle-orm";

/** Surface minimale attendue d'un client Drizzle (node-postgres ou PGlite). */
export interface ExecuteurSql {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface SessionConsommee {
  id: string;
  userId: string;
  familyId: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
}

function texteOuNull(valeur: unknown): string | null {
  return typeof valeur === "string" ? valeur : null;
}

/**
 * Marque le jeton comme consommé et renvoie la session correspondante.
 *
 * `null` signifie : inconnu, déjà consommé, ou expiré. L'appelant distingue le
 * rejeu de l'expiration par une lecture séparée (cf. `session.ts`).
 */
export async function consommerJetonRefresh(
  db: ExecuteurSql,
  hash: string,
): Promise<SessionConsommee | null> {
  const resultat = await db.execute(sql`
    update gf_sessions
       set revoked_at = now(), last_used_at = now()
     where refresh_token_hash = ${hash}
       and revoked_at is null
       and expires_at > now()
    returning id, user_id, family_id, user_agent, ip, expires_at
  `);

  const ligne = resultat.rows[0];
  if (!ligne) return null;

  const expiresAt = ligne.expires_at instanceof Date
    ? ligne.expires_at
    : new Date(String(ligne.expires_at));

  return {
    id: String(ligne.id),
    userId: String(ligne.user_id),
    familyId: String(ligne.family_id),
    userAgent: texteOuNull(ligne.user_agent),
    ip: texteOuNull(ligne.ip),
    expiresAt,
  };
}

/**
 * Révoque toutes les sessions encore actives d'une famille.
 *
 * Appelée lorsque le jeton présenté a déjà été consommé : c'est la signature
 * d'un rejeu, et la réponse doit être de fermer la famille entière plutôt que
 * de laisser l'attaquant conserver la branche qu'il a obtenue.
 */
export async function revoquerFamille(db: ExecuteurSql, familyId: string): Promise<void> {
  await db.execute(sql`
    update gf_sessions
       set revoked_at = now()
     where family_id = ${familyId}
       and revoked_at is null
  `);
}
