import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { consommerFenetre, reinitialiserFenetre } from "../../src/lib/auth/cadence-partagee";
import { appliquerMigrations } from "../helpers/migrations";

/**
 * Limitation de cadence **partagée**.
 *
 * ⚠️ Ce que ce fichier prouve, et ce qu'il ne prouve pas.
 *
 *   Le compteur vit en base, dans `gf_login_attempts`. Deux objets Drizzle
 *   distincts — deux « instances » du point de vue du code appelant — le
 *   partagent donc réellement : c'est la différence avec le limiteur en
 *   mémoire du proxy, qui repart de zéro à chaque processus.
 *
 *   La course entre deux requêtes **simultanées** ne peut pas être rejouée ici
 *   (PGlite sérialise), mais l'atomicité ne repose pas sur un test : elle
 *   repose sur une transaction unique et un verrou consultatif
 *   (`pg_advisory_xact_lock`), dont PostgreSQL garantit la sérialisation par
 *   clé. Le test vérifie la sémantique (comptage, blocage, réouverture).
 */
let client: PGlite;
let base1: ReturnType<typeof drizzle>;
let base2: ReturnType<typeof drizzle>;

const FENETRE = { cle: "test|203.0.113.5|a@exemple.test", max: 3, fenetreSecondes: 60 };

before(async () => {
  client = await PGlite.create();
  await appliquerMigrations(client);
  base1 = drizzle(client);
  base2 = drizzle(client);
});

after(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.query("delete from gf_login_attempts where window_key like 'test|%'");
});

test("le compteur est partagé entre deux instances applicatives", async () => {
  const j1 = await consommerFenetre(base1, FENETRE);
  const j2 = await consommerFenetre(base2, FENETRE);
  const j3 = await consommerFenetre(base1, FENETRE);

  assert.equal(j1.autorise, true);
  assert.equal(j2.autorise, true);
  assert.equal(j2.restant, 1);
  assert.equal(j3.autorise, false, "le troisième essai doit être refusé");
  assert.equal(j3.essais, 3);
  assert.ok(j3.reessayerDans > 0 && j3.reessayerDans <= 60);
});

test("un compartiment différent ne consomme pas le quota du premier", async () => {
  await consommerFenetre(base1, FENETRE);
  await consommerFenetre(base1, FENETRE);
  await consommerFenetre(base1, FENETRE);

  const autre = await consommerFenetre(base2, { ...FENETRE, cle: "test|203.0.113.6|a@exemple.test" });
  assert.equal(autre.autorise, true);
});

test("une fenêtre expirée repart à zéro", async () => {
  // ⚠️ `max` est le rang du premier refus, pas le nombre d'appels admis : le
  //   max-ième essai de la fenêtre est refusé. C'est la sémantique historique
  //   de `registerLoginFailure` (le 10e essai de connexion répond 429), et on
  //   ne l'assouplit pas au passage.
  const premier = await consommerFenetre(base1, { ...FENETRE, max: 2 });
  assert.equal(premier.autorise, true);
  const bloque = await consommerFenetre(base2, { ...FENETRE, max: 2 });
  assert.equal(bloque.autorise, false);

  // On vieillit la fenêtre au-delà de sa durée : elle ne compte plus.
  await client.query(
    `update gf_login_attempts
        set first_attempt_at = now() - interval '2 hours',
            last_attempt_at = now() - interval '2 hours'
      where window_key = $1`,
    [FENETRE.cle],
  );

  const apres = await consommerFenetre(base1, { ...FENETRE, max: 2 });
  assert.equal(apres.autorise, true);
  assert.equal(apres.essais, 1, "la fenêtre expirée ne compte plus");
});

test("une clé n'accumule pas plusieurs lignes au fil des fenêtres", async () => {
  await consommerFenetre(base1, FENETRE);
  await client.query(
    `update gf_login_attempts
        set first_attempt_at = now() - interval '2 hours',
            last_attempt_at = now() - interval '2 hours'
      where window_key = $1`,
    [FENETRE.cle],
  );
  await consommerFenetre(base2, FENETRE);

  const lignes = await client.query<{ n: number }>(
    "select count(*)::int as n from gf_login_attempts where window_key = $1",
    [FENETRE.cle],
  );
  assert.equal(lignes.rows[0]?.n, 1);
});

test("une authentification réussie remet le compteur à zéro", async () => {
  await consommerFenetre(base1, FENETRE);
  await consommerFenetre(base1, FENETRE);
  await reinitialiserFenetre(base2, FENETRE.cle);

  const apres = await consommerFenetre(base1, FENETRE);
  assert.equal(apres.essais, 1);
  assert.equal(apres.restant, 2);
});

test("le mot de passe d'une fenêtre n'est jamais stocké en clair", async () => {
  // Garde-fou de non-régression sur la table elle-même : elle ne contient que
  // des clés de compartiment, jamais de secret.
  const colonnes = await client.query<{ column_name: string }>(`
    select column_name::text from information_schema.columns
     where table_schema = 'public' and table_name = 'gf_login_attempts'
     order by ordinal_position
  `);
  assert.deepEqual(
    colonnes.rows.map((c) => c.column_name),
    ["id", "window_key", "attempts", "first_attempt_at", "last_attempt_at"],
  );
});
