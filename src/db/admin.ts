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
 * et `dbAdmin.select`…). La cible réelle n'est instanciée qu'au premier accès.
 *
 * ---------------------------------------------------------------- P3-01
 * ⚠️ **Un proxy qui ne piège que `get` et `has` n'est pas transparent.**
 *
 * La première version ne piégeait que ces deux trapes. Mesuré :
 *   `Object.keys(adminPool)`   → `[]`      (au lieu des propriétés du pool)
 *   `adminPool instanceof Pool` → `false`
 *   `{ ...adminPool }`         → `{}`
 *   `Object.getOwnPropertyNames` → `[]`
 * Aucun appelant actuel ne fait cela, mais « aucun appelant ne le fait » n'est
 * pas une garantie : c'est une observation sur un instant. Un `Promise`-like,
 * un utilitaire de sérialisation ou un futur test l'aurait fait, et l'objet
 * aurait alors menti silencieusement sur son contenu.
 *
 * Les trapes ci-dessous délèguent toutes à l'instance réelle. Le proxy se
 * comporte donc comme l'objet qu'il représente, à l'exception d'une chose
 * volontaire : `ownKeys` et `getOwnPropertyDescriptor` **forcent**
 * `configurable: true`, parce que la cible du proxy est un objet vide extensible
 * et que déclarer une propriété non configurable absente de cette cible viole
 * l'invariant du langage (TypeError).
 */
const methodesLiees = new WeakMap<object, Map<PropertyKey, unknown>>();

function paresseux<T extends object>(cible: () => T): T {
  const lier = (reel: T, propriete: PropertyKey, valeur: unknown): unknown => {
    if (typeof valeur !== "function") return valeur;
    let cache = methodesLiees.get(reel);
    if (!cache) {
      cache = new Map();
      methodesLiees.set(reel, cache);
    }
    // La même méthode doit garder la même identité d'un accès à l'autre :
    // sinon `adminPool.query !== adminPool.query`, ce qui casse toute
    // comparaison ou tout `removeListener`.
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
      const reel = cible();
      const descripteur = Reflect.getOwnPropertyDescriptor(reel, propriete);
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
