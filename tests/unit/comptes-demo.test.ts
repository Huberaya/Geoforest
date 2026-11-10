import assert from "node:assert/strict";
import { test } from "node:test";

import { COMPTES_DEMO, doitEtreSignale, type EtatCompte } from "../../scripts/verifier-comptes-demo";

/**
 * Règle d'alerte de l'inventaire des comptes de démonstration.
 *
 * ⚠️ Ce que ce test protège : la règle qui décide qu'un compte doit être
 *   signalé. Une erreur ici ne casse rien visiblement — elle laisse simplement
 *   un compte actif avec l'ancien mot de passe public, sans alerte.
 */
const base: EtatCompte = {
  email: "admin@geoforest.eu",
  organisation: "GeoForest Agrobusiness SAS (FR)",
  role: "admin",
  statut: "active",
  motDePasseChangeLe: null,
  mfa: false,
};

test("l'inventaire couvre les cinq comptes créés par l'ancien jeu de démonstration", () => {
  assert.deepEqual([...COMPTES_DEMO].sort(), [
    "admin@geoforest.eu",
    "admin@tenant-b.test",
    "auditeur@geoforest.eu",
    "conformite@geoforest.eu",
    "lecteur@geoforest.eu",
  ]);
});

test("sans date de référence, aucun compte n'est signalé (lecture seule)", () => {
  assert.equal(doitEtreSignale(base, null), false);
});

test("un compte actif au mot de passe jamais changé est signalé", () => {
  assert.equal(doitEtreSignale(base, new Date("2026-10-19T00:00:00Z")), true);
});

test("un compte au mot de passe antérieur à la publication est signalé", () => {
  const compte = { ...base, motDePasseChangeLe: "2026-01-05T10:00:00.000Z" };
  assert.equal(doitEtreSignale(compte, new Date("2026-10-19T00:00:00Z")), true);
});

test("un compte au mot de passe changé après la publication ne l'est pas", () => {
  const compte = { ...base, motDePasseChangeLe: "2026-10-20T08:00:00.000Z" };
  assert.equal(doitEtreSignale(compte, new Date("2026-10-19T00:00:00Z")), false);
});

test("un compte désactivé n'est pas signalé : il ne peut plus se connecter", () => {
  for (const statut of ["suspended", "disabled", "invited"]) {
    const compte = { ...base, statut };
    assert.equal(doitEtreSignale(compte, new Date("2026-10-19T00:00:00Z")), false, statut);
  }
});
