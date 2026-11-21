/**
 * Purge des données personnelles dont la finalité est éteinte.
 *
 * ⚠️ Pourquoi ce script existe.
 *
 *   `gf_sessions` conserve une adresse IP et un agent utilisateur (`ip`,
 *   `user_agent`), et `gf_login_attempts` une clé de fenêtre mêlant les deux.
 *   Au-delà de la fenêtre de sécurité (90 jours / 7 jours), les détenir n'a
 *   plus de finalité.
 *
 *   Ce script n'efface aucune donnée métier (obligation légale EUDR 5 ans,
 *   art. 17.3.b RGPD) ni le journal d'audit (append-only, chaîné, D-012).
 *
 *   En mode exécution :
 *   - `update gf_sessions set ip = null, user_agent = null` sur les sessions
 *     expirées > 90 jours (les lignes restent pour la détection de vol de jeton) ;
 *   - `delete from gf_login_attempts` au-delà de 7 jours.
 *
 * ⚠️ Garde-fous :
 *   · refus si `NODE_ENV=production` ;
 *   · exige `DATABASE_URL_ADMIN` sur base réelle ;
 *   · refus si ni `GF_BASE_JETABLE=oui` ni `GF_PURGE_CONFIRMEE=<YYYY-MM-DD>` ;
 *   · `--essai` compte sans rien écrire ; `--json` formate le rapport sans PII.
 *
 * Usage :
 *   npm run db:purge-rgpd -- --essai
 *   GF_PURGE_CONFIRMEE=2026-11-21 npm run db:purge-rgpd
 *   GF_PURGE_CONFIRMEE=2026-11-21 npm run db:purge-rgpd -- --json
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { Pool } from "pg";

import { evaluerGardePurge, executerPurgeSecurite } from "../src/lib/rgpd/purge-securite";

const essai = process.argv.includes("--essai");
const formatJson = process.argv.includes("--json");
const aujourdhui = new Date().toISOString().slice(0, 10);

const garde = evaluerGardePurge(process.env, aujourdhui);
if (!garde.autorise || !garde.url) {
  console.error("🔴 Purge refusée :");
  for (const r of garde.raisons) console.error(`   · ${r}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: garde.url!, max: 1 });
  try {
    const rapport = await executerPurgeSecurite(pool, { essai, dateReference: aujourdhui });

    if (formatJson) {
      console.log(JSON.stringify(rapport, null, 2));
      return;
    }

    console.log(
      `Sessions expirées depuis plus de ${rapport.joursSession} jours : ${rapport.sessionsEligibles} à anonymiser`,
    );
    console.log(
      `Tentatives de connexion de plus de ${rapport.joursTentatives} jours : ${rapport.tentativesEligibles} à supprimer`,
    );

    if (rapport.essai) {
      console.log("\n[essai] aucune écriture effectuée.");
      return;
    }

    console.log(
      `✅ ${rapport.sessionsAnonymisees} session(s) anonymisée(s) · ${rapport.tentativesSupprimees} tentative(s) supprimée(s)`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("🔴 Purge impossible :", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
