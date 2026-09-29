import { test, expect } from "@playwright/test";
import path from "node:path";

// Run only against an explicitly selected synthetic Clerk build, never a live IdP.
test.skip(
  process.env.E2E_CLERK_SYNTHETIC !== "1",
  "Synthetic Clerk build required",
);

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) return route.abort();
    return route.continue();
  });
});

test("Clerk unavailable: no business UI, actionable error, mobile layout", async ({
  page,
}) => {
  const response = await page.goto("/sign-in");
  expect(response?.status()).toBe(200);
  const csp = response?.headers()["content-security-policy"] || "";
  expect(csp).toContain("https://synthetic.clerk.accounts.dev");
  expect(csp).not.toContain("'unsafe-eval'");
  await expect(
    page.getByRole("heading", { name: "Connexion indisponible" }),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
  await expect(page.getByText("Première configuration")).toHaveCount(0);
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.screenshot({
    path: path.join(
      process.env.E2E_PROOF_DIR || "test-results",
      "clerk-unavailable-mobile.png",
    ),
    fullPage: true,
  });
});

test("Supplier portal stays independent of Clerk and its outage", async ({
  page,
}) => {
  const clerkRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("clerk.accounts.dev"))
      clerkRequests.push(request.method());
  });
  await page.goto("/portail");
  await expect(
    page.getByRole("heading", { name: "Partageons les bonnes informations." }),
  ).toBeVisible();
  await expect(page.getByText("Vérification de votre connexion")).toHaveCount(
    0,
  );
  expect(clerkRequests).toEqual([]);
  await page.setViewportSize({ width: 360, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
