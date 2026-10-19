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
 * et `dbAdmin.select`…). La cible réelle n'est instanciée qu'au premier accès.
 *
 * ⚠️ **Un proxy qui ne piégeait que `get` et `has` n'est pas transparent.**
 * Mesuré sur la première version : `Object.keys(adminPool)` renvoyait `[]`,
 * `{ ...adminPool }` renvoyait `{}`, `adminPool instanceof Pool` était faux et
 * `adminPool.query !== adminPool.query`. « Aucun appelant ne fait cela » est une
 * observation sur un instant, pas une garantie : un utilitaire de sérialisation
 * ou un futur test aurait rencontré un objet qui ment sur son contenu.
 *
 * Les trapes ci-dessous délèguent toutes à l'instance réelle. Seule
 * `getOwnPropertyDescriptor` diffère : elle force `configurable: true`, parce
 * que la cible du proxy est un objet vide extensible et que déclarer une
 * propriété non configurable absente de cette cible violerait l'invariant du
 * langage (TypeError).
 */
const methodesLiees = new WeakMap<object, Map<PropertyKey, unknown>>();

/** Un constructeur porte toujours un `prototype` ; une méthode, jamais. */
function estConstructeur(valeur: unknown): boolean {
  return typeof valeur === "function" && "prototype" in valeur;
}

function paresseux<T extends object>(cible: () => T): T {
  const lier = (reel: T, propriete: PropertyKey, valeur: unknown): unknown => {
    if (typeof valeur !== "function") return valeur;
    // ⚠️ Ne lier que les **méthodes**. Lier tout ce qui est appelable cassait
    // `adminPool.constructor` et `pool.Client` : une classe liée n'est plus
    // elle-même (`adminPool.constructor === Pool` devenait faux, et
    // `new pool.Client()` construisait autre chose). Une méthode n'a pas de
    // `prototype` ; un constructeur en a toujours un.
    if (estConstructeur(valeur)) return valeur;
    let cache = methodesLiees.get(reel);
    if (!cache) {
      cache = new Map();
      methodesLiees.set(reel, cache);
    }
    // La même méthode garde la même identité d'un accès à l'autre : sans cela
    // `adminPool.query !== adminPool.query`, ce qui casse toute comparaison ou
    // tout `removeListener`.
    if (!cache.has(propriete)) cache.set(propriete, valeur.bind(reel));
    return cache.get(propriete);
  };

  return new Proxy({} as T, {
    get(_vide, propriete) {
      const reel = cible();
      return lier(reel, propriete, Reflect.get(reel, propriete, reel));
    },
    set(_vide, propriete, valeur) {
      return Reflect.set(cible(), propriete, valeur);
    },
    has(_vide, propriete) {
      return propriete in cible();
    },
    deleteProperty(_vide, propriete) {
      return Reflect.deleteProperty(cible(), propriete);
    },
    defineProperty(_vide, propriete, descripteur) {
      return Reflect.defineProperty(cible(), propriete, descripteur);
    },
    ownKeys() {
      return Reflect.ownKeys(cible());
    },
    getOwnPropertyDescriptor(_vide, propriete) {
      const descripteur = Reflect.getOwnPropertyDescriptor(cible(), propriete);
      if (!descripteur) return undefined;
      return { ...descripteur, configurable: true };
    },
    getPrototypeOf() {
      // Rend `adminPool instanceof Pool` vrai : le proxy représente un Pool.
      return Reflect.getPrototypeOf(cible());
    },
  });
}

export const adminPool: Pool = paresseux(getAdminPool);
export const dbAdmin: NodePgDatabase = paresseux(getDbAdmin);
