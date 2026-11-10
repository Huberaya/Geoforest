/**
 * Lot A / P0 — identité opérateur : une seule classification, sans invention.
 *
 * Ces tests fixent la règle après fusion des deux lignes de travail :
 *   · une identité absente reste absente (`missing`) ;
 *   · la sentinelle historique est reconnue (`legacy_placeholder`) et jamais
 *     promue au rang d'identité réelle ;
 *   · un EORI vide n'est pas valide ;
 *   · un dossier sans nom n'est pas complet ;
 *   · `XX` n'est pas un pays.
 *
 * Ils couvrent aussi la résolution d'export : le pays n'est jamais inventé, il
 * provient d'une déclaration ou du préfixe de l'EORI.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classerIdentiteOperateur,
  eoriValide,
  identiteComplete,
  identiteDeclaree,
  nomValide,
  paysValide,
  resoudreIdentiteExport,
} from "../../src/lib/eudr/identite-operateur";

describe("Lot A — classement d'une identité opérateur", () => {
  it("classe une identité réellement déclarée", () => {
    const classement = classerIdentiteOperateur("Café Import SAS", "FR12345678901234");
    assert.equal(classement.etat, "declared");
    assert.equal(classement.exportable, true);
    assert.equal(classement.raison, "");
  });

  it("classe une identité entièrement absente comme missing, sans valeur par défaut", () => {
    for (const [nom, eori] of [
      [null, null],
      ["", ""],
      ["   ", "   "],
      [undefined, undefined],
    ] as const) {
      const classement = classerIdentiteOperateur(nom, eori);
      assert.equal(classement.etat, "missing");
      assert.equal(classement.exportable, false);
      assert.ok(classement.raison.length > 0);
    }
  });

  it("reconnaît la sentinelle historique sans la réécrire", () => {
    for (const eori of ["XX0000000000000", "xx0000000000000", " XX0000000000000 "]) {
      const classement = classerIdentiteOperateur("Opérateur non renseigné", eori);
      assert.equal(classement.etat, "legacy_placeholder");
      assert.equal(classement.exportable, false);
    }
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

  it("refuse les EORI de remplissage, vides ou hors format", () => {
    assert.equal(eoriValide("XX0000000000000"), false);
    assert.equal(eoriValide("FR0000000000000"), false);
    assert.equal(eoriValide("FR123"), true);
    assert.equal(eoriValide("F123456"), false);
    assert.equal(eoriValide("FR 123 456"), false);
    assert.equal(eoriValide(""), false);
    assert.equal(eoriValide(null), false);
  });

  it("refuse XX comme pays, mais accepte les codes ISO à deux lettres", () => {
    assert.equal(paysValide("XX"), false);
    assert.equal(paysValide("FR"), true);
    assert.equal(paysValide("fr"), true);
    assert.equal(paysValide("FRA"), false);
    assert.equal(paysValide(""), false);
  });

  it("refuse un EORI valide sans nom : un dossier sans nom n'est pas complet", () => {
    const classement = classerIdentiteOperateur("", "FR12345678901234");
    assert.equal(classement.etat, "missing");
    assert.equal(classement.exportable, false);
    assert.match(classement.raison, /nom/i);
  });
});

describe("Lot A — identité déclarée ou stockée", () => {
  it("accepte une identité complète et la restitue normalisée", () => {
    const identite = identiteDeclaree({
      name: "  Café Import SAS ",
      eori: "fr12345678901234",
      country: "fr",
    });
    assert.deepEqual(identite, {
      name: "Café Import SAS",
      eori: "FR12345678901234",
      country: "FR",
      address: null,
      email: null,
    });
  });

  it("n'invente pas de pays : absent vaut null, jamais FR ni XX", () => {
    assert.equal(
      identiteDeclaree({ name: "Café Import SAS", eori: "FR12345678901234" })?.country,
      null,
    );
    assert.equal(
      identiteDeclaree({ name: "Café Import SAS", eori: "FR12345678901234", country: "XX" }),
      null,
    );
  });

  it("refuse un objet partiel plutôt que de le compléter", () => {
    assert.equal(identiteDeclaree({ name: "Café Import SAS" }), null);
    assert.equal(identiteDeclaree({ eori: "FR12345678901234", country: "FR" }), null);
    assert.equal(identiteDeclaree({ name: "Café Import SAS", eori: "FR1", country: "XX" }), null);
    assert.equal(identiteDeclaree({ name: "Café Import SAS", eori: "" }), null);
  });

  it("identiteComplete exige un nom et un EORI ; le pays est facultatif", () => {
    assert.equal(identiteComplete({}), null);
    for (const vide of ["", "   ", null, undefined]) {
      assert.equal(identiteComplete({ name: vide, eori: vide, country: vide }), null);
    }
    assert.deepEqual(
      identiteComplete({ name: "Café Import SAS", eori: "FR12345678901234", country: null }),
      { name: "Café Import SAS", eori: "FR12345678901234", country: null, address: null, email: null },
    );
    assert.equal(
      identiteComplete({ name: "Café Import SAS", eori: "FR12345678901234", country: "XX" }),
      null,
    );
    assert.equal(
      identiteComplete({ name: "Opérateur non renseigné", eori: "XX0000000000000", country: "XX" }),
      null,
    );
  });
});

describe("Lot A — résolution de l'identité à l'export", () => {
  const stockeeVide = { name: null, eori: null, country: null, address: null };

  it("refuse un dossier sans identité", () => {
    const resultat = resoudreIdentiteExport(stockeeVide, undefined);
    assert.equal(resultat.statut, "refus");
    if (resultat.statut === "refus") assert.equal(resultat.etat, "missing");
  });

  it("refuse un dossier hérité portant la sentinelle, même avec un nom", () => {
    const resultat = resoudreIdentiteExport(
      { name: "Opérateur non renseigné", eori: "XX0000000000000", country: "XX", address: null },
      undefined,
    );
    assert.equal(resultat.statut, "refus");
    if (resultat.statut === "refus") assert.equal(resultat.etat, "legacy_placeholder");
  });

  it("accepte une identité de dossier et déduit le pays du préfixe EORI", () => {
    const resultat = resoudreIdentiteExport(
      { name: "Café Import SAS", eori: "FR12345678901234", country: null, address: null },
      undefined,
    );
    assert.equal(resultat.statut, "ok");
    if (resultat.statut === "ok") {
      assert.equal(resultat.operator.country, "FR");
      assert.equal(resultat.source, "dossier");
    }
  });

  it("refuse une identité de requête avec EORI vide", () => {
    const resultat = resoudreIdentiteExport(stockeeVide, { name: "Café Import SAS", eori: "" });
    assert.equal(resultat.statut, "invalide");
  });

  it("refuse une identité de requête avec XX comme pays", () => {
    const resultat = resoudreIdentiteExport(stockeeVide, {
      name: "Café Import SAS",
      eori: "FR12345678901234",
      country: "XX",
    });
    assert.equal(resultat.statut, "invalide");
  });
});
