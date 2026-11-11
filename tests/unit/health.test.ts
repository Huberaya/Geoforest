import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composantCritique, evaluerSante } from "../../src/lib/alerting/health";
import type { Composant } from "../../src/lib/alerting/regles";
import { comparerConnexions } from "../../src/db/controle-role";

function composant(nom: string, etat: Composant["etat"]): Composant {
  return { nom, etat, detail: "test", mesure: {}, dureeMs: 1 };
}

describe("sonde de vivacité /api/health", () => {
  it("ne classe pas le stockage comme dépendance critique de vivacité", () => {
    assert.equal(composantCritique("stockage"), false);
    assert.equal(composantCritique("base"), true);
    assert.equal(composantCritique("schema"), true);
  });

  it("répond 200 dégradé si le stockage est indisponible", () => {
    const evaluation = evaluerSante([
      composant("base", "ok"),
      composant("schema", "ok"),
      composant("stockage", "indisponible"),
    ]);

    assert.equal(evaluation.codeHttp, 200);
    assert.equal(evaluation.statut, "degraded");
    assert.equal(evaluation.degrade, true);
    assert.equal(evaluation.indisponible, false);
    assert.equal(evaluation.degrades.some((c) => c.nom === "stockage"), true);
  });

  it("conserve HTTP 503 si la base ou le schéma est indisponible", () => {
    for (const nom of ["base", "schema"]) {
      const evaluation = evaluerSante([composant(nom, "indisponible")]);
      assert.equal(evaluation.codeHttp, 503, nom);
      assert.equal(evaluation.statut, "unavailable", nom);
    }
  });

  it("conserve le mode strict explicite pour les états dégradés", () => {
    const evaluation = evaluerSante([composant("stockage", "indisponible")], true);
    assert.equal(evaluation.codeHttp, 503);
    assert.equal(evaluation.statut, "degraded");
  });
  it("privilégie GF_DATABASE_URL pour mesurer le rôle applicatif effectif", () => {
    const ancienOverride = process.env.GF_DATABASE_URL;
    const ancienneUrl = process.env.DATABASE_URL;
    const ancienneAdmin = process.env.DATABASE_URL_ADMIN;
    process.env.GF_DATABASE_URL = "postgresql://geoforest_app:app@localhost/neondb";
    process.env.DATABASE_URL = "postgresql://neondb_owner:owner@localhost/neondb";
    process.env.DATABASE_URL_ADMIN = "postgresql://neondb_owner:owner@localhost/neondb";
    try {
      const separation = comparerConnexions();
      assert.equal(separation.roleApplicatif, "geoforest_app");
      assert.equal(separation.roleAdministration, "neondb_owner");
      assert.equal(separation.memeRole, false);
    } finally {
      if (ancienOverride === undefined) delete process.env.GF_DATABASE_URL;
      else process.env.GF_DATABASE_URL = ancienOverride;
      if (ancienneUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = ancienneUrl;
      if (ancienneAdmin === undefined) delete process.env.DATABASE_URL_ADMIN;
      else process.env.DATABASE_URL_ADMIN = ancienneAdmin;
    }
  });

});
