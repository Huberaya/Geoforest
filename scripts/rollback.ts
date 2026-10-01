/**
 * Retour arrière d'une migration de schéma.
 *
 * ⚠️ P1-04 — ce qui est démontré ici.
 *
 * Avec `drizzle-kit push --force`, il n'existait aucun historique : un
 * déploiement raté ne pouvait pas être annulé, faute de savoir à quoi revenir.
 *
 * Convention retenue :
 *   drizzle/<tag>.sql        — montée   (générée par `npm run db:generate`)
 *   drizzle/<tag>.down.sql   — descente (écrite à la main)
 *
 * `npm run db:rollback` annule la **dernière** migration enregistrée. Si aucune
 * migration descendante n'a été écrite, la commande **refuse** : une descente
 * manquante ne doit pas être prise pour une descente sans effet.
 *
 * Une migration descendante n'est pas une sauvegarde : elle supprime des
 * données. En production, le retour arrière est d'abord une restauration, la
 * descente ne faisant que remettre le schéma en cohérence avec le code
 * redéployé.
 *
 * Usage : npm run db:rollback
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const MIGRATIONS_FOLDER = "drizzle";

const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
if (!url) {
  console.error("🔴 DATABASE_URL_ADMIN (ou DATABASE_URL) n'est pas défini.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });

interface EntreeJournal {
  idx: number;
  tag: string;
  when: number;
}

function lireJournal(): EntreeJournal[] {
  const brut = readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf-8");
  const journal = JSON.parse(brut) as { entries: EntreeJournal[] };
  return journal.entries.sort((a, b) => a.idx - b.idx);
}

async function main(): Promise<void> {
  const entrees = lireJournal();

  const { rows } = await pool.query<{ hash: string; created_at: string }>(
    "select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1",
  );
  const derniere = rows[0];
  if (!derniere) {
    console.log("  · aucune migration enregistrée — rien à annuler.");
    return;
  }

  const appliquee = entrees.find((e) => String(e.when) === String(derniere.created_at));
  if (!appliquee) {
    console.error(
      `🔴 La dernière migration enregistrée (created_at=${derniere.created_at}) ` +
        `ne correspond à aucune entrée du journal. Historique incohérent : arrêt.`,
    );
    process.exit(1);
  }

  const descente = join(MIGRATIONS_FOLDER, `${appliquee.tag}.down.sql`);
  if (!existsSync(descente)) {
    console.error(
      `🔴 Aucune migration descendante pour « ${appliquee.tag} » (${descente}).\n` +
        `   Écrivez-la avant d'annuler : un retour arrière partiel laisserait le schéma\n` +
        `   dans un état que plus aucune version du code ne sait lire.`,
    );
    process.exit(1);
  }

  console.log(`Annulation de « ${appliquee.tag} »`);
  await pool.query(readFileSync(descente, "utf-8"));
  await pool.query("delete from drizzle.__drizzle_migrations where hash = $1", [derniere.hash]);
  console.log(`  · descendante appliquée : ${appliquee.tag}.down.sql`);
  console.log(`  · migration désenregistrée`);
  console.log("✅ Retour arrière effectué.");
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("🔴 Retour arrière échoué :", err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
