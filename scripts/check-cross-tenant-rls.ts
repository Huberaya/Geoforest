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
 * Exécution : npm run test:cross-tenant:rls
 */
import { config } from "dotenv";

if (!process.env.DATABASE_URL) config({ path: ".env.local" });

import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

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
    const cols = await app.query(
      `select c.table_name from information_schema.columns c
        where c.table_schema = 'public' and c.column_name = 'organization_id'
        order by 1`,
    );
    const tablesOrg = cols.rows.map((r) => r.table_name as string);
    const tablesOrgAvecOrgs = [...tablesOrg, "gf_organizations"];
    check("tables tenant identifiées", tablesOrg.length >= 10, `${tablesOrg.length} tables`);
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
      for (const t of tablesOrgAvecOrgs) {
        const r = await client.query(`select count(*)::int as n from ${ident(t)}`);
        check(`${t} : 0 ligne sans contexte`, r.rows[0].n === 0, `${r.rows[0].n}`);
      }
      await client.query("rollback");

      section("Contexte B : lecture, écriture, suppression des lignes de A");
      await client.query("begin");
      await client.query("select set_config('app.current_org', $1, true)", [orgB]);
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
