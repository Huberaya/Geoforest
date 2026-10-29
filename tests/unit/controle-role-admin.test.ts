import assert from "node:assert/strict";
import { test } from "node:test";

import { interpreterRoleAdministration } from "../../src/db/controle-role";

/**
 * Contrôle du rôle d'**administration**.
 *
 * ⚠️ Défaut constaté en recette PostgreSQL serveur : une connexion
 *   d'administration distincte mais soumise à la RLS démarre sans erreur, puis
 *   ne lit aucune ligne hors contexte d'organisation. `auth_user_by_email()`
 *   rend zéro ligne et la connexion répond « compte inconnu » — une panne qui
 *   ressemble à un mauvais mot de passe.
 */
test("un rôle d'administration soumis à la RLS est refusé, avec la cause exacte", () => {
  const etat = interpreterRoleAdministration({
    role: "geoforest_owner",
    superutilisateur: false,
    contourne_rls: false,
    rls_appliquee: true,
  });

  assert.equal(etat.ok, false);
  assert.equal(etat.rlsAppliquee, true);
  assert.match(etat.message ?? "", /geoforest_owner/);
  assert.match(etat.message ?? "", /compte inconnu/);
  assert.match(etat.message ?? "", /BYPASSRLS/);
});

test("un rôle d'administration qui contourne la RLS est accepté", () => {
  for (const ligne of [
    { role: "neondb_owner", superutilisateur: false, contourne_rls: true, rls_appliquee: false },
    { role: "postgres", superutilisateur: true, contourne_rls: false, rls_appliquee: false },
  ]) {
    const etat = interpreterRoleAdministration(ligne);
    assert.equal(etat.ok, true, ligne.role);
    assert.equal(etat.message, null);
  }
});

test("le contrôle ne se contente pas du nom du rôle", () => {
  // Un rôle nommé « admin » mais soumis à la RLS reste refusé : c'est la
  // propriété mesurée qui décide, pas l'apparence.
  const etat = interpreterRoleAdministration({
    role: "admin",
    superutilisateur: false,
    contourne_rls: false,
    rls_appliquee: true,
  });
  assert.equal(etat.ok, false);
});
