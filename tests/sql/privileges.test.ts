import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  appliquerMigrations,
  avecTenant,
  DOC_B,
  ORG_A,
  ORG_B,
  PLOT_B,
  semerDeuxTenants,
  SUPPLIER_B,
} from "../helpers/migrations";

/**
 * Privilèges **effectifs** du rôle applicatif.
 *
 * ⚠️ Ce fichier ne teste pas des intentions, il interroge le catalogue
 *   PostgreSQL et tente réellement les opérations. Une politique RLS écrite
 *   mais non forcée, un `GRANT DELETE` oublié, une fonction `SECURITY DEFINER`
 *   laissée exécutable par l'application : autant de défauts qui ne se voient
 *   ni dans le code des routes, ni dans une revue de politiques, et que ces
 *   tests font échouer.
 */
let client: PGlite;

before(async () => {
  client = await PGlite.create();
  await appliquerMigrations(client);
  await semerDeuxTenants(client);
  await client.exec("set role geoforest_app");
});

after(async () => {
  await client.close();
});

function refuseParPostgres(code: string) {
  return (erreur: unknown) => {
    const e = erreur as { code?: string; message?: string };
    return e?.code === code || new RegExp(code).test(e?.message ?? "");
  };
}

test("le rôle applicatif n'est ni superutilisateur ni BYPASSRLS", async () => {
  const r = await client.query<{
    role: string;
    superutilisateur: boolean;
    contourne: boolean;
    cree_roles: boolean;
  }>(`
    select current_user::text as role,
           rolsuper as superutilisateur,
           rolbypassrls as contourne,
           rolcreaterole as cree_roles
      from pg_roles where rolname = current_user
  `);
  assert.deepEqual(r.rows[0], {
    role: "geoforest_app",
    superutilisateur: false,
    contourne: false,
    cree_roles: false,
  });
});

test("toute table portant une organisation a la RLS activée ET forcée", async () => {
  const r = await client.query<{
    table_name: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(`
    select c.relname::text as table_name,
           c.relrowsecurity,
           c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and exists (
         select 1 from information_schema.columns col
          where col.table_schema = 'public'
            and col.table_name = c.relname
            and col.column_name = 'organization_id'
       )
     order by 1
  `);

  // Garde-fou : un catalogue vide ferait passer le test pour de mauvaises
  // raisons.
  assert.ok(r.rows.length >= 12, `seulement ${r.rows.length} tables inspectées`);

  const fautives = r.rows
    .filter((l) => !l.relrowsecurity || !l.relforcerowsecurity)
    .map((l) => `${l.table_name} (activée=${l.relrowsecurity}, forcée=${l.relforcerowsecurity})`);
  assert.deepEqual(fautives, []);
});

test("chaque politique tenant compare à current_org(), jamais à une constante", async () => {
  const r = await client.query<{ tablename: string; qual: string | null; with_check: string | null }>(`
    select tablename::text, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and policyname like 'tenant%'
     order by tablename
  `);
  assert.ok(r.rows.length >= 12);
  for (const ligne of r.rows) {
    const expressions = `${ligne.qual ?? ""} ${ligne.with_check ?? ""}`;
    assert.match(
      expressions,
      /current_org\(\)/,
      `la politique de ${ligne.tablename} ne s'appuie pas sur current_org()`,
    );
  }
});

test("le rôle applicatif ne détient aucun droit de destruction", async () => {
  const r = await client.query<{ privilege_type: string; table_name: string }>(`
    select privilege_type::text, table_name::text
      from information_schema.role_table_grants
     where grantee = current_user
       and privilege_type in ('DELETE', 'TRUNCATE')
       and (table_name like 'gf\\_%' or table_name = 'parcel_audits')
  `);
  assert.deepEqual(r.rows, []);
});

test("le rôle applicatif ne peut pas créer d'objet dans le schéma public", async () => {
  await assert.rejects(
    client.exec("create table public.table_pirate (id int)"),
    refuseParPostgres("42501"),
  );
});

test("les fonctions d'authentification ne sont pas exécutables par l'application", async () => {
  // ⚠️ `auth_user_by_email` et `auth_user_by_id` renvoient la **ligne entière**
  //   de `gf_users` : condensat de mot de passe, secret TOTP, condensats des
  //   codes de secours. Elles sont `SECURITY DEFINER`, donc exemptées de RLS.
  //   Aucune route ne les appelle (l'authentification passe par la connexion
  //   d'administration) : les laisser exécutables par le rôle applicatif
  //   ouvrait une lecture inter-tenant des identifiants pour toute injection
  //   SQL, fût-elle accidentelle.
  for (const appel of [
    "select auth_user_by_email('b@exemple.test')",
    "select auth_user_by_id('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'::uuid)",
  ]) {
    await assert.rejects(client.query(appel), refuseParPostgres("42501"));
  }
});

test("les fonctions nécessaires restent exécutables, sous contrôle du tenant", async () => {
  const r = await client.query<{ org: string | null }>(
    "select current_org()::text as org",
  );
  assert.equal(r.rows[0]?.org, null, "hors contexte, aucune organisation");

  await avecTenant(client, ORG_A, async (tx) => {
    const contexte = await tx.query<{ org: string }>("select current_org()::text as org");
    assert.equal(contexte.rows[0]?.org, ORG_A);

    // Suppression logique : la fonction ne marque que dans le contexte.
    const marque = await tx.query<{ ligne: Record<string, unknown> | null }>(
      `select gf_marquer_suppression('gf_plots'::regclass, '${PLOT_B}'::uuid, 'test') as ligne`,
    );
    assert.equal(marque.rows[0]?.ligne, null, "aucune ligne d'un autre tenant ne doit être marquée");

    // Vérification de chaîne : la lecture reste soumise à la RLS de l'appelant
    // (la fonction n'est pas SECURITY DEFINER), donc rien d'un autre tenant.
    const anomalies = await tx.query<{ n: number }>(
      `select count(*)::int as n from verifier_chaine_audit('${ORG_B}'::uuid)`,
    );
    assert.equal(anomalies.rows[0]?.n, 0);
  });

  // La parcelle visée n'a pas été marquée.
  const intacte = await avecTenant(client, ORG_B, (tx) =>
    tx.query<{ supprime: string | null }>(
      `select deleted_at::text as supprime from gf_plots where id = '${PLOT_B}'`,
    ),
  );
  assert.equal(intacte.rows[0]?.supprime, null);
});

test("les secrets des comptes ne sont pas lisibles depuis le rôle applicatif", async () => {
  // 1. Cloisonnement : dans le contexte de A, aucun compte de B n'est visible.
  const r = await avecTenant(client, ORG_A, (tx) =>
    tx.query<{ email: string }>(
      `select email from gf_users where organization_id = '${ORG_B}'`,
    ),
  );
  assert.deepEqual(r.rows, [], "aucun compte d'un autre tenant ne doit être lisible");

  // 2. Colonnes d'authentification : même dans son propre tenant, le rôle
  //    applicatif n'y a pas accès. La RLS limite les lignes, pas les colonnes ;
  //    c'est un privilège de colonne qui le fait (cf. fin de `010`).
  for (const colonne of ["password_hash", "mfa_secret", "mfa_recovery_codes"]) {
    await assert.rejects(
      avecTenant(client, ORG_A, (tx) => tx.query(`select ${colonne} from gf_users`)),
      refuseParPostgres("42501"),
    );
  }

  // 3. `select *` échoue également : une colonne sensible ajoutée plus tard ne
  //    deviendra pas lisible par accident.
  await assert.rejects(
    avecTenant(client, ORG_A, (tx) => tx.query("select * from gf_users")),
    refuseParPostgres("42501"),
  );

  // 4. Les colonnes non sensibles restent lisibles : les parcours qui
  //    affichent un nom ou un rôle continuent de fonctionner.
  const visible = await avecTenant(client, ORG_A, (tx) =>
    tx.query<{ email: string; role: string }>("select email, role from gf_users"),
  );
  assert.deepEqual(visible.rows, [{ email: "a@exemple.test", role: "viewer" }]);

  const colonnes = await client.query<{ column_name: string }>(`
    select column_name::text from information_schema.columns
     where table_schema = 'public' and table_name = 'gf_users'
       and column_name in ('password_hash', 'mfa_secret', 'mfa_recovery_codes')
  `);
  assert.equal(colonnes.rows.length, 3, "les colonnes sensibles existent bien en base");
});

test("aucune surcharge des fonctions d'authentification n'échappe à la révocation", async () => {
  // ⚠️ `REVOKE` porte sur une **signature** précise. Une surcharge ajoutée plus
  //   tard — `auth_user_by_email(text, uuid)`, par exemple — hériterait de
  //   `EXECUTE` pour `PUBLIC` par défaut, sans qu'aucun test ne le signale.
  //   On vérifie donc l'inventaire complet, pas seulement les deux signatures
  //   connues.
  const r = await client.query<{ proname: string; args: string }>(`
    select p.proname::text as proname,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'auth\\_user\\_by\\_%'
     order by 1, 2
  `);
  assert.deepEqual(r.rows, [
    { proname: "auth_user_by_email", args: "p_email text" },
    { proname: "auth_user_by_id", args: "p_id uuid" },
  ]);

  const exécutables = await client.query<{ proname: string }>(`
    select p.proname::text as proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'auth\\_user\\_by\\_%'
       and has_function_privilege('geoforest_app', p.oid, 'execute')
  `);
  assert.deepEqual(exécutables.rows, []);
});

test("seule la fonction de suppression logique est SECURITY DEFINER pour l'application", async () => {
  // Une fonction `SECURITY DEFINER` s'exécute avec les droits de son
  // propriétaire : elle échappe à la RLS par construction. Chacune est donc une
  // porte qui doit être justifiée, et `gf_marquer_suppression` est la seule à
  // l'être (elle revérifie elle-même le tenant, cf. `022`).
  const r = await client.query<{ proname: string }>(`
    select p.proname::text as proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and has_function_privilege('geoforest_app', p.oid, 'execute')
     order by 1
  `);
  assert.deepEqual(
    r.rows.map((l) => l.proname),
    ["gf_marquer_suppression"],
  );
});

test("une écriture dans un autre tenant est refusée par la RLS, pas ignorée", async () => {
  await assert.rejects(
    avecTenant(client, ORG_A, (tx) =>
      tx.query(`
        insert into gf_documents (organization_id, supplier_id, plot_id, title, category, file_name, status)
        values ('${ORG_B}', '${SUPPLIER_B}', null, 'Document intrus', 'LAND_TENURE', 'x.pdf', 'TO_VERIFY')
      `)),
    refuseParPostgres("42501"),
  );

  await avecTenant(client, ORG_A, async (tx) => {
    const maj = await tx.query<{ id: string }>(
      `update gf_documents set title = 'détourné' where id = '${DOC_B}' returning id`,
    );
    assert.deepEqual(maj.rows, []);
  });
});

test("les versions de pièces sont cloisonnées comme leurs documents", async () => {
  const avant = await avecTenant(client, ORG_A, (tx) =>
    tx.query<{ n: number }>(
      `select count(*)::int as n from gf_document_versions where organization_id = '${ORG_B}'`,
    ),
  );
  assert.equal(avant.rows[0]?.n, 0);

  await assert.rejects(
    avecTenant(client, ORG_A, (tx) =>
      tx.query(`
        insert into gf_document_versions
          (document_id, organization_id, version, storage_key, file_name, sha256, size_bytes, mime_detected, uploaded_by)
        values ('${DOC_B}', '${ORG_B}', 99, 'org-b/intrus.pdf', 'intrus.pdf', repeat('a', 64), 1, 'application/pdf', 'test')
      `),
    ),
    refuseParPostgres("42501"),
  );
});
