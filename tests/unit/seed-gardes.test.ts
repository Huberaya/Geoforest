import assert from "node:assert/strict";
import { test } from "node:test";

import { MOT_DE_PASSE_PUBLIE, validerSeed } from "../../scripts/seed-gardes";

/**
 * Garde-fous de l'amorçage de démonstration.
 *
 * ⚠️ Le défaut corrigé : un mot de passe écrit dans le dépôt servait de valeur
 *   par défaut, et le script réinitialisait les comptes existants — donc, sur
 *   une base partagée, des identifiants réels devenaient un secret public.
 */
const BASE_LOCALE = "postgresql://postgres:motdepasse@127.0.0.1:5432/app_db";
const MOT_DE_PASSE_VALIDE = "UnMotDePasseLocal!2026";

test("sans mot de passe fourni, l'amorçage est refusé", () => {
  const decision = validerSeed({ DATABASE_URL_ADMIN: BASE_LOCALE });
  assert.equal(decision.autorise, false);
  assert.ok(decision.refus.some((r) => r.includes("SEED_DEMO_PASSWORD")));
});

test("le mot de passe publié dans le dépôt est refusé", () => {
  const decision = validerSeed({
    DATABASE_URL_ADMIN: BASE_LOCALE,
    SEED_DEMO_PASSWORD: MOT_DE_PASSE_PUBLIE,
  });
  assert.equal(decision.autorise, false);
  assert.ok(decision.refus.some((r) => r.includes("publié dans l'historique")));
});

test("un mot de passe trop court est refusé", () => {
  const decision = validerSeed({ DATABASE_URL_ADMIN: BASE_LOCALE, SEED_DEMO_PASSWORD: "court" });
  assert.equal(decision.autorise, false);
  assert.ok(decision.refus.some((r) => r.includes("au moins 12")));
});

test("la production est refusée même avec un mot de passe valide", () => {
  const decision = validerSeed({
    NODE_ENV: "production",
    DATABASE_URL_ADMIN: BASE_LOCALE,
    SEED_DEMO_PASSWORD: MOT_DE_PASSE_VALIDE,
  });
  assert.equal(decision.autorise, false);
  assert.ok(decision.refus.some((r) => r.includes("production")));
});

test("une base non locale est refusée sans autorisation explicite", () => {
  const distant = "postgresql://postgres:motdepasse@db.exemple.test:5432/app_db";
  const refuse = validerSeed({ DATABASE_URL_ADMIN: distant, SEED_DEMO_PASSWORD: MOT_DE_PASSE_VALIDE });
  assert.equal(refuse.autorise, false);
  assert.ok(refuse.refus.some((r) => r.includes("db.exemple.test")));

  const autorise = validerSeed({
    DATABASE_URL_ADMIN: distant,
    SEED_DEMO_PASSWORD: MOT_DE_PASSE_VALIDE,
    SEED_AUTORISE_HOTE_DISTANT: "oui",
  });
  assert.equal(autorise.autorise, true);
});

test("une cible locale et un mot de passe fourni autorisent la démonstration", () => {
  const decision = validerSeed({
    DATABASE_URL_ADMIN: BASE_LOCALE,
    SEED_DEMO_PASSWORD: MOT_DE_PASSE_VALIDE,
  });
  assert.deepEqual(decision.refus, []);
  assert.equal(decision.autorise, true);
  assert.equal(decision.reinitialiser, false, "les comptes existants ne sont pas touchés par défaut");
});

test("la réinitialisation exige un drapeau dédié", () => {
  const decision = validerSeed({
    DATABASE_URL_ADMIN: BASE_LOCALE,
    SEED_DEMO_PASSWORD: MOT_DE_PASSE_VALIDE,
    SEED_REINITIALISER: "oui",
  });
  assert.equal(decision.reinitialiser, true);
});

test("toutes les raisons de refus sont renvoyées ensemble", () => {
  const decision = validerSeed({ NODE_ENV: "production" });
  assert.equal(decision.autorise, false);
  assert.ok(decision.refus.length >= 3, decision.refus.join(" | "));
});
