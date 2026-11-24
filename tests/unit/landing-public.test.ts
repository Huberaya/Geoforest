import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("src/app/page.tsx protège le cockpit par getSession() + MFA avant de monter AppShell", () => {
  const home = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf-8");
  assert.ok(home.includes("getSession()"), "HomePage doit vérifier getSession() côté serveur");
  assert.ok(
    home.includes("mfaRequiredFor(session.user.role) && !session.user.mfa"),
    "HomePage doit bloquer l'accès au cockpit tant que la MFA requise n'est pas validée",
  );
  assert.ok(home.includes("<PublicLandingPage />"), "HomePage doit servir PublicLandingPage sans session");
  assert.ok(home.includes("<DashboardClient />"), "HomePage doit servir DashboardClient une fois authentifié");
});

test("PublicLandingPage.tsx est purement statique, sans appel API privé ni injection HTML/style inline", () => {
  const landing = readFileSync(
    join(process.cwd(), "src/components/landing/PublicLandingPage.tsx"),
    "utf-8",
  );
  assert.ok(!landing.includes('"use client"'), "la vitrine publique doit rester un Server Component");
  assert.ok(!landing.includes("dangerouslySetInnerHTML"), "aucun HTML brut non échappé");
  assert.ok(!/\bstyle=\{/.test(landing), "aucun style inline (hygiène CSP)");
  assert.ok(!landing.includes("/api/v1/"), "aucun appel API métier sur la vitrine publique");
  assert.ok(landing.includes('href="/login"'), "doit inclure le lien de connexion /login");
  assert.ok(landing.includes('href="/status"'), "doit inclure le lien /status");
});

test("src/proxy.ts n'ouvre que / en plus des routes publiques existantes et laisse les routes métier fermées", () => {
  const proxy = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf-8");
  const bloc = proxy.match(/const PUBLIC_PATHS = new Set<string>\(\[([\s\S]*?)\]\);/);
  assert.ok(bloc, "PUBLIC_PATHS introuvable dans src/proxy.ts");
  const chemins = [...bloc[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    chemins.sort(),
    [
      "/",
      "/accepter-invitation",
      "/api/health",
      "/api/ready",
      "/api/v1/auth/login",
      "/api/v1/auth/logout",
      "/api/v1/auth/mfa",
      "/api/v1/auth/refresh",
      "/login",
      "/status",
    ],
    "PUBLIC_PATHS ne doit contenir que la liste exacte autorisée",
  );
});
