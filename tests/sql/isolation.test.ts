import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  appliquerMigrations,
  AUDIT_A,
  AUDIT_B,
  avecTenant,
  DOC_B,
  DDS_B,
  ORG_A,
  ORG_B,
  PLOT_B,
  semerDeuxTenants,
  SUPPLIER_A,
  SUPPLIER_B,
  USER_B,
} from "../helpers/migrations";

/**
 * Isolation inter-tenant au niveau **base de données**.
 *
 * Ces tests s'exécutent sous le rôle `geoforest_app`, celui avec lequel
 * l'application se connecte en production. Ils ne vérifient donc pas une
 * convention de code : ils vérifient ce que PostgreSQL applique réellement,
 * y compris si une route oubliait son filtre `organization_id`.
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

async function colonne(tx: PGlite, requete: string): Promise<string[]> {
  const resultat = await tx.query<{ v: string }>(requete);
  return resultat.rows.map((r) => r.v);
}

function refuseParLaRls(erreur: unknown): boolean {
  const e = erreur as { code?: string; message?: string };
  return e?.code === "42501" || /row-level security/i.test(e?.message ?? "");
}

test("chaque tenant ne voit que ses lignes, table par table", async () => {
  await avecTenant(client, ORG_A, async (tx) => {
    assert.deepEqual(await colonne(tx, "select name as v from gf_organizations"), ["Organisation A"]);
    assert.deepEqual(await colonne(tx, "select email as v from gf_users"), ["a@exemple.test"]);
    assert.deepEqual(await colonne(tx, "select name as v from gf_suppliers"), ["Fournisseur A"]);
    assert.deepEqual(await colonne(tx, "select name as v from gf_plots"), ["Parcelle A"]);
    assert.deepEqual(await colonne(tx, "select title as v from gf_documents"), ["Document A"]);
    assert.deepEqual(await colonne(tx, "select title as v from gf_due_diligence_statements"), ["Dossier A"]);
    assert.deepEqual(await colonne(tx, "select operator_name as v from parcel_audits"), ["Opérateur A"]);
  });

  await avecTenant(client, ORG_B, async (tx) => {
    assert.deepEqual(await colonne(tx, "select name as v from gf_suppliers"), ["Fournisseur B"]);
    assert.deepEqual(await colonne(tx, "select operator_name as v from parcel_audits"), ["Opérateur B"]);
  });
});

test("un identifiant d'un autre tenant ne renvoie aucune ligne", async () => {
  await avecTenant(client, ORG_A, async (tx) => {
    for (const [table, id] of [
      ["gf_suppliers", SUPPLIER_B],
      ["gf_plots", PLOT_B],
      ["gf_documents", DOC_B],
      ["gf_due_diligence_statements", DDS_B],
      ["parcel_audits", AUDIT_B],
      ["gf_users", USER_B],
    ]) {
      const r = await tx.query<{ n: number }>(
        `select count(*)::int as n from ${table} where id = '${id}'`,
      );
      assert.equal(r.rows[0]?.n, 0, `${table} ne doit pas exposer la ligne d'un autre tenant`);
    }
  });
});

test("une insertion au nom d'un autre tenant est refusée", async () => {
  await assert.rejects(
    avecTenant(client, ORG_A, (tx) =>
      tx.query(`
        insert into gf_suppliers
          (organization_id, name, country, commodity, completeness_score, risk_level, status, plots_count)
        values ('${ORG_B}', 'Fournisseur intrus', 'BE', 'cocoa', 0, 'STANDARD', 'ACTIVE', 0)
      `),
    ),
    refuseParLaRls,
  );
});

test("une mise à jour d'une ligne d'un autre tenant ne modifie rien", async () => {
  await avecTenant(client, ORG_A, async (tx) => {
    const r = await tx.query(
      `update gf_suppliers set name = 'Détourné' where id = '${SUPPLIER_B}'`,
    );
    assert.equal(r.affectedRows, 0);
  });

  await avecTenant(client, ORG_B, async (tx) => {
    assert.deepEqual(await colonne(tx, "select name as v from gf_suppliers"), ["Fournisseur B"]);
  });
});

test("la suppression physique est refusée au rôle applicatif", async () => {
  await assert.rejects(
    avecTenant(client, ORG_A, (tx) => tx.query(`delete from gf_suppliers where id = '${SUPPLIER_A}'`)),
    (erreur: unknown) => {
      const e = erreur as { code?: string; message?: string };
      return e?.code === "42501" || /permission denied|row-level security/i.test(e?.message ?? "");
    },
  );
});

test("la suppression logique ne marque que la ligne du tenant courant", async () => {
  const marque = await avecTenant(client, ORG_A, (tx) =>
    tx.query<{ ligne: unknown }>(
      `select gf_marquer_suppression('gf_suppliers'::regclass, '${SUPPLIER_A}'::uuid, 'test') as ligne`,
    ),
  );
  assert.ok(marque.rows[0]?.ligne, "la ligne du tenant doit être marquée");

  await avecTenant(client, ORG_A, async (tx) => {
    assert.deepEqual(await colonne(tx, "select name as v from gf_suppliers"), []);
  });

  // La ligne de B n'a pas bougé, et la tentative de la marquer depuis A échoue
  // silencieusement (la fonction ne trouve pas la ligne sous la RLS).
  const tentative = await avecTenant(client, ORG_A, (tx) =>
    tx.query<{ ligne: unknown }>(
      `select gf_marquer_suppression('gf_suppliers'::regclass, '${SUPPLIER_B}'::uuid, 'test') as ligne`,
    ),
  );
  assert.equal(tentative.rows[0]?.ligne, null);

  await avecTenant(client, ORG_B, async (tx) => {
    assert.deepEqual(await colonne(tx, "select name as v from gf_suppliers"), ["Fournisseur B"]);
    const r = await tx.query<{ n: number }>(
      `select count(*)::int as n from gf_suppliers where deleted_at is not null`,
    );
    assert.equal(r.rows[0]?.n, 0);
  });
});

test("sans contexte de tenant, aucune ligne n'est visible (échec fermé)", async () => {
  await avecTenant(client, null, async (tx) => {
    for (const table of ["gf_organizations", "gf_users", "gf_suppliers", "gf_plots", "parcel_audits"]) {
      const r = await tx.query<{ n: number }>(`select count(*)::int as n from ${table}`);
      assert.equal(r.rows[0]?.n, 0, `${table} doit être vide sans contexte`);
    }
  });
});

test("un contexte pointant vers une organisation inconnue ne voit rien", async () => {
  await avecTenant(client, "99999999-9999-4999-8999-999999999999", async (tx) => {
    const r = await tx.query<{ n: number }>("select count(*)::int as n from gf_suppliers");
    assert.equal(r.rows[0]?.n, 0);
  });
});

test("le journal d'audit est scellé à l'insertion et non modifiable", async () => {
  await avecTenant(client, ORG_A, async (tx) => {
    await tx.query(`
      insert into gf_audit_logs (organization_id, user_email, action, entity_type, entity_id, details)
      values ('${ORG_A}', 'a@exemple.test', 'CREATE', 'SUPPLIER', '${SUPPLIER_A}', '{"x":1}'::jsonb)
    `);

    const r = await tx.query<{ hash: string | null; sequence: string }>(
      "select hash, sequence::text from gf_audit_logs order by sequence desc limit 1",
    );
    assert.ok(r.rows[0]?.hash, "le déclencheur doit sceller la ligne");

    const anomalies = await tx.query<{ n: number }>(
      `select count(*)::int as n from verifier_chaine_audit('${ORG_A}'::uuid)`,
    );
    assert.equal(anomalies.rows[0]?.n, 0);
  });

  await assert.rejects(
    avecTenant(client, ORG_A, (tx) =>
      tx.query("update gf_audit_logs set action = 'PIRATE' where entity_id = '" + SUPPLIER_A + "'"),
    ),
    (erreur: unknown) => {
      const e = erreur as { code?: string; message?: string };
      return e?.code === "42501" || /append-only|interdite|permission denied/i.test(e?.message ?? "");
    },
  );

  await assert.rejects(
    avecTenant(client, ORG_A, (tx) => tx.query("delete from gf_audit_logs")),
    (erreur: unknown) => {
      const e = erreur as { code?: string; message?: string };
      return e?.code === "42501" || /permission denied/i.test(e?.message ?? "");
    },
  );
});

test("la table d'idempotence est cloisonnée et non destructible", async () => {
  await avecTenant(client, ORG_A, async (tx) => {
    await tx.query(`
      insert into gf_idempotence (organization_id, portee, cle, empreinte_corps, etat, expire_le)
      values ('${ORG_A}', 'POST /api/v1/audits', 'cle-a', 'empreinte-a', 'termine', now() + interval '1 day')
    `);
  });
  await avecTenant(client, ORG_B, async (tx) => {
    await tx.query(`
      insert into gf_idempotence (organization_id, portee, cle, empreinte_corps, etat, expire_le)
      values ('${ORG_B}', 'POST /api/v1/audits', 'cle-b', 'empreinte-b', 'termine', now() + interval '1 day')
    `);
    assert.deepEqual(await colonne(tx, "select cle as v from gf_idempotence"), ["cle-b"]);
  });

  await assert.rejects(
    avecTenant(client, ORG_A, (tx) =>
      tx.query("delete from gf_idempotence where cle = 'cle-a'"),
    ),
    (erreur: unknown) => {
      const e = erreur as { code?: string; message?: string };
      return e?.code === "42501" || /permission denied/i.test(e?.message ?? "");
    },
  );
});

test("la clé étrangère composite empêche de rattacher une parcelle au fournisseur d'un autre tenant", async () => {
  await assert.rejects(
    avecTenant(client, ORG_B, (tx) =>
      tx.query(`
        insert into gf_plots
          (organization_id, supplier_id, name, commodity, country_code, geometry, geometry_type, area_ha, vertex_count)
        values ('${ORG_B}', '${SUPPLIER_A}', 'Parcelle détournée', 'cocoa', 'BE',
                '{"type":"Point","coordinates":[0,0]}'::jsonb, 'Point', 1, 1)
      `),
    ),
    (erreur: unknown) => {
      const e = erreur as { code?: string; message?: string };
      return e?.code === "23503" || /foreign key/i.test(e?.message ?? "");
    },
  );
});

test("l'accès authentification reste étroit et nominatif", async () => {
  await avecTenant(client, ORG_A, async (tx) => {
    // La lecture directe reste cloisonnée…
    assert.deepEqual(await colonne(tx, "select email as v from gf_users"), ["a@exemple.test"]);

    // …et les fonctions `SECURITY DEFINER` de connexion, qui renvoient la ligne
    // entière (condensat de mot de passe, secret TOTP), ne sont **plus**
    // exécutables par le rôle applicatif : voir
    // `scripts/sql/post-migrate/023_fonctions_auth_revoquees.sql`. Elles
    // permettaient de lire le compte d'une autre organisation en contournant
    // la RLS, pour aucun usage — l'authentification passe par la connexion
    // d'administration.
    await assert.rejects(
      tx.query("select auth_user_by_email('b@exemple.test')"),
      (erreur: unknown) => {
        const e = erreur as { code?: string; message?: string };
        return e?.code === "42501" || /permission denied/i.test(e?.message ?? "");
      },
    );
  });
});

// Garde-fou : les constantes importées doivent réellement appartenir à des
// organisations différentes, sinon les tests ci-dessus ne prouvent rien.
test("les jeux de données sont bien séparés", async () => {
  await client.exec("reset role");
  try {
    const r = await client.query<{ a: string; b: string }>(
      `select (select organization_id::text from gf_suppliers where id = '${SUPPLIER_A}') as a,
              (select organization_id::text from gf_suppliers where id = '${SUPPLIER_B}') as b,
              (select organization_id::text from parcel_audits where id = '${AUDIT_A}') as c,
              (select organization_id::text from parcel_audits where id = '${AUDIT_B}') as d`,
    );
    assert.equal(r.rows[0]?.a, ORG_A);
    assert.equal(r.rows[0]?.b, ORG_B);
  } finally {
    await client.exec("set role geoforest_app");
  }
});
