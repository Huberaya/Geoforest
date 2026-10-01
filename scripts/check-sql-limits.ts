/**
 * Contrôle P1-07 — les délais posés sur le pool atteignent-ils PostgreSQL ?
 *
 * ⚠️ Pourquoi ce script existe.
 *
 * Écrire `statement_timeout` dans la configuration d'un pool ne prouve rien :
 * il faut vérifier que la valeur est **bien transmise à la connexion** et
 * réellement appliquée par le serveur. Un paramètre mal orthographié, ou non
 * reconnu par le pilote, serait ignoré en silence — le code semblerait protégé
 * alors que la base attendrait toujours indéfiniment.
 *
 * Ce script ouvre donc une connexion avec exactement la configuration du pool
 * de l'application et lit ce que PostgreSQL a retenu.
 *
 * Exécution : npx tsx scripts/check-sql-limits.ts
 */
import { readFileSync } from "node:fs";
import { Pool } from "pg";

import {
  SQL_CONNECTION_TIMEOUT_MS,
  SQL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  SQL_STATEMENT_TIMEOUT_MS,
} from "../src/lib/api/limits";

/** `tsx` ne charge pas .env.local : on reprend les valeurs à la main. */
function chargerEnv(): void {
  for (const fichier of [".env.local", ".env"]) {
    try {
      for (const ligne of readFileSync(fichier, "utf-8").split("\n")) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(ligne);
        if (!m) continue;
        const cle = m[1];
        if (process.env[cle] !== undefined) continue;
        process.env[cle] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      // fichier absent : rien à faire
    }
  }
}

async function main(): Promise<number> {
  chargerEnv();

  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/app_db",
    connectionTimeoutMillis: SQL_CONNECTION_TIMEOUT_MS,
    statement_timeout: SQL_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: SQL_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });

  let echecs = 0;
  try {
    const { rows } = await pool.query(
      `select current_setting('statement_timeout')            as statement,
              current_setting('idle_in_transaction_session_timeout') as idle,
              current_setting('lock_timeout')                  as lock`,
    );
    const r = rows[0] as { statement: string; idle: string; lock: string };

    const attendus: Array<[string, string, number]> = [
      ["statement_timeout", r.statement, SQL_STATEMENT_TIMEOUT_MS],
      ["idle_in_transaction_session_timeout", r.idle, SQL_IDLE_IN_TRANSACTION_TIMEOUT_MS],
    ];

    for (const [nom, obtenu, voulu] of attendus) {
      // PostgreSQL restitue « 10s » ou « 10000 » selon la façon dont le
      // paramètre a été transmis ; les deux formes sont acceptées.
      const ms = obtenu.endsWith("s") && !/ms$/.test(obtenu)
        ? Number(obtenu.slice(0, -1)) * 1000
        : Number(String(obtenu).replace(/\D/g, ""));
      const conforme = ms === voulu;
      if (!conforme) echecs += 1;
      console.log(
        `${conforme ? "✅" : "🔴"} ${nom} = ${obtenu}` +
          (conforme ? "" : ` (attendu ${voulu} ms)`),
      );
    }

    console.log(`ℹ️  lock_timeout (non réglé par l'application) = ${r.lock}`);
    console.log(`✅ pool : connectionTimeoutMillis = ${SQL_CONNECTION_TIMEOUT_MS} ms (côté client)`);
  } finally {
    await pool.end().catch(() => {});
  }

  return echecs === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("🔴 " + String(err));
    process.exit(1);
  });
