import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import {
  consommerJetonRefresh,
  revoquerFamille,
} from "../../src/lib/auth/refresh-consommation";

/**
 * Ces tests s'exécutent contre PostgreSQL réel (PGlite), pas contre un double.
 * Ce qui est vérifié est la propriété qui compte : la consommation d'un jeton
 * est une écriture conditionnelle **unique**. Un second appel ne peut pas
 * obtenir la même session, même s'il lit l'état avant que le premier n'ait
 * fini — c'est PostgreSQL qui sérialise, pas le code applicatif.
 */
async function base(): Promise<{
  client: PGlite;
  db: ReturnType<typeof drizzle>;
}> {
  const client = await PGlite.create();
  await client.exec(`
    create table gf_sessions (
      id uuid primary key,
      user_id uuid not null,
      refresh_token_hash text not null unique,
      family_id uuid not null,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      replaced_by uuid,
      user_agent text,
      ip text,
      created_at timestamptz not null default now(),
      last_used_at timestamptz not null default now()
    );
  `);
  return { client, db: drizzle(client) };
}

const ACTIF = "11111111-1111-4111-8111-111111111111";
const FAMILLE = "22222222-2222-4222-8222-222222222222";

test("un jeton actif est consommé une seule fois", async () => {
  const { client, db } = await base();
  try {
    await client.exec(`
      insert into gf_sessions (id, user_id, refresh_token_hash, family_id, expires_at, user_agent, ip)
      values ('${ACTIF}', gen_random_uuid(), 'hash-actif', '${FAMILLE}', now() + interval '7 days', 'test', '203.0.113.9');
    `);

    const premiere = await consommerJetonRefresh(db, "hash-actif");
    assert.ok(premiere);
    assert.equal(premiere.id, ACTIF);
    assert.equal(premiere.familyId, FAMILLE);
    assert.equal(premiere.userAgent, "test");
    assert.equal(premiere.ip, "203.0.113.9");
    assert.ok(premiere.expiresAt.getTime() > Date.now());

    // Le second appel — le rejeu — ne trouve plus de ligne à consommer.
    const seconde = await consommerJetonRefresh(db, "hash-actif");
    assert.equal(seconde, null);

    const lignes = await client.query<{ revoked_at: string | null }>(
      `select revoked_at::text from gf_sessions where id = '${ACTIF}'`,
    );
    assert.ok(lignes.rows[0]?.revoked_at, "le jeton doit être révoqué après consommation");
  } finally {
    await client.close();
  }
});

test("un jeton déjà révoqué ou expiré n'est jamais consommé", async () => {
  const { client, db } = await base();
  try {
    await client.exec(`
      insert into gf_sessions (id, user_id, refresh_token_hash, family_id, expires_at, revoked_at)
      values
        (gen_random_uuid(), gen_random_uuid(), 'hash-revoque', gen_random_uuid(), now() + interval '1 day', now()),
        (gen_random_uuid(), gen_random_uuid(), 'hash-expire', gen_random_uuid(), now() - interval '1 second', null),
        (gen_random_uuid(), gen_random_uuid(), 'hash-inconnu', gen_random_uuid(), now() + interval '1 day', null);
    `);

    assert.equal(await consommerJetonRefresh(db, "hash-revoque"), null);
    assert.equal(await consommerJetonRefresh(db, "hash-expire"), null);
    assert.equal(await consommerJetonRefresh(db, "hash-absent"), null);
  } finally {
    await client.close();
  }
});

test("révoquer une famille ferme toutes ses branches actives, et elle seule", async () => {
  const { client, db } = await base();
  try {
    const autreFamille = "33333333-3333-4333-8333-333333333333";
    await client.exec(`
      insert into gf_sessions (id, user_id, refresh_token_hash, family_id, expires_at)
      values
        (gen_random_uuid(), gen_random_uuid(), 'h1', '${FAMILLE}', now() + interval '1 day'),
        (gen_random_uuid(), gen_random_uuid(), 'h2', '${FAMILLE}', now() + interval '1 day'),
        (gen_random_uuid(), gen_random_uuid(), 'h3', '${autreFamille}', now() + interval '1 day');
    `);

    await revoquerFamille(db, FAMILLE);

    const restantes = await client.query<{ n: number }>(
      `select count(*)::int as n from gf_sessions where family_id = '${FAMILLE}' and revoked_at is null`,
    );
    assert.equal(restantes.rows[0]?.n, 0);

    const intacte = await client.query<{ n: number }>(
      `select count(*)::int as n from gf_sessions where family_id = '${autreFamille}' and revoked_at is null`,
    );
    assert.equal(intacte.rows[0]?.n, 1);
  } finally {
    await client.close();
  }
});
