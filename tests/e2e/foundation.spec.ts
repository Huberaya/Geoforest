import { test, expect } from "@playwright/test";
import path from "node:path";
const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
test("Connexion publique responsive sans indicateurs réglementaires fictifs", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Se connecter en toute sécurité" }),
  ).toBeVisible();
  for (const width of [1440, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.screenshot({
    path: path.join("docs/rapports/preuves-chantier-1", "connexion-mobile.png"),
    fullPage: true,
  });
});
test("OIDC réel : connexion, organisation, paramètres, journal, déconnexion", async ({
  page,
}) => {
  test.skip(!username || !password, "Compte Keycloak de recette requis");
  const runtimeErrors: string[] = [];
  page.on("pageerror", (e) => runtimeErrors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("link", { name: "Se connecter en toute sécurité" })
    .click();
  await expect(page.locator("#username")).toBeVisible();
  const authUrl = new URL(page.url());
  expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authUrl.searchParams.get("state")).toBeTruthy();
  expect(authUrl.searchParams.get("nonce")).toBeTruthy();
  await page.locator("#username").fill(username!);
  await page.locator("#password").fill(password!);
  await page.locator("#kc-login").click();
  await expect(
    page.getByRole("heading", { name: "Vue d’ensemble", exact: true }),
  ).toBeVisible();
  const name = "Coopérative Démo " + Date.now();
  await page.getByLabel("Nom de l’organisation").fill(name);
  await page.getByRole("button", { name: "Créer l’organisation" }).click();
  await expect(page.getByRole("status")).toContainText("créée");
  await page.getByRole("button", { name: "Paramètres", exact: true }).click();
  await page.getByLabel("Nom", { exact: true }).fill(name + " test");
  await page
    .getByRole("button", { name: "Enregistrer les modifications" })
    .click();
  await expect(page.getByRole("status")).toContainText("enregistrés");
  await page
    .getByRole("button", { name: "Journal d’activité", exact: true })
    .click();
  await expect(
    page.getByText("Organisation modifiée", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Vue d’ensemble", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({
    path: "docs/rapports/preuves-chantier-1/espace-desktop.png",
    fullPage: true,
  });
  for (const width of [768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.screenshot({
    path: "docs/rapports/preuves-chantier-1/espace-mobile.png",
    fullPage: true,
  });
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name.endsWith("gft-session"));
  expect(session?.httpOnly).toBeTruthy();
  expect(session?.sameSite).toBe("Lax");
  if (process.env.PUBLIC_ORIGIN?.startsWith("https"))
    expect(session?.secure).toBeTruthy();
  await page.getByRole("button", { name: /Se déconnecter/ }).click();
  await expect(
    page.getByRole("link", { name: "Se connecter en toute sécurité" }),
  ).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
