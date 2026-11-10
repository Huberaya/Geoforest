/**
 * Recette sur **PostgreSQL serveur isolé**.
 *
 * ⚠️ Ce que ce fichier prouve, et que PGlite ne peut pas prouver.
 *
 *   PGlite n'a **qu'une session** : un `SET ROLE` y est global, si bien que le
 *   banc HTTP ne peut pas tourner sous `geoforest_app` (limite mesurée, cf.
 *   `tests/http/harness.ts`). Ici, chaque connexion est une vraie session
 *   PostgreSQL : le propriétaire et le rôle applicatif coexistent, l'un
 *   n'affecte pas l'autre, et les scénarios **concurrents** sont réels.
 *
 *   Ce fichier s'exécute contre une base **jetable**, créée pour la recette,
 *   avec des données **synthétiques**. Il ne doit jamais viser un
 *   environnement partagé : `scripts/recette/postgresql-recette.sh` crée le
 *   cluster, les rôles et la base, puis détruit tout à la fin.
 *
 * Usage (les URL sont fournies par le script d'orchestration) :
 *   RECETTE_URL_ADMIN=… RECETTE_URL_APP=… \
 *     npx tsx --test scripts/recette/recette-serveur.test.ts
 *
 * Les deux URL sont lues dans l'environnement : aucune valeur par défaut, donc
 * aucun risque de viser une base par inadvertance.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { consommerFenetre, reinitialiserFenetre } from "../../src/lib/auth/cadence-partagee";

const URL_ADMIN = process.env.RECETTE_URL_ADMIN;
const URL_APP = process.env.RECETTE_URL_APP;

if (!URL_ADMIN || !URL_APP) {
  throw new Error(
    "RECETTE_URL_ADMIN et RECETTE_URL_APP sont requis : lancer " +
      "scripts/recette/postgresql-recette.sh, qui les fournit.",
  );
}

// Données synthétiques : aucun compte réel, aucun secret réel.
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
const SUPPLIER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPLIER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLOT_B = "bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb";

const admin = new Pool({ connectionString: URL_ADMIN, max: 4 });
const app = new Pool({ connectionString: URL_APP, max: 12 });
const dbApp = drizzle(app);

/** Exécute une requête sous le rôle applicatif, dans un contexte de tenant donné. */
async function sousTenant<T>(
  organisation: string | null,
  operation: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  const client = await app.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.current_org', $1, true)", [organisation ?? ""]);
    const resultat = await operation(client);
    await client.query("commit");
    return resultat;
  } catch (erreur) {
    await client.query("rollback").catch(() => undefined);
    throw erreur;
  } finally {
    client.release();
  }
}

/**
 * Exécute une requête dont on attend un refus, **sans empoisonner la
 * transaction** : dans PostgreSQL, une erreur annule la transaction courante,
 * et toute instruction suivante échouerait en « current transaction is
 * aborted » au lieu de tester ce qu'on croit tester. Le point de sauvegarde
 * isole chaque refus attendu.
 */
async function attendreRefus(
  client: import("pg").PoolClient | import("pg").Pool,
  requete: string,
  parametres: unknown[] = [],
  ...codes: string[]
): Promise<void> {
  const dansTransaction = "release" in client;
  if (dansTransaction) await (client as import("pg").PoolClient).query("savepoint refus");
  try {
    await client.query(requete, parametres);
    assert.fail(`la requête aurait dû être refusée : ${requete}`);
  } catch (erreur) {
    if ((erreur as Error).message?.startsWith("la requête aurait dû")) throw erreur;
    const e = erreur as { code?: string; message?: string };
    const attendu =
      codes.includes(e?.code ?? "") || codes.some((c) => new RegExp(c).test(e?.message ?? ""));
    if (!attendu) throw erreur;
  } finally {
    if (dansTransaction) await (client as import("pg").PoolClient).query("rollback to savepoint refus");
  }
}

function refuseParPostgres(...codes: string[]) {
  return (erreur: unknown) => {
    const e = erreur as { code?: string; message?: string };
    return codes.includes(e?.code ?? "") || codes.some((c) => new RegExp(c).test(e?.message ?? ""));
  };
}

before(async () => {
  // Semis sous la connexion d'administration, **dans le contexte de chaque
  // organisation** : le propriétaire est soumis à `force row level security`,
  // il ne peut donc pas semer hors contexte. C'est déjà une preuve : la RLS
  // s'applique au propriétaire lui-même.
  for (const [org, user, email, supplier, nom, fournisseur] of [
    [ORG_A, USER_A, "a@exemple.test", SUPPLIER_A, "Organisation A", "Fournisseur A"],
    [ORG_B, USER_B, "b@exemple.test", SUPPLIER_B, "Organisation B", "Fournisseur B"],
  ] as const) {
    const client = await admin.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.current_org', $1, true)", [org]);
      await client.query(
        "insert into gf_organizations (id, name, slug, country) values ($1, $2, $3, 'FR')",
        [org, nom, `org-${org.slice(0, 1)}`],
      );
      await client.query(
        `insert into gf_users
           (id, organization_id, email, name, role, status, token_version,
            password_hash, mfa_secret, mfa_recovery_codes)
         values ($1, $2, $3, $4, 'viewer', 'active', 0,
                 '$2b$12$condensat-synthetique-de-recette', 'SECRET-TOTP-SYNTHETIQUE',
                 '["CODE-SECOURS-SYNTHETIQUE"]'::jsonb)`,
        [user, org, email, `Utilisateur ${org.slice(0, 1).toUpperCase()}`],
      );
      await client.query(
        `insert into gf_suppliers
           (id, organization_id, name, country, commodity, completeness_score, risk_level, status, plots_count)
         values ($1, $2, $3, 'FR', 'coffee', 10, 'STANDARD', 'ACTIVE', 1)`,
        [supplier, org, fournisseur],
      );
      await client.query("commit");
    } catch (erreur) {
      await client.query("rollback").catch(() => undefined);
      throw erreur;
    } finally {
      client.release();
    }
  }

  // Une parcelle chez B, pour les tentatives de marquage croisé.
  const client = await admin.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.current_org', $1, true)", [ORG_B]);
    await client.query(
      `insert into gf_plots
         (id, organization_id, supplier_id, name, commodity, country_code, geometry, geometry_type,
          area_ha, vertex_count, centroid_lon, centroid_lat, status)
       values ($1, $2, $3, 'Parcelle B', 'coffee', 'FR',
               '{"type":"Point","coordinates":[1,2]}'::jsonb, 'Point', 1, 1, 1, 2, 'PENDING')`,
      [PLOT_B, ORG_B, SUPPLIER_B],
    );
    await client.query("commit");
  } finally {
    client.release();
  }
});

after(async () => {
  await app.end();
  await admin.end();
});

describe("rôles et privilèges effectifs", () => {
  test("la connexion applicative se présente bien comme geoforest_app, sans pouvoir", async () => {
    const r = await app.query(
      `select current_user::text as role, rolsuper, rolbypassrls, rolcreaterole
         from pg_roles where rolname = current_user`,
    );
    assert.deepEqual(r.rows[0], {
      role: "geoforest_app",
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
    });
  });

  test("la RLS est activée ET forcée sur toutes les tables portant une organisation", async () => {
    const r = await app.query(
      `select c.relname::text as t, c.relrowsecurity, c.relforcerowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and exists (select 1 from information_schema.columns col
                       where col.table_schema = 'public' and col.table_name = c.relname
                         and col.column_name = 'organization_id')
        order by 1`,
    );
    assert.ok(r.rows.length >= 12, `seulement ${r.rows.length} tables inspectées`);
    const fautives = r.rows.filter((l) => !l.relrowsecurity || !l.relforcerowsecurity);
    assert.deepEqual(fautives, []);
  });

  test("le rôle applicatif ne détient ni DELETE ni TRUNCATE", async () => {
    const r = await app.query(
      `select table_name::text t, privilege_type::text p
         from information_schema.role_table_grants
        where grantee = current_user and privilege_type in ('DELETE', 'TRUNCATE')
          and (table_name like 'gf\\_%' or table_name = 'parcel_audits')`,
    );
    assert.deepEqual(r.rows, []);
  });

  test("les opérations destructrices sont refusées par le moteur", async () => {
    await assert.rejects(app.query("delete from gf_suppliers"), refuseParPostgres("42501"));
    await assert.rejects(app.query("truncate gf_suppliers"), refuseParPostgres("42501"));
    await assert.rejects(
      app.query("create table public.table_pirate (id int)"),
      refuseParPostgres("42501"),
    );
  });
});

describe("cloisonnement inter-organisations (RLS sous le rôle réel)", () => {
  test("hors contexte de tenant, aucune ligne n'est visible", async () => {
    await sousTenant(null, async (c) => {
      const r = await c.query("select email from gf_users");
      assert.deepEqual(r.rows, []);
      const s = await c.query("select name from gf_suppliers");
      assert.deepEqual(s.rows, []);
    });
  });

  test("chaque contexte ne voit que son organisation", async () => {
    await sousTenant(ORG_A, async (c) => {
      const r = await c.query("select email from gf_users order by email");
      assert.deepEqual(r.rows, [{ email: "a@exemple.test" }]);
    });
    await sousTenant(ORG_B, async (c) => {
      const r = await c.query("select email from gf_users order by email");
      assert.deepEqual(r.rows, [{ email: "b@exemple.test" }]);
    });
  });

  test("le contexte posé localement ne survit pas à la transaction", async () => {
    await sousTenant(ORG_A, async (c) => {
      const r = await c.query("select current_org()::text as org");
      assert.equal(r.rows[0].org, ORG_A);
    });
    const apres = await app.query("select current_org()::text as org");
    assert.equal(apres.rows[0].org, null, "le contexte doit avoir disparu");
  });

  test("une écriture au nom d'un autre tenant est refusée, pas ignorée", async () => {
    await sousTenant(ORG_A, async (c) => {
      await attendreRefus(
        c,
        `insert into gf_suppliers
           (organization_id, name, country, commodity, completeness_score, risk_level, status, plots_count)
         values ($1, 'Intrus', 'FR', 'coffee', 1, 'STANDARD', 'ACTIVE', 0)`,
        [ORG_B],
        "42501",
      );
    });
  });

  test("une modification de la ligne d'un autre tenant ne touche rien", async () => {
    await sousTenant(ORG_A, async (c) => {
      const r = await c.query(
        "update gf_suppliers set name = 'détourné' where organization_id = $1 returning id",
        [ORG_B],
      );
      assert.equal(r.rowCount, 0);
    });
    const verif = await sousTenant(ORG_B, (c) =>
      c.query("select name from gf_suppliers where organization_id = $1", [ORG_B]),
    );
    assert.deepEqual(verif.rows, [{ name: "Fournisseur B" }]);
  });

  test("une référence croisée est rejetée par la clé étrangère composite", async () => {
    await sousTenant(ORG_A, async (c) => {
      await attendreRefus(
        c,
        `insert into gf_plots
           (organization_id, supplier_id, name, commodity, country_code, geometry, geometry_type,
            area_ha, vertex_count, centroid_lon, centroid_lat, status)
         values ($1, $2, 'Parcelle croisée', 'coffee', 'FR',
                 '{"type":"Point","coordinates":[1,2]}'::jsonb, 'Point', 1, 1, 1, 2, 'PENDING')`,
        [ORG_A, SUPPLIER_B],
        "23503",
      );
    });
  });
});

describe("données d'authentification d'un autre utilisateur", () => {
  test("aucune fonction privilégiée ne les expose au rôle applicatif", async () => {
    for (const appel of [
      { requete: "select auth_user_by_email('b@exemple.test')", parametres: [] as unknown[] },
      { requete: "select auth_user_by_id($1::uuid)", parametres: [USER_B] },
      { requete: "select auth_user_by_id($1::uuid)", parametres: [USER_A] },
    ]) {
      await attendreRefus(app, appel.requete, appel.parametres, "42501");
    }
  });

  test("les colonnes de secret sont hors de portée, même dans son propre tenant", async () => {
    for (const colonne of ["password_hash", "mfa_secret", "mfa_recovery_codes"]) {
      await sousTenant(ORG_A, (c) =>
        attendreRefus(c, `select ${colonne} from gf_users`, [], "42501"),
      );
    }
    await sousTenant(ORG_A, (c) => attendreRefus(c, "select * from gf_users", [], "42501"));
  });

  test("les colonnes non sensibles restent lisibles dans son tenant seulement", async () => {
    await sousTenant(ORG_A, async (c) => {
      const r = await c.query("select email, role from gf_users");
      assert.deepEqual(r.rows, [{ email: "a@exemple.test", role: "viewer" }]);
    });
  });

  test("le propriétaire conserve le droit d'exécuter les fonctions d'authentification", async () => {
    // ⚠️ La révocation ne doit pas casser l'usage légitime : la connexion
    //   d'administration appelle ces fonctions. Ce test constate le privilège ;
    //   l'appel effectif est vérifié par le script d'orchestration, après avoir
    //   donné au propriétaire l'attribut que la production lui connaît
    //   (BYPASSRLS, cf. `neondb_owner`). Sans cet attribut, la RLS forcée
    //   s'applique au propriétaire : la fonction rend zéro ligne, ce qui est
    //   précisément ce que le contrôle de démarrage signale désormais.
    const r = await admin.query(
      `select has_function_privilege(current_user, 'auth_user_by_email(text)', 'execute') as email,
              has_function_privilege(current_user, 'auth_user_by_id(uuid)', 'execute') as id`,
    );
    assert.deepEqual(r.rows[0], { email: true, id: true });
  });
});

describe("journal d'audit et suppression logique", () => {
  test("le journal est insérable, scellé, et ni modifiable ni supprimable", async () => {
    await sousTenant(ORG_A, async (c) => {
      await c.query(
        `insert into gf_audit_logs (organization_id, user_email, action, entity_type, entity_id, details)
         values ($1, 'recette@exemple.test', 'RECETTE', 'supplier', 'x', '{"n":1}'::jsonb)`,
        [ORG_A],
      );
      await attendreRefus(c, "update gf_audit_logs set action = 'falsifie'", [], "42501");
      await attendreRefus(c, "delete from gf_audit_logs", [], "42501");
      const anomalies = await c.query("select count(*)::int as n from verifier_chaine_audit($1::uuid)", [
        ORG_A,
      ]);
      assert.equal(anomalies.rows[0].n, 0, "la chaîne doit être intacte");
    });
  });

  test("le marquage de suppression ne touche que le tenant courant", async () => {
    await sousTenant(ORG_A, async (c) => {
      const r = await c.query(
        "select gf_marquer_suppression('gf_plots'::regclass, $1::uuid, 'recette') as ligne",
        [PLOT_B],
      );
      assert.equal(r.rows[0].ligne, null);
    });
    const intacte = await sousTenant(ORG_B, (c) =>
      c.query("select deleted_at::text as d from gf_plots where id = $1", [PLOT_B]),
    );
    assert.equal(intacte.rows[0].d, null);
  });
});

describe("cadence partagée, sur un vrai serveur concurrent", () => {
  test("l'index unique de window_key existe réellement", async () => {
    const r = await admin.query(
      `select indexdef from pg_indexes
        where schemaname = 'public' and tablename = 'gf_login_attempts'`,
    );
    const jointes = r.rows.map((l) => l.indexdef as string).join("\n");
    assert.match(jointes, /UNIQUE.*window_key/);
  });

  test("un doublon de clé est refusé par le moteur", async () => {
    await assert.rejects(
      admin.query(
        `insert into gf_login_attempts (window_key, attempts, first_attempt_at, last_attempt_at)
         values ('recette-doublon', 1, now(), now()),
                ('recette-doublon', 1, now(), now())`,
      ),
      refuseParPostgres("23505"),
    );
  });

  test("20 appels simultanés sur 8 connexions n'autorisent que 10 essais", async () => {
    const cle = `recette-concurrence-${Date.now()}`;
    const resultats = await Promise.all(
      Array.from({ length: 20 }, () =>
        consommerFenetre(dbApp, { cle, max: 10, fenetreSecondes: 60 }),
      ),
    );
    const autorises = resultats.filter((r) => r.autorise);
    const refuses = resultats.filter((r) => !r.autorise);
    assert.equal(autorises.length, 9, "neuf essais passent, le dixième est refusé");
    assert.equal(refuses.length, 11);
    // Les refus indiquent un délai d'attente positif : le `Retry-After` a une
    // valeur exploitable, pas zéro.
    for (const refus of refuses) assert.ok(refus.reessayerDans > 0);

    // Une seule ligne, et le compteur reflète exactement les 20 passages.
    const ligne = await admin.query(
      "select attempts, count(*) over () as lignes from gf_login_attempts where window_key = $1",
      [cle],
    );
    assert.equal(ligne.rows[0].attempts, 20);
    assert.equal(Number(ligne.rows[0].lignes), 1);
  });

  test("deux instances distinctes partagent le même compteur", async () => {
    const cle = `recette-instances-${Date.now()}`;
    const autrePool = new Pool({ connectionString: URL_APP, max: 4 });
    const autreInstance = drizzle(autrePool);
    try {
      for (let i = 0; i < 3; i += 1) {
        await consommerFenetre(dbApp, { cle, max: 5, fenetreSecondes: 60 });
      }
      const depuisAutre = await consommerFenetre(autreInstance, {
        cle,
        max: 5,
        fenetreSecondes: 60,
      });
      assert.equal(depuisAutre.essais, 4, "le compteur vient bien de la base, pas de la mémoire");
    } finally {
      await autrePool.end();
    }
  });

  test("une fenêtre expirée repart à zéro, et la remise à zéro explicite fonctionne", async () => {
    const cle = `recette-expiration-${Date.now()}`;
    await consommerFenetre(dbApp, { cle, max: 5, fenetreSecondes: 1 });
    await new Promise((r) => setTimeout(r, 1_300));
    const apres = await consommerFenetre(dbApp, { cle, max: 5, fenetreSecondes: 1 });
    assert.equal(apres.essais, 1, "nouvelle fenêtre");

    await reinitialiserFenetre(dbApp, cle);
    const apresReset = await consommerFenetre(dbApp, { cle, max: 5, fenetreSecondes: 60 });
    assert.equal(apresReset.essais, 1);
  });
});
