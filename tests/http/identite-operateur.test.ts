/**
 * P0 — identité opérateur : l'absence reste l'absence.
 *
 * ⚠️ Ce que ces tests démontrent au niveau HTTP.
 *
 *   - un audit sans `operator` est accepté et persisté avec des colonnes
 *     nulles : aucune sentinelle n'est inventée ;
 *   - un opérateur sentinelle (`XX0000000000000`) est refusé 422 avec le code
 *     `OPERATOR_IDENTITY_MISSING` ;
 *   - un export sur un dossier sans identité est refusé 422, **avant** le
 *     contrôle de valeur probante ;
 *   - une identité complète est persistée telle quelle, puis l'export échoue
 *     pour la seule raison qui reste — l'analyse simulée — et non pour
 *     l'identité.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { connecterAvecMfa, demarrerBanc, EMAIL_ADMIN_A, type Banc } from "./harness";

// Un polygone fermé valide : un point n'aurait pas de surface exploitable et
// l'audit serait classé INVALID_GEOMETRY, ce qui masquerait le contrôle testé.
const GEOMETRIE = {
  type: "Polygon",
  coordinates: [
    [
      [1.0000001, 2.0000001],
      [1.0100001, 2.0000001],
      [1.0100001, 2.0100001],
      [1.0000001, 2.0100001],
      [1.0000001, 2.0000001],
    ],
  ],
};

function dossier(operator: unknown): Record<string, unknown> {
  return {
    geojson: GEOMETRIE,
    commodity: "coffee",
    harvest_date: "2025-06-01",
    ...(operator === undefined ? {} : { operator }),
  };
}

describe("P0 — identité opérateur", () => {
  let banc: Banc;
  let client: ReturnType<Banc["clientHttp"]>;

  before(async () => {
    banc = await demarrerBanc();
    client = banc.clientHttp();
    await connecterAvecMfa(client, EMAIL_ADMIN_A);
  });

  after(async () => {
    await banc?.arreter();
  });

  async function creerAudit(operator: unknown): Promise<{ statut: number; corps: any }> {
    return client.json<any>("/api/v1/audit/parcel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dossier(operator)),
    });
  }

  it("accepte un audit sans opérateur et persiste des colonnes nulles", async () => {
    const { statut, corps } = await creerAudit(undefined);
    assert.equal(statut, 201, JSON.stringify(corps).slice(0, 300));

    const r = await banc.client.query<{
      operator_name: string | null;
      operator_eori: string | null;
      operator_country: string | null;
    }>(
      "select operator_name, operator_eori, operator_country from parcel_audits where id = $1",
      [corps.audit_id],
    );
    assert.deepEqual(r.rows[0], {
      operator_name: null,
      operator_eori: null,
      operator_country: null,
    });
  });

  it("refuse la sentinelle XX0000000000000 avec OPERATOR_IDENTITY_MISSING", async () => {
    const { statut, corps } = await creerAudit({
      name: "Opérateur non renseigné",
      eori: "XX0000000000000",
      country: "XX",
    });
    assert.equal(statut, 422);
    assert.equal(corps.error?.code, "OPERATOR_IDENTITY_MISSING");
    assert.ok(
      Array.isArray(corps.error?.details?.invalides) && corps.error.details.invalides.length > 0,
      "le refus doit nommer les champs invalides",
    );

    // Aucune ligne n'a été créée avec cette identité.
    const r = await banc.client.query<{ n: number }>(
      "select count(*)::int as n from parcel_audits where operator_eori = 'XX0000000000000'",
    );
    assert.equal(r.rows[0].n, 0);
  });

  it("refuse l'export d'un dossier sans identité, avant tout autre motif", async () => {
    const creation = await creerAudit(undefined);
    const { statut, corps } = await client.json<any>("/api/v1/export/traces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audit_id: creation.corps.audit_id, format: "json" }),
    });
    assert.equal(statut, 422);
    assert.equal(corps.error?.code, "OPERATOR_IDENTITY_MISSING");
    assert.match(String(corps.detail), /Identité opérateur absente/);
  });

  it("persiste une identité complète telle quelle, puis bloque sur la valeur probante", async () => {
    const { statut, corps } = await creerAudit({
      name: "Café Import SAS",
      eori: "FR12345678901234",
      country: "FR",
    });
    assert.equal(statut, 201, JSON.stringify(corps).slice(0, 300));

    const r = await banc.client.query<{
      operator_name: string | null;
      operator_eori: string | null;
      operator_country: string | null;
    }>(
      "select operator_name, operator_eori, operator_country from parcel_audits where id = $1",
      [corps.audit_id],
    );
    assert.deepEqual(r.rows[0], {
      operator_name: "Café Import SAS",
      operator_eori: "FR12345678901234",
      operator_country: "FR",
    });

    const exportation = await client.json<any>("/api/v1/export/traces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audit_id: corps.audit_id, format: "json", country_of_activity: "FR" }),
    });
    assert.equal(exportation.statut, 409, JSON.stringify(exportation.corps).slice(0, 300));
    assert.equal(exportation.corps.is_probative, false);
  });
});
