import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { executerPurgeSecurite } from "../../src/lib/rgpd/purge-securite";
import { appliquerMigrations, semerDeuxTenants, USER_A } from "../helpers/migrations";

/**
 * Exécution réelle de la purge RGPD des traces de sécurité sur PostgreSQL
 * (PGlite) : anonymisation des IP/user_agent des sessions expirées > 90 j
 * (conservation des lignes pour détecter un vol de jeton) et suppression des
 * tentatives de connexion > 7 j, sans jamais toucher aux données récentes.
 */
let client: PGlite;

const SESSION_ANCIENNE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SESSION_RECENTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const FAMILLE_ANCIENNE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const FAMILLE_RECENTE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

before(async () => {
  client = await PGlite.create();
  await appliquerMigrations(client);
  await semerDeuxTenants(client);

  await client.query(
    `insert into gf_sessions (id, user_id, refresh_token_hash, family_id, expires_at, ip, user_agent)
     values
       ($1, $2, 'hash-ancienne-session', $3, now() - interval '120 days', '203.0.113.10', 'OldBrowser/1.0'),
       ($4, $2, 'hash-recente-session', $5, now() - interval '15 days', '203.0.113.20', 'RecentBrowser/2.0')`,
    [SESSION_ANCIENNE, USER_A, FAMILLE_ANCIENNE, SESSION_RECENTE, FAMILLE_RECENTE],
  );

  await client.query(
    `insert into gf_login_attempts (window_key, attempts, first_attempt_at, last_attempt_at)
     values
       ('ancienne-tentative', 4, now() - interval '12 days', now() - interval '10 days'),
       ('recente-tentative', 2, now() - interval '2 days', now() - interval '1 day')`,
  );
});

after(async () => {
  await client.close();
});

test("mode --essai compte exactement les traces éligibles sans rien modifier", async () => {
  const rapport = await executerPurgeSecurite(client, {
    essai: true,
    dateReference: "2026-11-21",
  });

  assert.equal(rapport.essai, true);
  assert.equal(rapport.sessionsEligibles, 1);
  assert.equal(rapport.tentativesEligibles, 1);
  assert.equal(rapport.sessionsAnonymisees, 0);
  assert.equal(rapport.tentativesSupprimees, 0);

  const sessions = await client.query<{ id: string; ip: string | null }>(
    "select id, ip from gf_sessions order by id",
  );
  assert.equal(sessions.rows.length, 2);
  assert.equal(sessions.rows[0].ip, "203.0.113.10");
});

test("mode exécution anonymise les sessions > 90 j en conservant la ligne, supprime les tentatives > 7 j, et préserve les données récentes", async () => {
  const rapport = await executerPurgeSecurite(client, {
    essai: false,
    dateReference: "2026-11-21",
  });

  assert.equal(rapport.essai, false);
  assert.equal(rapport.sessionsEligibles, 1);
  assert.equal(rapport.tentativesEligibles, 1);
  assert.equal(rapport.sessionsAnonymisees, 1);
  assert.equal(rapport.tentativesSupprimees, 1);

  const sessions = await client.query<{
    id: string;
    family_id: string;
    ip: string | null;
    user_agent: string | null;
  }>("select id, family_id, ip, user_agent from gf_sessions order by id");

  assert.equal(sessions.rows.length, 2, "la ligne de session expirée doit être conservée");
  assert.equal(sessions.rows[0].id, SESSION_ANCIENNE);
  assert.equal(sessions.rows[0].family_id, FAMILLE_ANCIENNE);
  assert.equal(sessions.rows[0].ip, null);
  assert.equal(sessions.rows[0].user_agent, null);

  assert.equal(sessions.rows[1].id, SESSION_RECENTE);
  assert.equal(sessions.rows[1].ip, "203.0.113.20");
  assert.equal(sessions.rows[1].user_agent, "RecentBrowser/2.0");

  const tentatives = await client.query<{ window_key: string }>(
    "select window_key from gf_login_attempts",
  );
  assert.deepEqual(
    tentatives.rows.map((r) => r.window_key),
    ["recente-tentative"],
  );

  // Rejeu idempotent : plus aucune trace éligible.
  const rejeu = await executerPurgeSecurite(client, {
    essai: false,
    dateReference: "2026-11-21",
  });
  assert.equal(rejeu.sessionsEligibles, 0);
  assert.equal(rejeu.tentativesEligibles, 0);
  assert.equal(rejeu.sessionsAnonymisees, 0);
  assert.equal(rejeu.tentativesSupprimees, 0);
});
