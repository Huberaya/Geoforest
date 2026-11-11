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
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "../src/db/schema";

const MIGRATIONS_FOLDER = "drizzle";
const POST_MIGRATE_FOLDER = "scripts/sql/post-migrate";

/**
 * Tables volontairement **exclues** du périmètre RLS, et pourquoi :
 * infrastructure d'authentification, interrogée avant qu'une organisation ne
 * soit connue. Justification écrite dans `010_row_level_security.sql`.
 * Toute autre table non protégée est une anomalie bloquante.
 */
const EXCLUES_RLS = ["gf_sessions", "gf_login_attempts"];

/** Tables réellement déclarées par le produit ; un préfixe gf_ ne suffit pas. */
const TABLES_DU_DEPOT = new Set(
  Object.values(schema)
    .filter((v) => is(v, PgTable))
    .map((t) => getTableName(t as PgTable)),
);

function citerIdentifiant(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Retire les droits de geoforest_app sur les tables tenant qui ne sont pas
 * déclarées par le dépôt. Les ACL historiques sont détenues par plusieurs
 * rôles : la révocation doit être faite par le propriétaire/grantor.
 *
 * Si le rôle d'administration dispose d'ADMIN OPTION mais pas de SET OPTION,
 * le SET OPTION est activé temporairement, puis restauré dans la même
 * transaction. Aucune appartenance temporaire ne subsiste après succès.
 * Un grant PUBLIC ou une délégation impossible provoque un échec explicite.
 */
async function retirerAccesTablesHorsDepot(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows: cibles } = await client.query<{
      table_name: string;
      owner_name: string;
    }>(
      `select c.relname as table_name,
              pg_get_userbyid(c.relowner) as owner_name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
          and exists (
            select 1 from pg_attribute a
             where a.attrelid = c.oid
               and a.attname = 'organization_id'
               and not a.attisdropped
          )
          and not (c.relname = any($1::text[]))
          and (
            has_table_privilege('geoforest_app', c.oid, 'SELECT')
            or has_table_privilege('geoforest_app', c.oid, 'INSERT')
            or has_table_privilege('geoforest_app', c.oid, 'UPDATE')
            or has_table_privilege('geoforest_app', c.oid, 'DELETE')
            or has_table_privilege('geoforest_app', c.oid, 'TRUNCATE')
            or has_table_privilege('geoforest_app', c.oid, 'REFERENCES')
            or has_table_privilege('geoforest_app', c.oid, 'TRIGGER')
          )
        order by owner_name, table_name`,
      [Array.from(TABLES_DU_DEPOT)],
    );

    if (cibles.length === 0) {
      console.log("  · ACL hors dépôt : aucun accès applicatif résiduel sur les tables tenant étrangères");
      return;
    }

    const { rows: identite } = await client.query<{ role: string }>(
      "select current_user as role",
    );
    const roleAdmin = identite[0]?.role;
    if (!roleAdmin) throw new Error("Impossible d'identifier le rôle d'administration");

    const groupes = new Map<string, string[]>();
    for (const cible of cibles) {
      const liste = groupes.get(cible.owner_name) ?? [];
      liste.push(cible.table_name);
      groupes.set(cible.owner_name, liste);
    }

    await client.query("begin");
    try {
      for (const [proprietaire, tables] of groupes) {
        let setOptionTemporaire = false;
        let optionsInitiales: {
          admin_option: boolean;
          inherit_option: boolean;
          set_option: boolean;
        } | undefined;

        if (proprietaire !== roleAdmin) {
          const { rows: capacite } = await client.query<{ peut_set: boolean }>(
            "select pg_has_role(current_user, $1, 'SET') as peut_set",
            [proprietaire],
          );

          if (!capacite[0]?.peut_set) {
            const { rows: membership } = await client.query<{
              admin_option: boolean;
              inherit_option: boolean;
              set_option: boolean;
            }>(
              `select am.admin_option, am.inherit_option, am.set_option
                 from pg_auth_members am
                 join pg_roles r_granted on r_granted.oid = am.roleid
                 join pg_roles r_member on r_member.oid = am.member
                where r_granted.rolname = $1
                  and r_member.rolname = $2`,
              [proprietaire, roleAdmin],
            );
            optionsInitiales = membership[0];

            if (!optionsInitiales?.admin_option) {
              throw new Error(
                `Révocation impossible sur ${tables.join(", ")} : ${roleAdmin} ne peut pas assumer le propriétaire ${proprietaire}`,
              );
            }

            await client.query(
              `grant ${citerIdentifiant(proprietaire)} to ${citerIdentifiant(roleAdmin)}
                 with admin true, inherit ${optionsInitiales.inherit_option ? "true" : "false"}, set true`,
            );
            setOptionTemporaire = true;
          }

          await client.query(`set role ${citerIdentifiant(proprietaire)}`);
        }

        try {
          await client.query(
            "alter default privileges in schema public revoke all on tables from geoforest_app",
          );
          await client.query(
            "alter default privileges in schema public revoke all on sequences from geoforest_app",
          );

          for (const table of tables) {
            await client.query(
              `revoke all privileges on table "public".${citerIdentifiant(table)} from geoforest_app`,
            );
          }
        } finally {
          if (proprietaire !== roleAdmin) {
            await client.query("reset role");
          }
          if (setOptionTemporaire && optionsInitiales) {
            await client.query(
              `grant ${citerIdentifiant(proprietaire)} to ${citerIdentifiant(roleAdmin)}
                 with admin ${optionsInitiales.admin_option ? "true" : "false"},
                      inherit ${optionsInitiales.inherit_option ? "true" : "false"},
                      set ${optionsInitiales.set_option ? "true" : "false"}`,
            );
          }
        }
      }

      const { rows: residuels } = await client.query<{ table_name: string; owner_name: string }>(
        `select c.relname as table_name,
                pg_get_userbyid(c.relowner) as owner_name
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind in ('r', 'p')
            and exists (
              select 1 from pg_attribute a
               where a.attrelid = c.oid
                 and a.attname = 'organization_id'
                 and not a.attisdropped
            )
            and not (c.relname = any($1::text[]))
            and (
              has_table_privilege('geoforest_app', c.oid, 'SELECT')
              or has_table_privilege('geoforest_app', c.oid, 'INSERT')
              or has_table_privilege('geoforest_app', c.oid, 'UPDATE')
              or has_table_privilege('geoforest_app', c.oid, 'DELETE')
              or has_table_privilege('geoforest_app', c.oid, 'TRUNCATE')
              or has_table_privilege('geoforest_app', c.oid, 'REFERENCES')
              or has_table_privilege('geoforest_app', c.oid, 'TRIGGER')
            )
          order by c.relname`,
        [Array.from(TABLES_DU_DEPOT)],
      );

      if (residuels.length > 0) {
        throw new Error(
          `Accès résiduels à des tables tenant hors dépôt (grant PUBLIC ou rôle hérité) : ${residuels.map((r) => `${r.table_name} [${r.owner_name}]`).join(", ")}`,
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    console.log(
      `  · ACL hors dépôt : ${cibles.length} table(s) nettoyée(s) sous ${groupes.size} rôle(s) propriétaire(s) ; options SET restaurées`,
    );
  } finally {
    client.release();
  }
}

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
    //
    // ⚠️ Les `raise notice` des scripts sont relayés. Mesuré : le contrôle
    //   d'application de `022` se déclarait « reporté » (aucune ligne vivante
    //   visible) sous un propriétaire soumis à la RLS, et personne ne le
    //   voyait — la ligne « sûreté appliquée » laissait croire qu'il avait
    //   exercé la suppression logique. Un contrôle qui ne s'exerce pas doit
    //   le dire dans la sortie que l'exploitant lit.
    const client = await pool.connect();
    const notices: string[] = [];
    const relayer = (n: { message?: string }) => {
      // Les « …, skipping » sont les avis du moteur sur `if exists` /
      // `if not exists` : attendus sur un rejeu, sans valeur pour l'exploitant.
      if (n.message && !/, skipping$/.test(n.message)) notices.push(n.message);
    };
    client.on("notice", relayer);
    try {
      await client.query(sql);
    } finally {
      client.off("notice", relayer);
      client.release();
    }
    console.log(`  · sûreté appliquée : ${fichier}`);
    for (const n of notices) {
      const reporte = /report[ée]|non exer|impossible/i.test(n);
      console.log(`      ${reporte ? "⚠️ " : "· "}${n}`);
    }
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

  // Les tables héritées peuvent avoir été créées par d'autres rôles.
  // Leur accès est retiré sous l'identité de leur propriétaire, sans toucher
  // aux données ni aux politiques des objets étrangers.
  await retirerAccesTablesHorsDepot();

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
