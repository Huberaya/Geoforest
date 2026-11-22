/**
 * Contrats HTTP réels pour la CSP bloquante et les nonces par requête.
 *
 * Vérifie sur le serveur Next.js démarré :
 *  - présence de l'en-tête bloquant `Content-Security-Policy` (absence de Report-Only) ;
 *  - génération d'un nonce cryptographique distinct à chaque requête ;
 *  - propagation du nonce par Next.js sur toutes les balises `<script>` rendues ;
 *  - présence de `X-Frame-Options: DENY` et absence de `unpkg.com` / GFW dans la CSP ;
 *  - en-têtes présents aussi sur les réponses API (200 et 401).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { demarrerBanc, type Banc } from "./harness";

let banc: Banc;

function extraireNonce(csp: string | null): string | null {
  if (!csp) return null;
  const m = /'nonce-([^']+)'/.exec(csp);
  return m?.[1] ?? null;
}

describe("HTTP — CSP bloquante et propagation des nonces", () => {
  before(async () => {
    banc = await demarrerBanc();
  });

  after(async () => {
    await banc?.arreter();
  });

  it("sert /login avec une CSP bloquante, un nonce distinct par requête et des balises <script> estampillées", async () => {
    const client = banc.clientHttp();

    const r1 = await client.fetch("/login");
    assert.equal(r1.status, 200);
    const csp1 = r1.headers.get("content-security-policy");
    assert.ok(csp1, "Content-Security-Policy absent sur /login");
    assert.equal(
      r1.headers.get("content-security-policy-report-only"),
      null,
      "Content-Security-Policy-Report-Only ne doit plus être émis",
    );
    assert.equal(r1.headers.get("x-frame-options"), "DENY");
    assert.ok(!csp1.includes("unpkg.com"), "unpkg.com ne doit plus figurer dans la CSP");
    assert.ok(
      !csp1.includes("globalforestwatch.org"),
      "globalforestwatch.org ne doit plus figurer dans la CSP",
    );
    assert.ok(csp1.includes("object-src 'none'"));
    assert.ok(csp1.includes("frame-ancestors 'none'"));

    const nonce1 = extraireNonce(csp1);
    assert.ok(nonce1, "nonce absent de la CSP sur /login");

    const html1 = await r1.text();
    const scripts1 = [...html1.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
    assert.ok(scripts1.length > 0, "au moins une balise <script> Next.js attendue sur /login");
    const sansNonce = scripts1.filter((attrs) => !attrs.includes(`nonce="${nonce1}"`));
    assert.equal(
      sansNonce.length,
      0,
      `balise(s) <script> sans le nonce de la requête sur /login : ${sansNonce.join(" | ")}`,
    );

    const r2 = await client.fetch("/login");
    assert.equal(r2.status, 200);
    const nonce2 = extraireNonce(r2.headers.get("content-security-policy"));
    assert.ok(nonce2);
    assert.notEqual(nonce1, nonce2, "deux requêtes consécutives doivent recevoir deux nonces distincts");
  });

  it("applique la CSP bloquante et X-Frame-Options sur les routes API (200 et 401)", async () => {
    const client = banc.clientHttp();

    const sante = await client.fetch("/api/health");
    assert.ok(sante.headers.get("content-security-policy"));
    assert.equal(sante.headers.get("content-security-policy-report-only"), null);
    assert.equal(sante.headers.get("x-frame-options"), "DENY");

    const nonAuth = await client.fetch("/api/v1/plots");
    assert.equal(nonAuth.status, 401);
    assert.ok(nonAuth.headers.get("content-security-policy"));
    assert.equal(nonAuth.headers.get("content-security-policy-report-only"), null);
    assert.equal(nonAuth.headers.get("x-frame-options"), "DENY");
  });
});
