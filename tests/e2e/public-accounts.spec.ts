import { test, expect } from "@playwright/test";
import path from "node:path";

test.skip(
  process.env.E2E_CLERK_SYNTHETIC !== "1",
  "Use the synthetic Clerk build only",
);
test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
});

test("Public home offers both account actions without backend or Clerk requests", async ({
  page,
}) => {
  const privateRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") ||
      request.url().includes("clerk.accounts.dev") ||
      request.url().includes("clerk.geoforest.example")
    )
      privateRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "documentée",
  );
  const login = page.getByRole("link", {
    name: "Se connecter en toute sécurité",
  });
  await expect(login).toHaveAttribute("href", "/sign-in");
  const signup = page
    .getByRole("navigation")
    .getByRole("link", { name: /Créer un compte/ });
  await expect(signup).toHaveAttribute("href", "/sign-up");
  await expect(
    page.getByRole("link", { name: "Accéder à mon espace" }),
  ).toHaveAttribute("href", "/espace");
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await expect(login).toBeVisible();
    await expect(signup).toBeVisible();
  }
  expect(privateRequests).toEqual([]);
  await page.screenshot({
    path: path.join(
      process.env.E2E_PROOF_DIR || "test-results",
      "accueil-mobile.png",
    ),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: path.join(
      process.env.E2E_PROOF_DIR || "test-results",
      "accueil-desktop.png",
    ),
    fullPage: true,
  });
  await signup.click();
  await expect(
    page.getByRole("heading", { name: "Créer votre compte" }),
  ).toBeVisible();
});

test("Sign-up remains navigable when Clerk is unavailable and never exchanges a business session", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.url());
  });
  await page.goto("/sign-up");
  await expect(
    page.getByRole("heading", { name: "Créer votre compte" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Connexion indisponible" }),
  ).toBeVisible({ timeout: 25000 });
  await expect(
    page.getByRole("link", { name: "Se connecter" }),
  ).toHaveAttribute("href", "/sign-in");
  expect(apiRequests).toEqual([]);
  await page.getByRole("link", { name: "← Retour à l’accueil" }).click();
  await expect(
    page.getByRole("link", { name: "Se connecter en toute sécurité" }),
  ).toBeVisible();
});
