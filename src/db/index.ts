import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  SQL_CONNECTION_TIMEOUT_MS,
  SQL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  SQL_STATEMENT_TIMEOUT_MS,
} from "@/lib/api/limits";

const databaseUrl =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/app_db";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
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

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
