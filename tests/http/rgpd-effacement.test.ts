/**
 * Contrats HTTP réels pour `POST /api/v1/rgpd/effacement` (art. 17 RGPD / art. 12 EUDR).
 *
 * Vérifie sur le serveur Next.js démarré :
 *  - refus 401 sans session ;
 *  - refus 403 pour un lecteur (`viewer`) ;
 *  - refus 422 si `organizationId` est envoyé dans le corps ;
 *  - refus 409 motivé (art. 17.3.b / EUDR 5 ans) pour les cibles métier ;
 *  - cloisonnement inter-tenant strict (admin B reçoit 404 sur le fournisseur de A,
 *    et les coordonnées de A restent intactes) ;
 *  - effacement effectif des coordonnées de contact du fournisseur de A (contact_* → NULL),
 *    conservation de la fiche fournisseur, idempotence, et absence des données effacées
 *    dans le journal d'audit.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { SUPPLIER_A } from "../helpers/migrations";
import {
  connecter,
  connecterAvecMfa,
  demarrerBanc,
  EMAIL_A,
  EMAIL_ADMIN_A,
  EMAIL_ADMIN_B,
  type Banc,
} from "./harness";

let banc: Banc;
let adminA: ReturnType<Banc["clientHttp"]>;

const CONTACT_NOM = "Koffi Kouassi";
const CONTACT_EMAIL = "koffi.confidentiel@coop-a.test";
const CONTACT_TEL = "+2250701020304";

describe("HTTP — Effacement RGPD encadré (POST /api/v1/rgpd/effacement)", () => {
  before(async () => {
    banc = await demarrerBanc();
    // Renseigner des coordonnées personnelles sur le fournisseur de l'organisation A.
    await banc.client.query(
      `update gf_suppliers
          set contact_name = $1, contact_email = $2, contact_phone = $3
        where id = $4`,
      [CONTACT_NOM, CONTACT_EMAIL, CONTACT_TEL, SUPPLIER_A],
    );
    adminA = banc.clientHttp();
    await connecterAvecMfa(adminA, EMAIL_ADMIN_A);
  });

  after(async () => {
    await banc?.arreter();
  });

  it("refuse 401 sans session et 403 pour un lecteur (viewer)", async () => {
    const anonyme = banc.clientHttp();
    const r401 = await anonyme.fetch("/api/v1/rgpd/effacement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cible: "fournisseur_contact", supplierId: SUPPLIER_A }),
    });
    assert.equal(r401.status, 401);

    const lecteur = banc.clientHttp();
    await connecter(lecteur, EMAIL_A);
    const r403 = await lecteur.fetch("/api/v1/rgpd/effacement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cible: "fournisseur_contact", supplierId: SUPPLIER_A }),
    });
    assert.equal(r403.status, 403);
  });

  it("refuse l'effacement cross-tenant (404) sans altérer les données de l'organisation A", async () => {
    const adminB = banc.clientHttp();
    await connecterAvecMfa(adminB, EMAIL_ADMIN_B);

    const r404 = await adminB.json<{ detail?: string }>("/api/v1/rgpd/effacement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cible: "fournisseur_contact", supplierId: SUPPLIER_A }),
    });
    assert.equal(r404.statut, 404);

    // Preuve en base : les coordonnées du fournisseur A n'ont pas bougé.
    const verif = await banc.client.query<{ contact_email: string | null }>(
      "select contact_email from gf_suppliers where id = $1",
      [SUPPLIER_A],
    );
    assert.equal(verif.rows[0]?.contact_email, CONTACT_EMAIL);
  });

  it("refuse organizationId (422) et refuse en 409 les cibles soumises à conservation légale EUDR 5 ans", async () => {
    const r422 = await adminA.json<{ error?: { code?: string } }>("/api/v1/rgpd/effacement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cible: "fournisseur_contact",
        supplierId: SUPPLIER_A,
        organizationId: "22222222-2222-4222-8222-222222222222",
      }),
    });
    assert.equal(r422.statut, 422);
    assert.equal(r422.corps.error?.code, "organisation_interdite");

    const r409 = await adminA.json<{
      statut?: string;
      base_legale?: string;
      duree_conservation?: string;
    }>("/api/v1/rgpd/effacement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cible: "dossier_ddr" }),
    });
    assert.equal(r409.statut, 409);
    assert.equal(r409.corps.statut, "refuse_conservation_legale");
    assert.match(r409.corps.base_legale ?? "", /17\.3\.b/);
    assert.match(r409.corps.duree_conservation ?? "", /5 ans/);

    // Protection P1-07 : une structure JSON trop profondément imbriquée est
    // rejetée en 422 par `lireCorpsJson` avec en-têtes privés conservés.
    let imbrique: unknown = "fin";
    for (let i = 0; i < 40; i += 1) imbrique = { a: imbrique };
    const rProfondeur = await adminA.json<{ detail?: string }>("/api/v1/rgpd/effacement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cible: "fournisseur_contact", motif: imbrique }),
    });
    assert.equal(rProfondeur.statut, 422);
    assert.equal(rProfondeur.entetes.get("cache-control"), "no-store");
    assert.equal(rProfondeur.entetes.get("x-robots-tag"), "noindex");
  });

  it("efface les coordonnées de contact du fournisseur A, préserve la fiche, est idempotent et ne fuite rien dans le journal d'audit", async () => {
    const r200 = await adminA.json<{
      statut?: string;
      champs_effaces?: string[];
      supplier_id?: string;
    }>("/api/v1/rgpd/effacement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cible: "fournisseur_contact",
        supplierId: SUPPLIER_A,
        motif: "Fin de contrat fournisseur",
      }),
    });
    assert.equal(r200.statut, 200);
    assert.equal(r200.corps.statut, "efface");
    assert.equal(r200.corps.supplier_id, SUPPLIER_A);
    assert.deepEqual(r200.corps.champs_effaces, [
      "contact_name",
      "contact_email",
      "contact_phone",
    ]);
    assert.equal(r200.entetes.get("cache-control"), "no-store");
    assert.equal(r200.entetes.get("x-robots-tag"), "noindex");

    // La fiche fournisseur existe toujours, ses coordonnées personnelles sont NULL.
    const fiche = await banc.client.query<{
      name: string;
      contact_name: string | null;
      contact_email: string | null;
      contact_phone: string | null;
    }>(
      "select name, contact_name, contact_email, contact_phone from gf_suppliers where id = $1",
      [SUPPLIER_A],
    );
    assert.equal(fiche.rows.length, 1);
    assert.ok(fiche.rows[0].name.length > 0, "la raison sociale reste conservée pour l'EUDR");
    assert.equal(fiche.rows[0].contact_name, null);
    assert.equal(fiche.rows[0].contact_email, null);
    assert.equal(fiche.rows[0].contact_phone, null);

    // Le journal d'audit trace l'opération PURGE sans aucune valeur effacée.
    const journaux = await banc.client.query<{
      action: string;
      details: unknown;
      avant: unknown;
      apres: unknown;
    }>(
      "select action, details, avant, apres from gf_audit_logs where entity_id = $1 and action = 'PURGE'",
      [SUPPLIER_A],
    );
    assert.equal(journaux.rows.length, 1);
    const serialise = JSON.stringify(journaux.rows[0]);
    assert.ok(!serialise.includes(CONTACT_EMAIL), "l'e-mail effacé ne doit pas apparaître dans l'audit");
    assert.ok(!serialise.includes(CONTACT_TEL), "le téléphone effacé ne doit pas apparaître dans l'audit");
    assert.ok(!serialise.includes(CONTACT_NOM), "le nom effacé ne doit pas apparaître dans l'audit");

    // Second appel idempotent.
    const rejeu = await adminA.json<{ statut?: string; champs_effaces?: string[] }>(
      "/api/v1/rgpd/effacement",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cible: "fournisseur_contact", supplierId: SUPPLIER_A }),
      },
    );
    assert.equal(rejeu.statut, 200);
    assert.equal(rejeu.corps.statut, "deja_efface");
    assert.deepEqual(rejeu.corps.champs_effaces, []);
  });
});
