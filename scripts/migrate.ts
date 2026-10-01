/**
 * Migration de schéma **versionnée**, en une seule commande.
 *
 * ⚠️ P1-04 — pourquoi ce script existe.
 *
 * Avant, le schéma était poussé par `drizzle-kit push --force` : aucune
 * migration n'était conservée, aucun historique, aucun retour arrière possible.
 * Surtout, `push` **recrée les tables et efface les politiques RLS** : après
 * chaque exécution, le cloisonnement multi-tenant disparaissait sans la moindre
 * erreur, et il fallait penser à rejouer `npm run db:tenancy` à la main. Une
 * étape de sécurité qui repose sur la mémoire d'une personne finit par être
 * oubliée — c'est ce qui s'est produit à deux reprises pendant cet audit.
 *
 * Désormais :
 *   1. `drizzle/<tag>.sql` — migrations de schéma générées et versionnées ;
 *   2. `scripts/sql/post-migrate/*.sql` — scripts de sûreté **appliqués
 *      systématiquement après** les migrations, dans l'ordre du nom de fichier.
 *      Le cloisonnement ne peut plus être oublié : il est dans le chemin.
 *
 * Les deux étapes sont idempotentes : rejouer la commande ne change rien.
 * En cas d'incohérence, la commande **échoue** : mieux vaut un arrêt franc
 * qu'une base à moitié migrée dont personne ne se méfie.
 *
 * Usage : npm run db:migrate
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const MIGRATIONS_FOLDER = "drizzle";
const POST_MIGRATE_FOLDER = "scripts/sql/post-migrate";

/**
 * Tables volontairement **exclues** du périmètre RLS, et pourquoi :
 * infrastructure d'authentification, interrogée avant qu'une organisation ne
 * soit connue. Justification écrite dans `010_row_level_security.sql`.
 * Toute autre table non protégée est une anomalie bloquante.
 */
const EXCLUES_RLS = ["gf_sessions", "gf_login_attempts"];

const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
if (!url) {
  console.error("🔴 DATABASE_URL_ADMIN (ou DATABASE_URL) n'est pas défini.");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);

async function appliquerPostMigration(): Promise<number> {
  let fichiers: string[];
  try {
    fichiers = readdirSync(POST_MIGRATE_FOLDER)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    console.log(`  · aucun dossier ${POST_MIGRATE_FOLDER} — rien à appliquer`);
    return 0;
  }

  for (const fichier of fichiers) {
    const chemin = join(POST_MIGRATE_FOLDER, fichier);
    const brut = readFileSync(chemin, "utf-8");

    // ⚠️ Les commandes `\` sont des commandes de **psql**, pas du SQL. Le
    //   pilote les envoie telles quelles au moteur, qui répond « syntax error
    //   at or near "\" » — constaté sur `021` et `022`, qui commençaient par
    //   `\set ON_ERROR_STOP on`. Elles sont retirées, et signalées : les
    //   retirer en silence laisserait croire que la garde demandée est
    //   active, alors qu'elle ne l'est pas.
    const meta = brut.split("\n").filter((l) => l.trimStart().startsWith("\\"));
    if (meta.length > 0) {
      console.log(`  · ${fichier} : ${meta.length} commande(s) psql ignorée(s) `
        + `(${meta.map((m) => m.trim()).join(", ")}) — le pilote arrête la `
        + `première erreur venue, la garde est donc assurée par lui.`);
    }
    const sql = brut
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("\\"))
      .join("\n");

    // Le pool exécute le fichier en une requête simple : les blocs `$$` et les
    // scripts multi-instructions sont donc acceptés tels quels.
    await pool.query(sql);
    console.log(`  · sûreté appliquée : ${fichier}`);
  }
  return fichiers.length;
}

/**
 * Migrations déjà enregistrées, traduites en étiquettes lisibles.
 * Drizzle ne consigne que `created_at` : on le rattache au `when` du journal.
 */
async function migrationsAppliquees(): Promise<string[]> {
  // Sur une base neuve, ni le schéma ni la table de suivi n'existent encore.
  await pool.query("create schema if not exists drizzle");
  await pool.query(
    "create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)",
  );
  const { rows } = await pool.query<{ created_at: string }>(
    "select created_at from drizzle.__drizzle_migrations order by created_at",
  );
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf-8"),
  ) as { entries: Array<{ tag: string; when: number }> };

  return rows.map(
    (r) =>
      journal.entries.find((e) => String(e.when) === String(r.created_at))?.tag ??
      `inconnue(${r.created_at})`,
  );
}

/**
 * Le registre Drizzle fait foi pour l'ordre, pas pour l'état réel de la base.
 * S'il annonce des migrations alors qu'aucune table métier n'existe, c'est que
 * le schéma a été vidé sans mise à jour du registre : continuer produirait une
 * base à moitié construite, ce qui est pire qu'un arrêt franc.
 */
async function verifierCoherenceRegistre(nbEnregistrees: number): Promise<void> {
  if (nbEnregistrees === 0) return;

  const { rows } = await pool.query<{ n: string }>(
    `select count(*) as n
       from pg_tables
      where schemaname = 'public'
        and tablename <> all($1::text[])`,
    [EXCLUES_RLS],
  );

  if (Number(rows[0]?.n ?? 0) === 0) {
    console.error(
      [
        `🔴 Le registre annonce ${nbEnregistrees} migration(s) appliquée(s) mais aucune table métier n'existe :`,
        "   le schéma a été vidé sans mise à jour du registre.",
        "   Deux issues :",
        "     - reconstruire de zéro    : dropdb app_db && createdb app_db && npm run db:migrate",
        "     - ou remonter une par une : npm run db:rollback (autant de fois que nécessaire)",
      ].join("\n"),
    );
    process.exit(1);
  }
}

async function verifierCloisonnement(): Promise<void> {
  // ⚠️ Le périmètre est désormais explicite, et c'est une correction issue
  //   d'un incident réel. La vérification comptait **toutes** les tables du
  //   schéma `public`. Sur une base partagée — Neon héberge également le
  //   schéma du backend FastAPI, soit 37 tables dont nous ne sommes pas
  //   propriétaires — elle échouait pour des tables étrangères. Or un blocage
  //   injustifié est un blocage qu'on contourne en urgence, ce qui est pire
  //   que pas de contrôle du tout.
  //
  //   Sont donc exigées les tables créées par NOS migrations — celles
  //   qu'administre le rôle qui joue la migration. Les autres sont
  //   **signalées**, jamais passées sous silence, mais ne font pas échouer la
  //   commande : nous n'avons ni la charge ni le droit de poser des politiques
  //   sur des tables dont un autre outil est propriétaire.
  const { rows } = await pool.query<{ total: string; protegees: string; manquantes: string }>(
    `select count(*) as total,
            count(*) filter (where rowsecurity) as protegees,
            coalesce(string_agg(tablename, ', ') filter (where not rowsecurity), '') as manquantes
       from pg_tables
      where schemaname = 'public'
        and tableowner = current_user
        and tablename <> all($1::text[])`,
    [EXCLUES_RLS],
  );
  const total = Number(rows[0]?.total ?? 0);
  const protegees = Number(rows[0]?.protegees ?? 0);
  const manquantes = rows[0]?.manquantes ?? "";

  const { rows: etrangeres } = await pool.query<{ n: string; liste: string }>(
    `select count(*) as n,
            coalesce(string_agg(tablename, ', '), '') as liste
       from pg_tables
      where schemaname = 'public'
        and tableowner <> current_user
        and not rowsecurity
        and tablename <> all($1::text[])`,
    [EXCLUES_RLS],
  );
  const autres = Number(etrangeres[0]?.n ?? 0);

  const { rows: politiques } = await pool.query<{ n: string }>(
    "select count(*) as n from pg_policies where schemaname = 'public'",
  );

  console.log(
    `  · RLS : ${protegees}/${total} de nos tables protégée(s) · ` +
      `${politiques[0]?.n ?? 0} politique(s) · exclues (justifié) : ${EXCLUES_RLS.join(", ")}`,
  );
  if (autres > 0) {
    // ⚠️ Signalé, pas ignoré : ces tables échappent au cloisonnement, et il
    //   vaut mieux le savoir au moment où l'on migre qu'au moment d'un incident.
    console.log(
      `  · ⚠️ ${autres} table(s) d'un autre propriétaire, hors de notre ` +
        `périmètre, sans RLS : ${(etrangeres[0]?.liste ?? "").slice(0, 160)}`,
    );
  }

  if (total > 0 && protegees < total) {
    console.error(
      `🔴 ${total - protegees} de nos tables sont sans RLS (${manquantes}) : ` +
        `le cloisonnement n'est pas complet. La migration est considérée comme échouée.`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log("Migration du schéma");

  const avant = await migrationsAppliquees();
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  const apres = await migrationsAppliquees();
  const nouvelles = apres.filter((m) => !avant.includes(m));

  if (nouvelles.length === 0) {
    console.log(`  · schéma déjà à jour (${apres.length} migration(s) enregistrée(s))`);
  } else {
    for (const m of nouvelles) console.log(`  · appliquée : ${m}`);
  }

  // Le suivi des migrations peut mentir : on vérifie la réalité avant de
  // poursuivre, sinon une base vidée passerait pour une base à jour.
  await verifierCoherenceRegistre(apres.length);

  await appliquerPostMigration();

  await verifierCloisonnement();
  console.log("✅ Schéma à jour et cloisonnement vérifié.");
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("🔴 Migration échouée :", err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
