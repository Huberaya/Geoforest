/**
 * R-05 — le garde-fou refuse de servir une base dont l'état de sécurité est
 * incomplet, et le prouve au niveau HTTP.
 *
 * ⚠️ Ce que ce fichier démontre, et ce qu'il ne démontre pas.
 *
 *   Démontré : le serveur Next.js réel, les vrais gestionnaires de route et les
 *   vrais cookies répondent 503 `schema_incomplete` dès qu'une politique RLS
 *   manque, y compris sur `POST /api/v1/auth/login`, qui ne passe pas par
 *   `guard()`. Après restauration de la politique, le service reprend sans
 *   redémarrage.
 *
 *   Non démontré ici : l'application de la RLS sous le rôle `geoforest_app`
 *   (le banc PGlite n'a qu'une session, cf. tests/http/harness.ts). Le contrôle
 *   de démarrage `register()` n'est pas couvert non plus : `next dev` prépare
 *   le serveur autrement que la production. Les deux sont couverts par
 *   `tests/sql/etat-schema.test.ts` et par la recette PostgreSQL.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { connecter, demarrerBanc, EMAIL_A, type Banc } from "./harness";

const POLICY = "tenant_isolation_lecture";

async function retirerPolitique(banc: Banc): Promise<void> {
  await banc.client.exec(`drop policy ${POLICY} on gf_products;`);
}

async function restaurerPolitique(banc: Banc): Promise<void> {
  await banc.client.exec(`
    create policy ${POLICY} on gf_products
      for select
      using (organization_id = current_org()
             and current_org() is not null
             and deleted_at is null);
  `);
}

describe("R-05 — schéma incomplet : refus de servir", () => {
  let banc: Banc;

  const ancienDossierGlobal = process.env.GF_STORAGE_DIR;
  const ancienneConfigS3Globale = process.env.S3_BUCKET;

  before(async () => {
    // Le serveur Next est un processus enfant : sa configuration est copiée
    // au démarrage. La panne de stockage doit donc être injectée avant lui.
    process.env.GF_STORAGE_DIR = "/proc/geoforest-health-test/storage";
    delete process.env.S3_BUCKET;
    banc = await demarrerBanc();
  });

  after(async () => {
    await banc?.arreter();
    if (ancienDossierGlobal === undefined) delete process.env.GF_STORAGE_DIR;
    else process.env.GF_STORAGE_DIR = ancienDossierGlobal;
    if (ancienneConfigS3Globale === undefined) delete process.env.S3_BUCKET;
    else process.env.S3_BUCKET = ancienneConfigS3Globale;
  });

  it("sert normalement quand le schéma est complet", async () => {
    const client = banc.clientHttp();
    await connecter(client, EMAIL_A);
    const { statut } = await client.json("/api/v1/suppliers");
    assert.equal(statut, 200);
  });

  it("refuse les routes protégées dès qu'une politique RLS manque", async () => {
    // Session ouverte AVANT la dégradation : le refus doit venir du garde-fou,
    // pas de l'impossibilité de se connecter.
    const client = banc.clientHttp();
    await connecter(client, EMAIL_A);

    await retirerPolitique(banc);

    const { statut, corps } = await client.json<{
      error?: { code?: string; details?: { problemes?: Array<{ code?: string }> } };
    }>("/api/v1/suppliers");
    assert.equal(statut, 503);
    assert.equal(corps.error?.code, "schema_incomplete");
    const codes = (corps.error?.details?.problemes ?? []).map((p) => p.code);
    assert.ok(
      codes.includes("politiques_rls_incompletes"),
      `le détail doit nommer la politique manquante, reçu : ${codes.join(", ")}`,
    );
  });

  it("reste vivante si le stockage est indisponible, mais readiness refuse le trafic", async () => {
    // Le test précédent a volontairement retiré une politique RLS.
    // Réinitialiser le schéma pour isoler le scénario de stockage.
    await restaurerPolitique(banc);

    const health = await banc.clientHttp().json<{
      status?: string;
      composants?: Array<{ nom?: string; etat?: string; critique?: boolean }>;
    }>("/api/health");
    assert.equal(health.statut, 200);
    assert.equal(health.corps.status, "degraded");
    const stockage = health.corps.composants?.find((c) => c.nom === "stockage");
    assert.equal(stockage?.etat, "indisponible");
    assert.equal(stockage?.critique, false);

    const ready = await banc.clientHttp().json<{ ready?: boolean }>("/api/ready");
    assert.equal(ready.statut, 503);
    assert.equal(ready.corps.ready, false);
  });

  it("déclare la sonde de disponibilité non prête, avec le composant schema", async () => {
    // Ce scénario doit contrôler explicitement un schéma incomplet.
    await retirerPolitique(banc);

    const ready = await banc.clientHttp().json<{
      ready?: boolean;
      composants?: Array<{ nom?: string; etat?: string; detail?: string }>;
    }>("/api/ready");
    assert.equal(ready.statut, 503);
    assert.equal(ready.corps.ready, false);
    const schema = ready.corps.composants?.find((c) => c.nom === "schema");
    assert.equal(schema?.etat, "indisponible");
    assert.match(String(schema?.detail), /politiques_rls_incompletes/);

    const health = await banc.clientHttp().json<{ status?: string }>("/api/health");
    assert.equal(health.statut, 503);
  });

  it("refuse aussi la connexion, qui ne passe pas par guard()", async () => {
    const client = banc.clientHttp();
    const { statut, corps } = await client.json<{ error?: { code?: string } }>(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: EMAIL_A, password: "MotDePasse!2026" }),
      },
    );
    assert.equal(statut, 503);
    assert.equal(corps.error?.code, "schema_incomplete");
    assert.equal(client.cookie("gft_access"), undefined, "aucune session ne doit être émise");
  });

  it("reprend le service dès que le schéma est réparé, sans redémarrage", async () => {
    await restaurerPolitique(banc);

    const client = banc.clientHttp();
    await connecter(client, EMAIL_A);
    const { statut } = await client.json("/api/v1/suppliers");
    assert.equal(statut, 200);
  });
});
