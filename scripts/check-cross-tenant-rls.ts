/**
 * Cloisonnement inter-organisations — contrôle **base de données** (B-8, chantier 2).
 *
 * Le contrôle HTTP (`check-cross-tenant.ts`) prouve que les routes ne laissent
 * rien passer. Celui-ci prouve que la base le garantit **même si une route oublie
 * son filtre** : la RLS est le filet, pas la stratégie, et il faut la mesurer.
 *
 * Connexions :
 *   · DATABASE_URL       — rôle APPLICATIF : c'est lui qui est testé.
 *   · DATABASE_URL_ADMIN — lecture des identifiants d'organisations uniquement
 *                          (fixtures), et comptage « avant / après » pour prouver
 *                          qu'aucune ligne n'a été altérée.
 *
 * Prérequis : le contrôle HTTP a été exécuté au préalable (données dans les deux
 * organisations). Sans données, le contrôle échoue : il ne peut pas être vacueux.
 *
 * Périmètre (09/11/2026, runs 42717343596 et 42724931100) :
 *   La branche Neon de CI est une copie de sa parente — la production — et en
 *   hérite des tables **étrangères au dépôt** (`documents`, `diligence_dossiers`,
 *   `audit_events`, …) qui portent `organization_id` sans politique
 *   `current_org()`. Exiger d'elles la RLS de GeoForest n'a pas de sens :
 *   `current_org()` est une fonction de GeoForest. L'invariant juste pour une
 *   table qu'on ne possède pas est plus dur : le rôle applicatif ne doit y
 *   avoir **aucun droit**, et une lecture doit être refusée (42501). Les deux
 *   familles sont donc contrôlées, chacune selon son invariant, et aucune
 *   n'est ignorée :
 *   · tables du dépôt (schéma Drizzle `src/db/schema.ts`) : RLS activée et
 *     forcée, politiques toutes conditionnées par `current_org()`, fail-closed,
 *     cloisonnement A/B, intégrité ;
 *   · toute autre table `organization_id` de `public` : inaccessible au rôle
 *     applicatif (privilèges nuls mesurés par l'administrateur, lecture refusée
 *     mesurée par le rôle lui-même).
 *
 * Exécution : npm run test:cross-tenant:rls
 */
import { config } from "dotenv";

if (!process.env.DATABASE_URL) config({ path: ".env.local" });

import { randomUUID } from "node:crypto";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { Pool, type PoolClient } from "pg";

import * as schema from "../src/db/schema";

/** Tables définies par le dépôt : la seule source de vérité du périmètre. */
const TABLES_DU_DEPOT = new Set(
  Object.values(schema)
    .filter((v) => is(v, PgTable))
    .map((t) => getTableName(t as PgTable)),
);

/** Tables tenant attendues : les tables gf_* étrangères ne sont pas adoptées par convention de nommage. */
const TABLES_TENANT_ATTENDUES = new Set([
  "gf_users",
  "gf_idempotence",
  "gf_suppliers",
  "gf_products",
  "gf_shipments",
  "gf_plots",
  "gf_documents",
  "gf_document_versions",
  "gf_due_diligence_statements",
  "gf_compliance_tasks",
  "gf_audit_logs",
  "parcel_audits",
]);

const SLUG_A = "geoforest-agro";
const SLUG_B = "demo-tenant-b";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(titre: string): void {
  console.log(`\n##### ${titre} #####`);
}

/** Identifiant SQL sûr : nom de table ou de colonne issu du catalogue, jamais de l'utilisateur. */
function ident(nom: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(nom)) throw new Error(`identifiant refusé : ${nom}`);
  return `"${nom}"`;
}

/** Exécute une instruction dans un point de sauvegarde : une erreur n'annule pas le reste. */
async function tenter(
  client: PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<{ ok: true; rowCount: number } | { ok: false; code: string; message: string }> {
  await client.query("savepoint essai");
  try {
    const r = await client.query(sql, params);
    await client.query("release savepoint essai");
    return { ok: true, rowCount: r.rowCount ?? 0 };
  } catch (e) {
    await client.query("rollback to savepoint essai");
    await client.query("release savepoint essai");
    const err = e as { code?: string; message?: string };
    return { ok: false, code: err.code ?? "?", message: err.message ?? String(e) };
  }
}

async function main(): Promise<void> {
  const urlApp = process.env.DATABASE_URL;
  const urlAdmin = process.env.DATABASE_URL_ADMIN;
  if (!urlApp || !urlAdmin) {
    console.error("DATABASE_URL et DATABASE_URL_ADMIN requis.");
    process.exit(2);
  }

  const app = new Pool({ connectionString: urlApp, max: 2 });
  const admin = new Pool({ connectionString: urlAdmin, max: 2 });
  const fail = (e: unknown): never => {
    throw e;
  };

  try {
    section("Rôle testé");
    const role = await app.query(
      "select current_user as u, r.rolsuper as super, r.rolbypassrls as bypass from pg_roles r where r.rolname = current_user",
    );
    const r0 = role.rows[0];
    check("le test s'exécute avec le rôle applicatif", r0.u !== "postgres", `rôle=${r0.u}`);
    check("rôle non superutilisateur", r0.super === false);
    check("rôle sans BYPASSRLS", r0.bypass === false);

    section("Couverture : toute table portant organization_id est sous RLS");
    // ⚠️ `information_schema.columns` liste aussi les **vues**. Depuis `025`,
    //   `v_parcel_audits_identite` porte `organization_id` : une vue ne peut
    //   pas recevoir de politique RLS ni d'INSERT, et ce contrôle la comptait
    //   comme une table (2 échecs sans défaut réel). Les vues sont séparées :
    //   leur propriété de cloisonnement est `security_invoker = true`, qui fait
    //   appliquer la RLS des tables sous-jacentes au rôle appelant. Sans elle,
    //   la vue s'exécuterait avec les droits de son propriétaire et
    //   contournerait la RLS — c'est précisément ce qui est vérifié plus bas.
    // ⚠️ L'inventaire est fait par l'**administrateur**, sur les catalogues :
    //   `information_schema` ne montre au rôle applicatif que les tables sur
    //   lesquelles il a un privilège. Une table étrangère sur laquelle il n'a
    //   aucun droit en serait absente — précisément celle qu'il faut compter
    //   pour prouver qu'elle est inaccessible (mesuré le 09/11/2026 : la table
    //   disparaissait de l'inventaire après `revoke all`).
    const cols = await admin.query(
      `select c.relname as table_name,
              case c.relkind when 'v' then 'VIEW' else 'BASE TABLE' end as table_type,
              exists (
                select 1 from pg_attribute a
                 where a.attrelid = c.oid and a.attname = 'organization_id'
                   and not a.attisdropped
              ) as has_organization_id
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
          -- Les objets PostGIS sont fournis par l'extension, pas par le dépôt.
          and not exists (
            select 1 from pg_depend d
             where d.classid = 'pg_class'::regclass and d.objid = c.oid
               and d.refclassid = 'pg_extension'::regclass and d.deptype = 'e'
          )
        order by 1`,
    );
    const toutesTables = cols.rows
      .filter((r) => r.table_type === "BASE TABLE")
      .map((r) => r.table_name as string);
    const toutesTablesOrg = cols.rows
      .filter((r) => r.table_type === "BASE TABLE" && r.has_organization_id)
      .map((r) => r.table_name as string);
    const tablesOrg = toutesTablesOrg.filter((t) => TABLES_DU_DEPOT.has(t));
    // Toutes les tables étrangères sont contrôlées, pas seulement celles qui
    // portent organization_id : une table héritée sans colonne tenant ne doit
    // pas davantage être accessible au rôle applicatif.
    const tablesEtrangeres = toutesTables.filter((t) => !TABLES_DU_DEPOT.has(t));
    const vuesOrg = cols.rows
      .filter((r) => r.table_type === "VIEW" && r.has_organization_id)
      .map((r) => r.table_name as string);
    const tablesOrgAvecOrgs = [...tablesOrg, "gf_organizations"];
    // L'inventaire est affiché en clair : sur une branche Neon dérivée d'une
    // parente, des tables héritées (hors migrations du dépôt) portent
    // `organization_id` ; elles sont contrôlées plus bas selon leur invariant.
    check(
      "tables tenant du dépôt identifiées",
      tablesOrg.length >= 10,
      `${tablesOrg.length} tables : ${tablesOrg.join(", ")}${vuesOrg.length ? ` · vues : ${vuesOrg.join(", ")}` : ""}`,
    );
    const tablesTenantAttendues = [...TABLES_TENANT_ATTENDUES];
    const tablesTenantAbsentes = tablesTenantAttendues.filter(
      (t) => !TABLES_DU_DEPOT.has(t) || !toutesTablesOrg.includes(t),
    );
    const tablesTenantInattendues = tablesOrg.filter((t) => !TABLES_TENANT_ATTENDUES.has(t));
    check(
      "couverture complète des tables tenant déclarées par le dépôt",
      tablesTenantAbsentes.length === 0
        && tablesTenantInattendues.length === 0
        && tablesOrg.length === TABLES_TENANT_ATTENDUES.size,
      `attendues=${tablesTenantAttendues.length} · présentes=${tablesOrg.length} · absentes=${tablesTenantAbsentes.join(", ") || "aucune"} · inattendues=${tablesTenantInattendues.join(", ") || "aucune"}`,
    );

    section("Tables étrangères au dépôt portant organization_id : inaccessibles au rôle applicatif");
    console.log(
      tablesEtrangeres.length === 0
        ? "  (aucune — base conforme aux seules migrations du dépôt)"
        : `  ${tablesEtrangeres.length} table(s) héritée(s) de la base parente : ${tablesEtrangeres.join(", ")}`,
    );
    if (tablesEtrangeres.length > 0) {
      const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
      const droits = await admin.query(
        `select t.nom,
                array_remove(array_agg(case when has_table_privilege($2, format('%I.%I', 'public', t.nom), p.priv)
                                            then p.priv end), null) as accordes
           from unnest($1::text[]) as t(nom)
          cross join unnest($3::text[]) as p(priv)
          group by t.nom`,
        [tablesEtrangeres, r0.u, PRIVILEGES],
      );
      // La mesure par le rôle lui-même complète celle du catalogue : un GRANT
      // à PUBLIC ou un héritage de rôle se voient à l'exécution.
      const sonde = await app.connect();
      try {
        await sonde.query("begin");
        for (const t of tablesEtrangeres) {
          const accordes = (droits.rows.find((r) => r.nom === t)?.accordes ?? []) as string[];
          check(
            `${t} : aucun privilège pour le rôle applicatif`,
            accordes.length === 0,
            accordes.length ? `accordés : ${accordes.join(", ")}` : "aucun",
          );
          const lecture = await tenter(sonde, `select 1 from ${ident(t)} limit 1`);
          check(
            `${t} : lecture refusée au rôle applicatif (42501)`,
            !lecture.ok && lecture.code === "42501",
            lecture.ok ? "lecture possible" : `code ${lecture.code}`,
          );
        }
        await sonde.query("rollback");
      } finally {
        sonde.release();
      }
    }

    section("PostGIS : objets de référence en lecture seule");
    const postgisNoms = ["spatial_ref_sys", "geometry_columns", "geography_columns"];
    const postgis = await admin.query(
      `select c.relname as nom,
              has_table_privilege($1, c.oid, 'SELECT') as peut_lire,
              has_table_privilege($1, c.oid, 'INSERT') as peut_inserer,
              has_table_privilege($1, c.oid, 'UPDATE') as peut_modifier,
              has_table_privilege($1, c.oid, 'DELETE') as peut_supprimer,
              has_table_privilege($1, c.oid, 'TRUNCATE') as peut_tronquer,
              has_table_privilege($1, c.oid, 'REFERENCES') as peut_referencer,
              has_table_privilege($1, c.oid, 'TRIGGER') as peut_declencher
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($2::text[])
          and c.relkind in ('r', 'p', 'v', 'm')`,
      [r0.u, postgisNoms],
    );
    for (const nom of postgisNoms) {
      const objet = postgis.rows.find((r) => r.nom === nom);
      if (!objet) continue; // PostGIS varie selon la version installée.
      check(
        `${nom} : lecture seule pour le rôle applicatif`,
        objet.peut_lire === true
          && objet.peut_inserer === false
          && objet.peut_modifier === false
          && objet.peut_supprimer === false
          && objet.peut_tronquer === false
          && objet.peut_referencer === false
          && objet.peut_declencher === false,
        JSON.stringify(objet),
      );
    }
    section("Fonctions SECURITY DEFINER : allowlist explicite");
    const fonctionsDefiner = await admin.query(
      `select p.proname as nom, p.proconfig as configuration,
              has_function_privilege($1, p.oid, 'EXECUTE') as appelant_peut_executer
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
        order by p.proname`,
      [r0.u],
    );
    const accessiblesDefiner = fonctionsDefiner.rows.filter((r) => r.appelant_peut_executer);
    check(
      "seule gf_marquer_suppression est exécutable par le rôle applicatif parmi les SECURITY DEFINER",
      accessiblesDefiner.length === 1 && accessiblesDefiner[0].nom === "gf_marquer_suppression",
      JSON.stringify(accessiblesDefiner),
    );
    const suppressionDefiner = accessiblesDefiner[0];
    const suppressionConfiguration = suppressionDefiner?.configuration;
    check(
      "gf_marquer_suppression fixe un search_path explicite sans pg_temp",
      Array.isArray(suppressionConfiguration)
        && suppressionConfiguration.some((v: string) => v.includes("search_path=pg_catalog, public")),
      JSON.stringify(suppressionConfiguration ?? null),
    );
    section("Tables d'authentification : moindre privilège");
    const auth = await admin.query(
      `select
         has_table_privilege($1, 'public.gf_sessions', 'SELECT') as sessions_select,
         has_table_privilege($1, 'public.gf_sessions', 'INSERT') as sessions_insert,
         has_table_privilege($1, 'public.gf_sessions', 'UPDATE') as sessions_update,
         has_table_privilege($1, 'public.gf_sessions', 'DELETE') as sessions_delete,
         has_table_privilege($1, 'public.gf_login_attempts', 'SELECT') as cadence_select_table,
         has_table_privilege($1, 'public.gf_login_attempts', 'INSERT') as cadence_insert_table,
         has_table_privilege($1, 'public.gf_login_attempts', 'UPDATE') as cadence_update_table,
         has_column_privilege($1, 'public.gf_login_attempts', 'id', 'SELECT') as cadence_id_select,
         has_column_privilege($1, 'public.gf_login_attempts', 'window_key', 'UPDATE') as cadence_key_update,
         has_column_privilege($1, 'public.gf_login_attempts', 'window_key', 'SELECT') as cadence_key_select,
         has_column_privilege($1, 'public.gf_login_attempts', 'attempts', 'UPDATE') as cadence_attempts_update`,
      [r0.u],
    );
    const authAcl = auth.rows[0];
    check(
      "gf_sessions : aucun droit pour le rôle applicatif",
      authAcl.sessions_select === false && authAcl.sessions_insert === false
        && authAcl.sessions_update === false && authAcl.sessions_delete === false,
      JSON.stringify(authAcl),
    );
    check(
      "gf_login_attempts : aucun privilège table-level",
      authAcl.cadence_select_table === false && authAcl.cadence_insert_table === false
        && authAcl.cadence_update_table === false,
      JSON.stringify(authAcl),
    );
    check(
      "gf_login_attempts : droits limités aux colonnes du compteur",
      authAcl.cadence_id_select === false && authAcl.cadence_key_update === false
        && authAcl.cadence_key_select === true && authAcl.cadence_attempts_update === true,
      JSON.stringify(authAcl),
    );
    const sondeAuth = await app.connect();
    try {
      await sondeAuth.query("begin");
      const sessionsLecture = await tenter(sondeAuth, "select * from gf_sessions limit 1");
      check("gf_sessions : lecture refusée au rôle applicatif (42501)", !sessionsLecture.ok && sessionsLecture.code === "42501");
      const cadenceLarge = await tenter(sondeAuth, "select * from gf_login_attempts limit 1");
      check("gf_login_attempts : SELECT * refusé (colonnes non autorisées)", !cadenceLarge.ok && cadenceLarge.code === "42501");
      const cadenceCiblee = await tenter(sondeAuth, "select window_key, attempts, first_attempt_at, last_attempt_at from gf_login_attempts limit 1");
      check("gf_login_attempts : lecture des seules colonnes nécessaires autorisée", cadenceCiblee.ok);
      await sondeAuth.query("rollback");
    } finally {
      sondeAuth.release();
    }
    section("Vues portant organization_id : exécutées avec les droits de l'appelant");
    if (vuesOrg.length > 0) {
      const etatVues = await app.query(
        `select c.relname as nom,
                coalesce(array_to_string(c.reloptions, ','), '') as options
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'v' and c.relname = any($1::text[])`,
        [vuesOrg],
      );
      for (const v of vuesOrg) {
        const l = etatVues.rows.find((r) => r.nom === v);
        const options = String(l?.options ?? "");
        check(
          `${v} : vue security_invoker (la RLS des tables sous-jacentes s'applique au rôle appelant)`,
          /security_invoker=(true|on)/i.test(options),
          l ? options || "aucune option" : "vue absente",
        );
      }
    } else {
      check("aucune vue tenant à contrôler", true, "0 vue");
    }
    // Propriété vérifiée : RLS activée ET forcée, au moins une politique, et
    // **toute** politique de la table conditionnée par current_org(). Le nom des
    // politiques n'est pas figé : la migration 022 les a découpées par commande.
    const etat = await app.query(
      `select c.relname as nom, c.relrowsecurity as rls, c.relforcerowsecurity as force,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as politiques,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid
                 and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
                     like '%current_org()%') as politiques_tenant
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1::text[])`,
      [tablesOrgAvecOrgs],
    );
    for (const t of tablesOrgAvecOrgs) {
      const l = etat.rows.find((r) => r.nom === t);
      check(
        `${t} : RLS activée et forcée, politiques toutes conditionnées par current_org()`,
        !!l && l.rls === true && l.force === true && l.politiques > 0 && l.politiques === l.politiques_tenant,
        l ? `${l.politiques_tenant}/${l.politiques} politique(s)` : "table absente",
      );
    }

    section("Organisations");
    const orgs = await admin.query("select id, slug from gf_organizations where slug = any($1::text[])", [[SLUG_A, SLUG_B]]);
    const orgA = orgs.rows.find((r) => r.slug === SLUG_A)?.id as string | undefined;
    const orgB = orgs.rows.find((r) => r.slug === SLUG_B)?.id as string | undefined;
    if (!orgA || !orgB) fail(new Error("organisations de démonstration absentes : relancer seed:auth"));
    check("organisations A et B présentes", !!orgA && !!orgB);

    // Données de référence, comptées par l'administrateur (sans RLS) avant toute tentative.
    const avant: Record<string, number> = {};
    for (const t of tablesOrg) {
      const r = await admin.query(`select count(*)::int as n from ${ident(t)} where organization_id = $1`, [orgA]);
      avant[t] = r.rows[0].n;
    }
    check(
      "l'organisation A dispose de données dans les tables métier (test non vacueux)",
      ["gf_plots", "gf_suppliers", "gf_due_diligence_statements", "gf_documents", "gf_audit_logs"].every((t) => avant[t] > 0),
      `plots=${avant.gf_plots} suppliers=${avant.gf_suppliers} dds=${avant.gf_due_diligence_statements} documents=${avant.gf_documents} journal=${avant.gf_audit_logs}`,
    );

    const client = await app.connect();
    try {
      section("Sans contexte de tenant : aucune ligne visible (fail-closed)");
      await client.query("begin");
      for (const t of [...tablesOrgAvecOrgs, ...vuesOrg]) {
        const r = await client.query(`select count(*)::int as n from ${ident(t)}`);
        check(`${t} : 0 ligne sans contexte`, r.rows[0].n === 0, `${r.rows[0].n}`);
      }
      await client.query("rollback");

      section("Contexte B : lecture, écriture, suppression des lignes de A");
      await client.query("begin");
      await client.query("select set_config('app.current_org', $1, true)", [orgB]);
      for (const v of vuesOrg) {
        const lues = await client.query(`select count(*)::int as n from ${ident(v)} where organization_id = $1`, [orgA]);
        check(`${v} : aucune ligne de A lisible depuis B (vue)`, lues.rows[0].n === 0, `${lues.rows[0].n}`);
      }
      for (const t of tablesOrgAvecOrgs) {
        const cle = t === "gf_organizations" ? "id" : "organization_id";
        const lues = await client.query(`select count(*)::int as n from ${ident(t)} where ${cle} = $1`, [orgA]);
        check(`${t} : aucune ligne de A lisible depuis B`, lues.rows[0].n === 0, `${lues.rows[0].n}`);

        if (t !== "gf_organizations") {
          const maj = await tenter(client, `update ${ident(t)} set organization_id = organization_id where organization_id = $1`, [orgA]);
          // Refus de privilège (42501, p. ex. journal d'audit) ou zéro ligne : aucune modification.
          check(
            `${t} : aucune ligne de A modifiable depuis B`,
            maj.ok ? maj.rowCount === 0 : maj.code === "42501",
            maj.ok ? `${maj.rowCount} ligne(s)` : `code ${maj.code}`,
          );
        } else {
          const maj = await tenter(client, `update gf_organizations set id = id where id = $1`, [orgA]);
          check(`${t} : organisation A non modifiable depuis B`, maj.ok && maj.rowCount === 0, maj.ok ? `${maj.rowCount}` : `${maj.code}`);
        }

        const sup = await tenter(client, `delete from ${ident(t)} where ${cle} = $1`, [orgA]);
        // Refus de privilège (42501) ou zéro ligne : dans les deux cas, rien n'est supprimé.
        check(
          `${t} : suppression impossible depuis B (privilège ou RLS)`,
          !sup.ok ? sup.code === "42501" : sup.rowCount === 0,
          sup.ok ? `${sup.rowCount} ligne(s)` : `code ${sup.code}`,
        );
      }

      section("Contexte B : insertion d'une ligne au nom de A");
      // La ligne source vient de l'administrateur (sans RLS) et est injectée en
      // valeurs : une INSERT … SELECT lirait la source à travers la RLS, donc
      // ne trouverait rien depuis B et ne testerait pas la clause WITH CHECK.
      for (const t of tablesOrgAvecOrgs) {
        const cle = t === "gf_organizations" ? "id" : "organization_id";
        const src = await admin.query(
          `select row_to_json(x) as j from (select * from ${ident(t)} where ${cle} = $1 limit 1) x`,
          [orgA],
        );
        const j = src.rows[0]?.j as Record<string, unknown> | undefined;
        if (!j) {
          check(`${t} : ligne source de A disponible pour le test d'insertion`, false, "aucune ligne");
          continue;
        }
        if ("id" in j) j.id = randomUUID();
        const ins = await tenter(
          client,
          `insert into ${ident(t)} select * from jsonb_populate_record(null::${ident(t)}, $1::jsonb)`,
          [JSON.stringify(j)],
        );
        check(
          `${t} : insertion au nom de A refusée depuis B`,
          !ins.ok && ins.code === "42501",
          ins.ok ? `ligne insérée (${ins.rowCount})` : `code ${ins.code}`,
        );
      }
      await client.query("rollback");

      section("Intégrité : les données de A sont inchangées");
      for (const t of tablesOrg) {
        const r = await admin.query(`select count(*)::int as n from ${ident(t)} where organization_id = $1`, [orgA]);
        check(`${t} : nombre de lignes de A inchangé`, r.rows[0].n === avant[t], `${avant[t]} → ${r.rows[0].n}`);
      }
    } finally {
      client.release();
    }
  } finally {
    await app.end();
    await admin.end();
  }

  console.log(`\n${passed} contrôles réussis, ${failures.length} échec(s)`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Contrôle interrompu :", e instanceof Error ? e.message : e);
  process.exit(1);
});
