import assert from "node:assert/strict";
import test from "node:test";

import { validerCreationAdmin } from "../../scripts/creer-admin-gardes";
import { MOT_DE_PASSE_PUBLIE } from "../../scripts/seed-gardes";

const ENV_VALIDE = {
  DATABASE_URL_ADMIN: "postgresql://admin_test:pass_test@127.0.0.1:5432/geoforest_test",
  ADMIN_ORG_NAME: "GeoForest Exploitation SAS",
  ADMIN_ORG_SLUG: "GeoForest-Prod",
  ADMIN_ORG_COUNTRY: "fr",
  ADMIN_EMAIL: "Admin.Exploitation@Exemple.FR",
  ADMIN_NAME: "Camille Laurent",
  ADMIN_PASSWORD: "K9!mP4#vR8@zQ2wX",
};

test("validerCreationAdmin accepte un jeu de paramètres complet et normalise slug, pays et email", () => {
  const res = validerCreationAdmin(ENV_VALIDE);
  assert.equal(res.autorise, true);
  if (res.autorise) {
    assert.equal(res.parametres.orgSlug, "geoforest-prod");
    assert.equal(res.parametres.orgCountry, "FR");
    assert.equal(res.parametres.email, "admin.exploitation@exemple.fr");
  }
});

test("validerCreationAdmin refuse le mot de passe historique publié dans le dépôt", () => {
  const res = validerCreationAdmin({
    ...ENV_VALIDE,
    ADMIN_PASSWORD: MOT_DE_PASSE_PUBLIE,
  });
  assert.equal(res.autorise, false);
  if (!res.autorise) {
    assert.ok(res.refus.some((r) => r.includes("historique publié")));
  }
});

test("validerCreationAdmin refuse un mot de passe faible ou contenant l'identifiant", () => {
  const faible = validerCreationAdmin({ ...ENV_VALIDE, ADMIN_PASSWORD: "court" });
  assert.equal(faible.autorise, false);

  const contientEmail = validerCreationAdmin({
    ...ENV_VALIDE,
    ADMIN_EMAIL: "camille@exemple.fr",
    ADMIN_PASSWORD: "Camille2026!Secret",
  });
  assert.equal(contientEmail.autorise, false);
});

test("validerCreationAdmin refuse les champs manquants ou mal formés", () => {
  const res = validerCreationAdmin({
    DATABASE_URL_ADMIN: "https://pas-postgres.example.com",
    ADMIN_ORG_NAME: "A",
    ADMIN_ORG_SLUG: "INVALID SLUG!",
    ADMIN_ORG_COUNTRY: "FRA",
    ADMIN_EMAIL: "pas-un-email",
    ADMIN_NAME: "",
    ADMIN_PASSWORD: "",
  });
  assert.equal(res.autorise, false);
  if (!res.autorise) {
    assert.ok(res.refus.length >= 6, `attendu >= 6 refus, reçu ${res.refus.length}`);
  }
});
