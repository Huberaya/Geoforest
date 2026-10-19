/**
 * P0 — identité opérateur : classification, sans invention.
 *
 * Ces tests fixent la règle : une identité absente reste absente, une valeur
 * de remplissage n'est jamais promue au rang d'identité réelle, et un pays
 * n'est jamais déduit d'autre chose que d'un code ISO explicite (ou du préfixe
 * de l'EORI, qui est lui-même un code pays).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classerIdentite,
  eoriValide,
  identiteComplete,
  identiteDeclaree,
  nomValide,
  paysValide,
} from "../../src/lib/eudr/identite-operateur";

describe("P0 — classement d'une identité opérateur", () => {
  it("accepte une identité complète et la restitue sans transformation", () => {
    const classement = classerIdentite({
      name: "Café Import SAS",
      eori: "fr12345678901234",
      country: "fr",
    });
    assert.equal(classement.statut, "COMPLETE");
    assert.equal(classement.complete, true);

    const identite = identiteComplete({
      name: "  Café Import SAS ",
      eori: "fr12345678901234",
      country: "fr",
    });
    assert.deepEqual(identite, {
      name: "Café Import SAS",
      eori: "FR12345678901234",
      country: "FR",
    });
  });

  it("classe une identité entièrement absente comme ABSENTE, sans valeur par défaut", () => {
    const classement = classerIdentite({});
    assert.equal(classement.statut, "ABSENTE");
    assert.equal(classement.complete, false);
    assert.deepEqual(classement.manquants, ["name", "eori", "country"]);
    assert.equal(identiteComplete({}), null);

    for (const vide of ["", "   ", null, undefined]) {
      assert.equal(identiteComplete({ name: vide, eori: vide, country: vide }), null);
    }
  });

  it("refuse la sentinelle historique XX0000000000000", () => {
    const classement = classerIdentite({
      name: "Opérateur non renseigné",
      eori: "XX0000000000000",
      country: "XX",
    });
    assert.equal(classement.statut, "PLACEHOLDER");
    assert.deepEqual(classement.invalides, ["name", "eori", "country"]);
    assert.equal(identiteComplete({
      name: "Opérateur non renseigné",
      eori: "XX0000000000000",
      country: "XX",
    }), null);
  });

  it("refuse les libellés de remplissage, même avec un EORI plausible", () => {
    for (const nom of [
      "Opérateur non renseigné",
      "operateur non renseigne",
      "Inconnu",
      "UNKNOWN",
      "N/A",
      "-",
      "  non renseigné ",
    ]) {
      assert.equal(nomValide(nom), false, `« ${nom} » devrait être refusé`);
    }
    assert.equal(nomValide("Café Import SAS"), true);
  });

  it("refuse les EORI de remplissage ou hors format", () => {
    assert.equal(eoriValide("XX0000000000000"), false);
    assert.equal(eoriValide("FR0000000000000"), false);
    assert.equal(eoriValide("FR123"), true);
    assert.equal(eoriValide("F123456"), false);
    assert.equal(eoriValide("FR 123 456"), false);
    assert.equal(eoriValide(""), false);
  });

  it("refuse XX comme pays, mais accepte les codes ISO à deux lettres", () => {
    assert.equal(paysValide("XX"), false);
    assert.equal(paysValide("FR"), true);
    assert.equal(paysValide("fr"), true);
    assert.equal(paysValide("FRA"), false);
    assert.equal(paysValide(""), false);
  });

  it("classe une identité partielle comme PARTIELLE, sans compléter les champs manquants", () => {
    const classement = classerIdentite({
      name: "Café Import SAS",
      eori: "FR12345678901234",
      country: null,
    });
    assert.equal(classement.statut, "PARTIELLE");
    assert.deepEqual(classement.manquants, ["country"]);
    assert.equal(identiteComplete({
      name: "Café Import SAS",
      eori: "FR12345678901234",
      country: null,
    }), null);
  });
});

describe("P0 — identité déclarée par un client", () => {
  it("déduit le pays du préfixe EORI seulement si c'est un pays valide", () => {
    assert.equal(
      identiteDeclaree({ name: "Café Import SAS", eori: "FR12345678901234" })?.country,
      "FR",
    );
  });

  it("n'invente pas de pays quand le préfixe EORI n'en est pas un", () => {
    const identite = identiteDeclaree({ name: "Café Import SAS", eori: "XX123456789" });
    assert.equal(identite, null);
  });

  it("refuse un objet partiel plutôt que de le compléter", () => {
    assert.equal(identiteDeclaree({ name: "Café Import SAS" }), null);
    assert.equal(identiteDeclaree({ eori: "FR12345678901234", country: "FR" }), null);
    assert.equal(identiteDeclaree({ name: "Café Import SAS", eori: "FR1", country: "XX" }), null);
  });
});
