import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Client } from "pg";

import {
  appliquerMigrations,
  DOC_B,
  ORG_A,
  ORG_B,
  PLOT_B,
  semerDeuxTenants,
} from "../helpers/migrations";
import { demarrerRelais, type Relais } from "../helpers/relais-role";

/**
 * Isolation vue depuis un **vrai client réseau**, sous le rôle applicatif.
 *
 * ⚠️ Ce que ce fichier ajoute aux autres tests SQL.
 *
 *   `tests/sql/isolation.test.ts` appelle PGlite en processus : c'est
 *   PostgreSQL, mais le client n'est pas celui du produit. Ici, la connexion
 *   passe par le protocole PostgreSQL sur TCP, exactement comme le pool de
 *   `src/db/index.ts` : un relais force `SET ROLE geoforest_app`, puis chaque
 *   transaction reproduit le motif de `withTenant()` — `set_config` local,
 *   requêtes métier, validation.
 *
 *   Ce que cela prouve : le rôle effectif, l'application de la RLS, et le fait
 *   que `set_config(..., true)` ne fuit pas hors de sa transaction.
 *   Ce que cela ne prouve pas : le comportement des routes Next (couvert par
 *   `tests/http/` et sa limite documentée).
 */
let base: PGlite;
let serveur: PGLiteSocketServer;
let relais: Relais;
let client: Client;

before(async () => {
  base = await PGlite.create();
  await appliquerMigrations(base);
  await semerDeuxTenants(base);

  serveur = new PGLiteSocketServer({ db: base, port: 55531, host: "127.0.0.1", maxConnections: 10 });
  await serveur.start();
  relais = await demarrerRelais({ portAmont: 55531, role: "geoforest_app" });

  client = new Client({ host: "127.0.0.1", port: relais.port, user: "geoforest_app", database: "postgres" });
  await client.connect();
});

after(async () => {
  await client?.end().catch(() => undefined);
  await relais?.arreter();
  await serveur?.stop();
  await base?.close();
});

/** Reproduit exactement `withTenant()` : contexte posé localement à la transaction. */
async function dansTenant<T>(
  organisation: string | null,
  operation: () => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await client.query("select set_config('app.current_org', $1, true)", [organisation ?? ""]);
    const resultat = await operation();
    await client.query("commit");
    return resultat;
  } catch (erreur) {
    await client.query("rollback").catch(() => undefined);
    throw erreur;
  }
}

test("la connexion applicative se présente bien comme geoforest_app", async () => {
  const r = await client.query<{ role: string; superutilisateur: boolean; contourne: boolean }>(`
    select current_user::text as role, rolsuper as superutilisateur, rolbypassrls as contourne
      from pg_roles where rolname = current_user
  `);
  assert.deepEqual(r.rows[0], {
    role: "geoforest_app",
    superutilisateur: false,
    contourne: false,
  });
});

test("hors transaction, aucune ligne n'est visible (échec fermé)", async () => {
  const r = await client.query<{ n: number }>("select count(*)::int as n from gf_suppliers");
  assert.equal(r.rows[0]?.n, 0);
});

test("chaque transaction ne voit que son organisation", async () => {
  const a = await dansTenant(ORG_A, () =>
    client.query<{ name: string }>("select name from gf_suppliers order by name"),
  );
  assert.deepEqual(a.rows.map((l) => l.name), ["Fournisseur A"]);

  const b = await dansTenant(ORG_B, () =>
    client.query<{ name: string }>("select name from gf_suppliers order by name"),
  );
  assert.deepEqual(b.rows.map((l) => l.name), ["Fournisseur B"]);
});

test("le contexte posé localement ne survit pas à la transaction", async () => {
  const dedans = await client.query<{ org: string | null }>(
    "select current_org()::text as org",
  );
  assert.equal(dedans.rows[0]?.org, null, "réinitialisé par la validation de la transaction");

  const dehors = await dansTenant(ORG_A, () =>
    client.query<{ org: string }>("select current_org()::text as org"),
  );
  assert.equal(dehors.rows[0]?.org, ORG_A);
});

test("une modification de la ligne d'un autre tenant ne touche rien", async () => {
  const maj = await dansTenant(ORG_A, () =>
    client.query<{ id: string }>(
      "update gf_plots set name = 'détournée' where id = $1 returning id",
      [PLOT_B],
    ),
  );
  assert.deepEqual(maj.rows, []);

  const verif = await dansTenant(ORG_B, () =>
    client.query<{ name: string }>("select name from gf_plots where id = $1", [PLOT_B]),
  );
  assert.deepEqual(verif.rows.map((l) => l.name), ["Parcelle B"]);
});

test("une suppression physique est refusée au rôle applicatif", async () => {
  await assert.rejects(
    dansTenant(ORG_A, () => client.query("delete from gf_plots where id = $1", [PLOT_B])),
    (erreur: unknown) => {
      const e = erreur as { code?: string; message?: string };
      return e?.code === "42501" || /permission denied|row-level security/i.test(e?.message ?? "");
    },
  );

  const encore = await dansTenant(ORG_B, () =>
    client.query<{ n: number }>("select count(*)::int as n from gf_plots where id = $1", [PLOT_B]),
  );
  assert.equal(encore.rows[0]?.n, 1);
});

test("une insertion au nom d'un autre tenant est rejetée", async () => {
  await assert.rejects(
    dansTenant(ORG_A, () =>
      client.query(
        `insert into gf_documents (organization_id, supplier_id, title, category, file_name, status)
         values ($1, null, 'Document intrus', 'LAND_TENURE', 'intrus.pdf', 'TO_VERIFY')`,
        [ORG_B],
      ),
    ),
    (erreur: unknown) => {
      const e = erreur as { code?: string; message?: string };
      return e?.code === "42501" || /row-level security/i.test(e?.message ?? "");
    },
  );
});

test("la lecture d'un document d'un autre tenant ne rend rien", async () => {
  const r = await dansTenant(ORG_A, () =>
    client.query<{ title: string }>("select title from gf_documents where id = $1", [DOC_B]),
  );
  assert.deepEqual(r.rows, []);
});
