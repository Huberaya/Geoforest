import assert from "node:assert/strict";
import test from "node:test";

import { adresseClient } from "../../src/lib/rate-limit";

function entetes(valeurs: Record<string, string>): Headers {
  return new Headers(valeurs);
}

function avecSauts<T>(valeur: string | undefined, fn: () => T): T {
  const ancien = process.env.GF_TRUSTED_PROXY_HOPS;
  if (valeur === undefined) delete process.env.GF_TRUSTED_PROXY_HOPS;
  else process.env.GF_TRUSTED_PROXY_HOPS = valeur;
  try {
    return fn();
  } finally {
    if (ancien === undefined) delete process.env.GF_TRUSTED_PROXY_HOPS;
    else process.env.GF_TRUSTED_PROXY_HOPS = ancien;
  }
}

test("un seul mandataire : la dernière entrée est celle du client", () => {
  // Un attaquant place une fausse adresse à gauche ; le répartiteur ajoute la
  // vraie à droite. Lire la première entrée revenait à le laisser choisir.
  const ip = adresseClient(entetes({ "x-forwarded-for": "6.6.6.6, 198.51.100.7" }));
  assert.equal(ip, "198.51.100.7");
});

test("deux mandataires : on remonte de deux entrées", () => {
  const ip = avecSauts("2", () =>
    adresseClient(entetes({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })),
  );
  assert.equal(ip, "203.0.113.9");
});

test("une seule entrée reste lue correctement quel que soit le réglage", () => {
  for (const sauts of ["0", "1", "2", "10"]) {
    const ip = avecSauts(sauts, () =>
      adresseClient(entetes({ "x-forwarded-for": "203.0.113.9" })),
    );
    assert.equal(ip, "203.0.113.9", `sauts=${sauts}`);
  }
});

test("les entrées invalides sont écartées sans faire tomber la lecture", () => {
  const ip = adresseClient(
    entetes({ "x-forwarded-for": "pas-une-ip, 198.51.100.7, <script>" }),
  );
  assert.equal(ip, "198.51.100.7");
});

test("un port IPv4 est retiré", () => {
  assert.equal(
    adresseClient(entetes({ "x-forwarded-for": "203.0.113.9:44321" })),
    "203.0.113.9",
  );
});

test("une IPv6 entre crochets est normalisée", () => {
  assert.equal(
    adresseClient(entetes({ "x-forwarded-for": "[2001:db8::1]:443" })),
    "2001:db8::1",
  );
});

test("x-real-ip sert de repli, et l'absence totale vaut « inconnue »", () => {
  assert.equal(adresseClient(entetes({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
  assert.equal(adresseClient(entetes({})), "inconnue");
});

test("un réglage aberrant retombe sur un mandataire", () => {
  for (const sauts of ["-1", "99", "abc", "1.5"]) {
    const ip = avecSauts(sauts, () =>
      adresseClient(entetes({ "x-forwarded-for": "6.6.6.6, 198.51.100.7" })),
    );
    assert.equal(ip, "198.51.100.7", `sauts=${sauts}`);
  }
});
