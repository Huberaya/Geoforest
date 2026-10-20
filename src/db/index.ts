import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  SQL_CONNECTION_TIMEOUT_MS,
  SQL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  SQL_STATEMENT_TIMEOUT_MS,
} from "@/lib/api/limits";
import { paresseux } from "./paresseux";

/**
 * Connexion **tenant** — celle des routes métier, sous RLS.
 *
 * ------------------------------------------------------------------ Phase 12.1
 * ⚠️ **Aucune identité de connexion fictive, et aucune connexion à l'import.**
 *
 * La version précédente construisait le pool au niveau du module, avec ce
 * repli lorsque `DATABASE_URL` manquait :
 *
 *     postgresql://absente:absente@127.0.0.1:1/absente
 *
 * Ce repli n'était pas inerte : le pilote `pg` recevait bien cette chaîne, et
 * toute requête tentait une connexion TCP vers `127.0.0.1:1`. Mesuré :
 *
 *     [db] DATABASE_URL absente : toute requête échouera (aucun identifiant par défaut).
 *     {"etape":"requete","erreur":"connect ECONNREFUSED 127.0.0.1:1","code":"ECONNREFUSED"}
 *
 * Deux défauts, tous deux corrigés ici :
 *
 *   1. **une identité fabriquée** (`absente:absente`) servait de configuration ;
 *   2. l'erreur rendue à l'appelant était une **erreur réseau** vers un port
 *      fermé, qui ne nommait pas la variable manquante — exactement le cas où
 *      une configuration absente est masquée par un symptôme trompeur.
 *
 * Désormais :
 *   · importer ne fait **rien** (aucun pool, aucune lecture de configuration) ;
 *   · le premier usage réel construit la connexion, ou lève en nommant
 *     `DATABASE_URL` ;
 *   · en **production**, l'import échoue toujours immédiatement : un serveur
 *     mal configuré ne doit pas démarrer. C'est la protection existante, elle
 *     est conservée telle quelle.
 *
 * La phase de build Next.js (collecte des pages) n'ouvre aucune connexion :
 * seuls les modules sont évalués, et plus aucun pool n'y est construit.
 */
const BUILD_PHASE = process.env.NEXT_PHASE === "phase-production-build";
const URL_ABSENTE = !process.env.DATABASE_URL;

// P0 (recette 2026-10-08) — aucun repli vers un identifiant par défaut.
// L'ancien repli `postgres:postgres` faisait tourner l'application avec un
// SUPERUTILISATEUR, qui contourne la RLS : tout le cloisonnement tenant tombait
// en silence si la variable était oubliée. Ici, en production, le chargement
// échoue (fail-closed) ; ailleurs, le premier usage échoue en nommant la
// variable. Aucune connexion par défaut n'existe plus.
if (URL_ABSENTE && !BUILD_PHASE && process.env.NODE_ENV === "production") {
  throw new Error("DATABASE_URL est requis en production : aucune connexion par défaut n'est utilisée.");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlDb?: NodePgDatabase;
};

function creerPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // Message volontairement tourné vers la cause : l'appelant doit lire
    // « DATABASE_URL », pas « ECONNREFUSED 127.0.0.1:1 ».
    throw new Error(
      "DATABASE_URL est requis pour toute connexion à la base : aucune connexion de remplacement n'est ouverte.",
    );
  }
  return new Pool({
    connectionString: url,
    // P1-07 — trois bornes là où il n'y en avait aucune.
    //
    // Sans `connectionTimeoutMillis`, un client attend indéfiniment une
    // connexion : si le pool est saturé, les requêtes s'accumulent en mémoire
    // jusqu'à l'épuisement, au lieu d'échouer vite et proprement.
    connectionTimeoutMillis: SQL_CONNECTION_TIMEOUT_MS,
    // Sans `statement_timeout`, une requête mal conçue (ou un verrou maintenu)
    // occupe une connexion pour une durée illimitée.
    statement_timeout: SQL_STATEMENT_TIMEOUT_MS,
    // Sans `idle_in_transaction_session_timeout`, une transaction ouverte puis
    // abandonnée — un client qui se coupe au mauvais moment — bloque des
    // lignes jusqu'au redémarrage du serveur.
    idle_in_transaction_session_timeout: SQL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });
}

function getPool(): Pool {
  if (!globalForDb.__arenaNextJsPostgresqlPool) {
    globalForDb.__arenaNextJsPostgresqlPool = creerPool();
  }
  return globalForDb.__arenaNextJsPostgresqlPool;
}

function getDb(): NodePgDatabase {
  if (!globalForDb.__arenaNextJsPostgresqlDb) {
    globalForDb.__arenaNextJsPostgresqlDb = drizzle(getPool());
  }
  return globalForDb.__arenaNextJsPostgresqlDb;
}

/**
 * Accès paresseux compatible avec les usages existants (`pool.query`,
 * `db.transaction`, `db.select`…). Aucune cible réelle n'existe avant le
 * premier accès ; sans `DATABASE_URL`, ce premier accès **lève**.
 *
 * Le proxy est celui de `src/db/paresseux.ts`, partagé avec `adminPool` : les
 * deux connexions doivent se comporter pareil, et ce comportement n'est
 * expliqué et testé qu'une fois.
 */
export const pool: Pool = paresseux(getPool);
export const db: NodePgDatabase = paresseux(getDb);
