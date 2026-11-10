/**
 * Purge des données personnelles dont la finalité est éteinte.
 *
 * ⚠️ Pourquoi ce script existe.
 *
 *   `gf_sessions` conserve une adresse IP et un agent utilisateur, et
 *   `gf_login_attempts` une clé de fenêtre mêlant les deux. Ces données servent
 *   à détecter un vol de session et à limiter le bourrage d'identifiants. Une
 *   fois la session expirée depuis longtemps, la fenêtre de sécurité est
 *   passée : les détenir n'a plus de finalité, et une donnée sans finalité est
 *   une conservation excessive — donc un manquement.
 *
 *   Considérer la purge « au moment où il faudra » revient à la promettre sans
 *   la faire. Elle est donc outillée, exécutable, et vérifiable.
 *
 * ⚠️ Ce que le script NE fait PAS, et pourquoi.
 *
 *   Il n'efface aucune donnée métier. Un dossier de diligence, une parcelle ou
 *   une analyse sont conservés 5 ans parce que l'EUDR l'impose, et une demande
 *   d'effacement ne peut pas primer sur cette obligation (art. 17.3.b : le
 *   droit à l'effacement ne s'applique pas quand une obligation légale de
 *   conservation existe). Le script ne touche donc qu'aux traces techniques.
 *
 *   Il n'efface pas le journal d'audit : il est append-only, chaîné, et le rôle
 *   applicatif n'a pas le droit d'y supprimer. C'est une décision assumée
 *   (D-012) : le journal consigne l'action, pas les données des tiers — celles-
 *   ci sont assainies à l'écriture.
 *
 * ⚠️ Garde-fous, parce qu'un script destructeur est un outil dangereux :
 *   · refus si `NODE_ENV=production` ;
 *   · refus si ni `GF_BASE_JETABLE=oui` ni `GF_PURGE_CONFIRMEE=<date du jour>`
 *     ne sont fournis — une purge accidentelle sur la base d'un client ne se
 *     rattrape pas ;
 *   · `--essai` compte sans rien effacer, et c'est le mode qu'il faut lancer
 *     d'abord ;
 *   · aucune donnée n'est jamais affichée : on compte, on n'expose pas.
 *
 * Usage :
 *   npm run db:purge-rgpd -- --essai          # compte seulement
 *   GF_PURGE_CONFIRMEE=2026-11-06 npm run db:purge-rgpd
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { Pool } from "pg";

/** Au-delà de cette ancienneté, une session expirée n'a plus d'usage de sécurité. */
const JOURS_SESSION = 90;
/** Fenêtre de limitation de débit : quelques heures suffisent, on garde une marge. */
const JOURS_TENTATIVES = 7;

const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
if (!url) {
  console.error("🔴 DATABASE_URL_ADMIN (ou DATABASE_URL) n'est pas défini.");
  process.exit(1);
}

const essai = process.argv.includes("--essai");
const aujourdhui = new Date().toISOString().slice(0, 10);

function refuser(raisons: string[]): never {
  console.error("🔴 Purge refusée :");
  for (const r of raisons) console.error(`   · ${r}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  refuser(["NODE_ENV=production : une purge ne s'exécute pas depuis un environnement de production."]);
}

const jetable = (process.env.GF_BASE_JETABLE ?? "").toLowerCase() === "oui";
const confirmee = process.env.GF_PURGE_CONFIRMEE === aujourdhui;
if (!jetable && !confirmee) {
  refuser([
    "base non déclarée jetable.",
    `Pour purger une base réelle, fournir GF_PURGE_CONFIRMEE=${aujourdhui} (la date du jour, pour que la confirmation soit un geste et non une variable oubliée).`,
    "Lancer d'abord avec --essai pour compter sans effacer.",
  ]);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    // ---------------------------------------------------------------- sessions
    // ⚠️ On efface les COLONNES, pas les lignes.
    //
    //   Supprimer la ligne de session ferait perdre la trace de la famille de
    //   jetons, donc la capacité à détecter la réutilisation d'un jeton volé.
    //   Ce qui n'a plus de finalité, ce sont l'adresse IP et l'agent
    //   utilisateur — pas l'existence de la session.
    const sessions = await pool.query<{ n: string }>(
      `select count(*)::text as n from gf_sessions
        where expires_at < now() - ($1 || ' days')::interval
          and (ip is not null or user_agent is not null)`,
      [String(JOURS_SESSION)],
    );
    const nbSessions = Number(sessions.rows[0]?.n ?? 0);

    // ------------------------------------------------------- tentatives de connexion
    // ⚠️ Ici on supprime les LIGNES : la table ne sert qu'à compter dans une
    //   fenêtre glissante. Une fois la fenêtre passée, la ligne n'a plus aucun
    //   usage, et la garder ne protégerait rien.
    const tentatives = await pool.query<{ n: string }>(
      `select count(*)::text as n from gf_login_attempts
        where last_attempt_at < now() - ($1 || ' days')::interval`,
      [String(JOURS_TENTATIVES)],
    );
    const nbTentatives = Number(tentatives.rows[0]?.n ?? 0);

    console.log(`Sessions expirées depuis plus de ${JOURS_SESSION} jours : ${nbSessions} à anonymiser`);
    console.log(`Tentatives de connexion de plus de ${JOURS_TENTATIVES} jours : ${nbTentatives} à supprimer`);

    if (essai) {
      console.log("\n[essai] aucune écriture effectuée.");
      return;
    }

    const effacees = await pool.query(
      `update gf_sessions set ip = null, user_agent = null
        where expires_at < now() - ($1 || ' days')::interval
          and (ip is not null or user_agent is not null)`,
      [String(JOURS_SESSION)],
    );
    const supprimees = await pool.query(
      `delete from gf_login_attempts
        where last_attempt_at < now() - ($1 || ' days')::interval`,
      [String(JOURS_TENTATIVES)],
    );

    console.log(`✅ ${effacees.rowCount ?? 0} session(s) anonymisée(s) · ${supprimees.rowCount ?? 0} tentative(s) supprimée(s)`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("🔴 Purge impossible :", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
