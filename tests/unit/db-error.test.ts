import assert from "node:assert/strict";
import test from "node:test";

import {
  databaseUnavailableResponse,
  isDatabaseUnavailable,
} from "../../src/lib/api/db-error";

test("reconnaît une base injoignable à travers la chaîne de causes", () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  const erreur = new Error("échec de la requête", { cause });
  assert.equal(isDatabaseUnavailable(erreur), true);
});

test("ne confond pas une erreur métier avec une indisponibilité", () => {
  const erreur = Object.assign(new Error("duplicate key"), { code: "23505" });
  assert.equal(isDatabaseUnavailable(erreur), false);
  assert.equal(isDatabaseUnavailable(null), false);
});

test("la réponse 503 ne divulgue ni hôte, ni port, ni message technique", async () => {
  const response = databaseUnavailableResponse(
    new Error("connect ECONNREFUSED 10.1.2.3:5432 (user=neondb_owner)"),
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "10");

  const corps = await response.json();
  const texte = JSON.stringify(corps);
  assert.ok(!texte.includes("10.1.2.3"), "l'adresse de la base ne doit pas sortir");
  assert.ok(!texte.includes("5432"), "le port de la base ne doit pas sortir");
  assert.ok(!texte.includes("neondb_owner"), "l'utilisateur de la base ne doit pas sortir");
  assert.equal("cause" in corps, false);
  assert.equal(corps.retryable, true);
  assert.match(corps.detail, /Persistance indisponible/);
});
