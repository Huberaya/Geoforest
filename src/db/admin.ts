import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const globalForAdmin = globalThis as typeof globalThis & {
  __geoforestAdminPool?: Pool;
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
 */
function createAdminPool(): Pool {
  const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL_ADMIN est requis pour les opérations système.");
  }
  return new Pool({ connectionString: url, max: 4 });
}

export const adminPool = globalForAdmin.__geoforestAdminPool ?? createAdminPool();

if (process.env.NODE_ENV !== "production") {
  globalForAdmin.__geoforestAdminPool = adminPool;
}

export const dbAdmin = drizzle(adminPool);
