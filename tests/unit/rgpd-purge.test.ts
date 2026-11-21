import assert from "node:assert/strict";
import test from "node:test";

import {
  CIBLES_CONSERVEES_EUDR,
  validerDemandeEffacement,
} from "../../src/lib/rgpd/effacement-donnees";
import { evaluerGardePurge } from "../../src/lib/rgpd/purge-securite";

test("evaluerGardePurge refuse NODE_ENV=production même avec confirmation", () => {
  const res = evaluerGardePurge(
    {
      NODE_ENV: "production",
      DATABASE_URL_ADMIN: "postgresql://admin@host/db",
      GF_PURGE_CONFIRMEE: "2026-11-21",
    },
    "2026-11-21",
  );
  assert.equal(res.autorise, false);
  assert.ok(res.raisons.some((r) => r.includes("NODE_ENV=production")));
});

test("evaluerGardePurge exige DATABASE_URL_ADMIN sur une base non jetable (pas de repli DATABASE_URL)", () => {
  const res = evaluerGardePurge(
    {
      DATABASE_URL: "postgresql://geoforest_app@host/db",
      GF_PURGE_CONFIRMEE: "2026-11-21",
    },
    "2026-11-21",
  );
  assert.equal(res.autorise, false);
  assert.equal(res.url, null);
  assert.ok(res.raisons.some((r) => r.includes("DATABASE_URL_ADMIN")));
});

test("evaluerGardePurge exige la date du jour exacte pour GF_PURGE_CONFIRMEE", () => {
  const mauvaiseDate = evaluerGardePurge(
    {
      DATABASE_URL_ADMIN: "postgresql://admin@host/db",
      GF_PURGE_CONFIRMEE: "2026-11-20",
    },
    "2026-11-21",
  );
  assert.equal(mauvaiseDate.autorise, false);

  const bonneDate = evaluerGardePurge(
    {
      DATABASE_URL_ADMIN: "postgresql://admin@host/db",
      GF_PURGE_CONFIRMEE: "2026-11-21",
    },
    "2026-11-21",
  );
  assert.equal(bonneDate.autorise, true);
  assert.equal(bonneDate.url, "postgresql://admin@host/db");
});

test("evaluerGardePurge autorise une base jetable déclarée explicitement", () => {
  const res = evaluerGardePurge(
    {
      GF_BASE_JETABLE: "oui",
      DATABASE_URL: "postgresql://postgres@127.0.0.1:5432/test",
    },
    "2026-11-21",
  );
  assert.equal(res.autorise, true);
  assert.equal(res.estJetable, true);
});

test("validerDemandeEffacement refuse toute tentative de préciser organizationId", () => {
  const res = validerDemandeEffacement({
    cible: "fournisseur_contact",
    supplierId: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.status, 422);
    assert.equal(res.code, "organisation_interdite");
  }
});

test("validerDemandeEffacement accepte fournisseur_contact avec UUID valide et motif optionnel", () => {
  const res = validerDemandeEffacement({
    cible: "fournisseur_contact",
    supplierId: "11111111-1111-4111-8111-111111111111",
    motif: "Fin de relation commerciale — demande art. 17 RGPD",
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.demande.type, "effacer_contact_fournisseur");
    if (res.demande.type === "effacer_contact_fournisseur") {
      assert.equal(res.demande.supplierId, "11111111-1111-4111-8111-111111111111");
      assert.equal(res.demande.motif, "Fin de relation commerciale — demande art. 17 RGPD");
    }
  }
});

test("validerDemandeEffacement refuse un UUID invalide ou une cible inconnue", () => {
  const badUuid = validerDemandeEffacement({
    cible: "fournisseur_contact",
    supplierId: "pas-un-uuid",
  });
  assert.equal(badUuid.ok, false);
  if (!badUuid.ok) assert.equal(badUuid.code, "identifiant_invalide");

  const badTarget = validerDemandeEffacement({
    cible: "tout_supprimer",
  });
  assert.equal(badTarget.ok, false);
  if (!badTarget.ok) assert.equal(badTarget.code, "cible_invalide");
});

test("validerDemandeEffacement renvoie un refus motivé art. 17.3.b / EUDR 5 ans pour les cibles métier", () => {
  for (const cible of CIBLES_CONSERVEES_EUDR) {
    const res = validerDemandeEffacement({ cible });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.demande.type, "refus_conservation_legale");
      if (res.demande.type === "refus_conservation_legale") {
        assert.equal(res.demande.cible, cible);
        assert.match(res.demande.baseLegale, /17\.3\.b/);
        assert.match(res.demande.dureeConservation, /5 ans/);
      }
    }
  }
});
