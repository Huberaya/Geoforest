import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { paresseux } from "./paresseux";

const globalForAdmin = globalThis as typeof globalThis & {
  __geoforestAdminPool?: Pool;
  __geoforestAdminDb?: NodePgDatabase;
};

/**
 * Connexion privilégiée — **usage strictement limité**.
 *
 * Deux besoins la justifient, et eux seuls :
 *   1. l'authentification : retrouver un utilisateur par e-mail *avant* qu'une
 *      organisation ne soit connue (donc avant tout contexte de cloisonnement) ;
 *   2. l'écriture du journal d'audit, qui est un journal système.
 *
 * ⚠️ Cette connexion contourne la RLS. Elle ne doit jamais être importée par
 * une route métier : celles-ci passent par `withTenant()` (cf. `src/lib/tenant.ts`).
 *
 * ------------------------------------------------------------------- Lot B
 * ⚠️ **La connexion est créée au premier usage, plus à l'import.**
 *
 * `next build` évalue les modules de route pendant « Collecting page data » —
 * sans base de données, et sans qu'aucune requête ne soit servie. Un pool
 * construit au niveau du module y échouait donc, et le build cassait sur
 * `/api/metrics` (importé par `route-supervision` → `auth/session` → ici).
 *
 * La correction précédente testait `NEXT_PHASE === "phase-production-build"`
 * et construisait, en phase de build, un pool pointant vers une URL inventée :
 *
 *     postgresql://absente:absente@127.0.0.1:1/absente
 *
 * ⚠️ Cette approche a été retirée, pour trois raisons :
 *   • elle **construit quand même** un pool à l'import — la dépendance à une
 *     connexion fictive est déplacée, pas supprimée ;
 *   • elle ne tient qu'à une variable d'environnement (`NEXT_PHASE`) : hors du
 *     build de Next.js, ou si la variable est absente, le pool factice est
 *     construit et le produit tourne avec une base fantôme ;
 *   • elle rend le comportement dépendant d'une phase de build, ce qu'un
 *     module de connexion ne devrait jamais faire.
 *
 * Ici, importer ne fait **rien** : aucun pool, aucune lecture de configuration.
 * Le premier accès réel construit la connexion, et lève si l'URL manque. Il n'y
 * a donc aucune valeur de repli à inventer : un pool « factice » aurait rendu
 * le produit silencieusement inopérant au lieu de le signaler.
 */
function createAdminPool(): Pool {
  const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL_ADMIN est requis pour les opérations système.");
  }
  return new Pool({ connectionString: url, max: 4 });
}

function getAdminPool(): Pool {
  if (!globalForAdmin.__geoforestAdminPool) {
    globalForAdmin.__geoforestAdminPool = createAdminPool();
  }
  return globalForAdmin.__geoforestAdminPool;
}

function getDbAdmin(): NodePgDatabase {
  if (!globalForAdmin.__geoforestAdminDb) {
    globalForAdmin.__geoforestAdminDb = drizzle(getAdminPool());
  }
  return globalForAdmin.__geoforestAdminDb;
}

/**
 * Accès paresseux, compatible avec les appels existants (`adminPool.query`,
 * `dbAdmin.select`…). La cible réelle n'est instanciée qu'au premier accès.
 *
 * La transparence du proxy (réflexion, spread, `instanceof`, identité des
 * méthodes) est assurée par `paresseux()` — cf. `src/db/paresseux.ts`, où le
 * comportement est expliqué et testé une seule fois pour les deux pools.
 */
export const adminPool: Pool = paresseux(getAdminPool);
export const dbAdmin: NodePgDatabase = paresseux(getDbAdmin);
