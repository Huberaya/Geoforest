import { test, expect } from "@playwright/test";
import path from "node:path";

test.skip(
  process.env.E2E_CLERK_PRODUCTION_SYNTHETIC !== "1",
  "Synthetic production build only; no live Clerk calls",
);
test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
});

test("Production account CSP and outage screen remain safe and responsive", async ({
  page,
}) => {
  const response = await page.goto("/sign-in");
  expect(response?.status()).toBe(200);
  const csp = response?.headers()["content-security-policy"] || "";
  expect(csp).toContain("https://clerk.geoforest.example");
  expect(csp).not.toContain("clerk.accounts.dev");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(response?.headers()["strict-transport-security"]).toContain(
    "max-age=",
  );
  await expect(
    page.getByRole("heading", { name: "Connexion indisponible" }),
  ).toBeVisible({ timeout: 25000 });
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
  }
  await page.screenshot({
    path: path.join(
      process.env.E2E_PROOF_DIR || "test-results",
      "production-login-mobile.png",
    ),
    fullPage: true,
  });
});

test("No business UI appears when production identity cannot be verified", async ({
  page,
}) => {
  await page.goto("/espace");
  await expect(
    page.getByRole("heading", { name: "Connexion indisponible" }),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.getByText("Première configuration")).toHaveCount(0);
  await expect(page.getByText(/Environnement de test local/)).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("Supplier portal remains independent of the production identity provider", async ({
  page,
}) => {
  const identityCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("clerk.geoforest.example"))
      identityCalls.push(request.url());
  });
  await page.goto("/portail");
  await expect(
    page.getByRole("heading", { name: "Partageons les bonnes informations." }),
  ).toBeVisible();
  expect(identityCalls).toEqual([]);
});
