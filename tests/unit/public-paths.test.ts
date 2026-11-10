import assert from "node:assert/strict";
import test from "node:test";

import {
  CHEMINS_AUTH_PUBLICS,
  estCheminAuthPublic,
} from "../../src/lib/auth/public-paths";

test("les étapes sans session sont publiques, et elles seules", () => {
  for (const chemin of [
    "/api/v1/auth/login",
    "/api/v1/auth/mfa",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
    // Chantier 6 — activation d'un compte fournisseur : le jeton est la preuve.
    "/api/v1/auth/invitation/accept",
  ]) {
    assert.equal(estCheminAuthPublic(chemin), true, chemin);
  }
  assert.equal(CHEMINS_AUTH_PUBLICS.size, 5);
});

test("les routes qui exigent une session ne sont pas publiques", () => {
  for (const chemin of [
    "/api/v1/auth/me",
    "/api/v1/auth/password",
    "/api/v1/auth/password/",
    "/api/v1/auth/me/extra",
    "/api/v1/auth/",
    "/api/v1/auth",
    // Le préfixe n'ouvre rien : seule la route d'activation exacte est publique.
    "/api/v1/auth/invitation",
    "/api/v1/auth/invitation/",
    "/api/v1/auth/invitation/accept/extra",
    "/api/v1/auth/invitation/refuse",
  ]) {
    assert.equal(estCheminAuthPublic(chemin), false, chemin);
  }
});
