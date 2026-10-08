import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  SQL_CONNECTION_TIMEOUT_MS,
  SQL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  SQL_STATEMENT_TIMEOUT_MS,
} from "@/lib/api/limits";

// P0 (recette 2026-10-08) — aucun repli vers un identifiant par défaut.
// L'ancien repli `postgres:postgres` faisait tourner l'application avec un
// SUPERUTILISATEUR, qui contourne la RLS : tout le cloisonnement tenant tombait
// en silence si la variable était oubliée.
//  · production : sans DATABASE_URL, le chargement échoue (fail-closed) ;
//  · autres environnements (tests unitaires, outils) : aucune connexion n'est
//    possible — l'URL factice refuse tout accès, et l'erreur est explicite au
//    premier usage, sans jamais utiliser un identifiant par défaut.
// La phase de build Next.js (collecte des pages) n'ouvre aucune connexion.
const BUILD_PHASE = process.env.NEXT_PHASE === "phase-production-build";
const URL_ABSENTE = !process.env.DATABASE_URL;
if (URL_ABSENTE && !BUILD_PHASE) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL est requis en production : aucune connexion par défaut n'est utilisée.");
  }
  console.error("[db] DATABASE_URL absente : toute requête échouera (aucun identifiant par défaut).");
}
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://absente:absente@127.0.0.1:1/absente";

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
