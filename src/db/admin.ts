import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

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
 * ------------------------------------------------------------------ P2-14
 * ⚠️ **La connexion est désormais créée au premier usage, plus à l'import.**
 *
 * Le pool était construit au niveau du module (`export const adminPool =
 * … ?? createAdminPool()`). Or `next build` évalue les modules de route
 * pendant la phase « Collecting page data » — sans base de données, et sans
 * qu'aucune requête ne soit servie. `createAdminPool()` levait donc
 * « DATABASE_URL_ADMIN est requis pour les opérations système », et le build
 * échouait sur `/api/metrics` (qui importe `route-supervision` →
 * `auth/session` → ce module).
 *
 * Le diagnostic précédent pointait `path.resolve()` dans
 * `src/lib/storage/index.ts` : c'était un **avertissement** de traçage, pas la
 * cause. La cause est cette évaluation hâtive.
 *
 * Créer la connexion paresseusement ne contourne rien : en exécution, la
 * première requête système lève toujours si la variable manque. Aucune valeur
 * de repli n'est inventée — un pool « factice » aurait rendu le produit
 * silencieusement inopérant au lieu de le signaler.
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
 * et `dbAdmin.select`…). La cible réelle n'est instanciée qu'au premier accès
 * à une propriété : importer ce module ne demande donc aucune configuration.
 */
function paresseux<T extends object>(cible: () => T): T {
  return new Proxy({} as T, {
    get(_vide, propriete) {
      const reel = cible();
      const valeur = Reflect.get(reel, propriete, reel);
      // Les méthodes du pool / de drizzle doivent rester liées à leur instance :
      // `Reflect.get` renverrait une fonction détachée, qui perdrait `this`.
      return typeof valeur === "function" ? valeur.bind(reel) : valeur;
    },
    has(_vide, propriete) {
      return propriete in cible();
    },
  });
}

export const adminPool: Pool = paresseux(getAdminPool);
export const dbAdmin: NodePgDatabase = paresseux(getDbAdmin);
