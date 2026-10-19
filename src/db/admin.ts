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
/**
 * Pool d'administration **différé**.
 *
 * ⚠️ Pourquoi ne pas lever dès la construction.
 *
 *   Ce module est évalué au **build** : Next collecte la configuration de
 *   chaque route, ce qui exécute le module. Lever parce que `DATABASE_URL`
 *   manque faisait donc échouer `npm run build` sur une machine sans base —
 *   alors qu'un build n'ouvre aucune connexion. La conséquence pratique était
 *   de devoir fournir une URL factice en intégration continue, c'est-à-dire de
 *   faire passer un contrôle de configuration pour une réussite trompeuse.
 *
 *   Le pool se construit sans se connecter (c'est le comportement de `pg`) :
 *   on peut donc différer le contrôle jusqu'à la **première requête**, qui est
 *   le seul moment où l'absence d'URL a un sens. Le message d'erreur est
 *   conservé, à l'identique.
 */
class PoolAdministration extends Pool {
  private readonly url: string | undefined;

  constructor(url: string | undefined) {
    // `pg` n'ouvre aucune connexion avant la première requête. L'URL de
    // repli n'est jamais contactée : elle n'existe que pour satisfaire le
    // constructeur, et `exigerUrl()` s'exécute avant tout usage réel.
    super({ connectionString: url ?? "postgresql://absent@127.0.0.1:1/absent", max: 4 });
    this.url = url;
  }

  private exigerUrl(): void {
    if (!this.url) {
      throw new Error("DATABASE_URL_ADMIN est requis pour les opérations système.");
    }
  }

  override query(...args: any[]): any {
    this.exigerUrl();
      return (super.query as any).apply(this, args);
  }

  override connect(...args: any[]): any {
    this.exigerUrl();
      return (super.connect as any).apply(this, args);
  }
}

function createAdminPool(): Pool {
  return new PoolAdministration(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL);
}

export const adminPool = globalForAdmin.__geoforestAdminPool ?? createAdminPool();

if (process.env.NODE_ENV !== "production") {
  globalForAdmin.__geoforestAdminPool = adminPool;
}

export const dbAdmin = drizzle(adminPool);
