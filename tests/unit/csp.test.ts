import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  EN_TETE_CSP,
  EN_TETE_NONCE,
  HOTE_TUILES_CARTE,
  construireCsp,
  genererNonceCsp,
} from "../../src/lib/security/csp";

function decouperDirectives(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    map.set(tokens[0], tokens.slice(1));
  }
  return map;
}

test("genererNonceCsp produit des nonces base64 distincts de 128 bits", () => {
  const n1 = genererNonceCsp();
  const n2 = genererNonceCsp();
  assert.notEqual(n1, n2);
  assert.match(n1, /^[A-Za-z0-9+/]{22}==$/);
  assert.equal(Buffer.from(n1, "base64").length, 16);
});

test("EN_TETE_CSP impose le mode bloquant (pas Report-Only)", () => {
  assert.equal(EN_TETE_CSP, "Content-Security-Policy");
  assert.equal(EN_TETE_NONCE, "x-nonce");
});

test("CSP production : nonce strict-dynamic, aucun unsafe-eval/unsafe-inline script ni CDN inutile", () => {
  const nonce = "AbCdEfGhIjKlMnOpQrStUv==";
  const csp = construireCsp({ nonce, isProd: true });
  const directives = decouperDirectives(csp);

  const scriptSrc = directives.get("script-src") ?? [];
  assert.ok(scriptSrc.includes("'self'"));
  assert.ok(scriptSrc.includes(`'nonce-${nonce}'`));
  assert.ok(scriptSrc.includes("'strict-dynamic'"));
  assert.ok(!scriptSrc.includes("'unsafe-eval'"), "unsafe-eval interdit en production");
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), "unsafe-inline interdit dans script-src");

  assert.ok(!csp.includes("unpkg.com"), "unpkg.com n'est pas utilisé et ne doit pas être autorisé");
  assert.ok(
    !csp.includes("globalforestwatch.org"),
    "GFW est appelé côté serveur uniquement, jamais par le navigateur",
  );

  const imgSrc = directives.get("img-src") ?? [];
  assert.ok(imgSrc.includes("'self'"));
  assert.ok(imgSrc.includes("data:"));
  assert.ok(imgSrc.includes("blob:"));
  assert.ok(imgSrc.includes(HOTE_TUILES_CARTE));
  assert.ok(!imgSrc.includes("https://*.arcgisonline.com"), "préférer l'hôte exact server.arcgisonline.com");

  assert.deepEqual(directives.get("connect-src"), ["'self'"]);
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("frame-src"), ["'none'"]);
  assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(directives.get("base-uri"), ["'self'"]);
  assert.deepEqual(directives.get("form-action"), ["'self'"]);
  assert.ok(directives.has("upgrade-insecure-requests"), "upgrade-insecure-requests requis en prod");
});

test("CSP développement : autorise unsafe-eval sans forcer HTTPS", () => {
  const csp = construireCsp({ nonce: "dev-nonce", isProd: false });
  const directives = decouperDirectives(csp);

  assert.ok((directives.get("script-src") ?? []).includes("'unsafe-eval'"));
  assert.ok(!directives.has("upgrade-insecure-requests"));
});

test("src/proxy.ts, layout.tsx et next.config.ts sont cohérents sur la CSP bloquante et X-Frame-Options", () => {
  const proxy = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf-8");
  const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf-8");
  const nextConfig = readFileSync(join(process.cwd(), "next.config.ts"), "utf-8");

  assert.ok(
    !/Content-Security-Policy-Report-Only/.test(proxy),
    "src/proxy.ts ne doit plus poser Content-Security-Policy-Report-Only",
  );
  assert.ok(
    proxy.includes("entetes.set(EN_TETE_NONCE, nonce)") &&
      proxy.includes("entetes.set(EN_TETE_CSP, csp)"),
    "src/proxy.ts doit transmettre le nonce et la CSP sur les en-têtes de requête pour Next.js",
  );
  assert.ok(
    /export const dynamic\s*=\s*"force-dynamic"/.test(layout),
    "RootLayout doit être dynamique pour que chaque page reçoive le nonce de la requête",
  );
  assert.ok(
    !/SAMEORIGIN/.test(nextConfig) && /value:\s*"DENY"/.test(nextConfig),
    "next.config.ts doit aligner X-Frame-Options sur DENY",
  );
});

test("MultiPlotMap.tsx construit ses popups via DOM sans interpolation HTML brute", () => {
  const map = readFileSync(join(process.cwd(), "src/components/MultiPlotMap.tsx"), "utf-8");
  assert.ok(
    !/bindPopup\(\s*`/.test(map),
    "MultiPlotMap ne doit pas interpoler des données métier dans une chaîne HTML passée à bindPopup",
  );
  assert.ok(
    map.includes("textContent = p.name") && map.includes("textContent = p.supplierName"),
    "les libellés métier de la popup doivent passer par textContent",
  );
});
