import { test, expect } from "@playwright/test";
test("Cohérence pays : résultat sourcé, historique immuable et pays non couvert", async ({
  page,
}) => {
  test.setTimeout(150000);
  test.skip(
    !process.env.E2E_USERNAME || !process.env.E2E_PASSWORD,
    "Compte OIDC de recette requis",
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/espace");
  await page
    .getByRole("link", { name: "Se connecter en toute sécurité" })
    .click();
  await page.locator("#username").fill(process.env.E2E_USERNAME!);
  await page.locator("#password").fill(process.env.E2E_PASSWORD!);
  await page.locator("#kc-login").click();
  const name = "GIS Démo " + Date.now();
  await page.getByLabel("Nom de l’organisation").fill(name);
  await page.getByRole("button", { name: "Créer l’organisation" }).click();
  await expect(page.getByRole("status")).toContainText("créée");
  const fixture = await page.evaluate(async (name) => {
    const me = await (await fetch("/api/v1/me")).json();
    const org = me.organizations.find(
      (o: { name: string }) => o.name === name,
    ).id;
    const base = "/api/v1/organizations/" + org;
    const call = async (path: string, body: unknown) => {
      const r = await fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrf_token,
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("Fixture failed " + r.status);
      return r.json();
    };
    const s = await call("/suppliers", {
      reference: "GIS-SUP",
      name: "Fournisseur fictif GIS",
      country: "CI",
    });
    const payload = {
      supplier_id: s.id,
      reference: "GIS-001",
      name: "Point de test inventé",
      country: "CI",
      geometry: { type: "Point", coordinates: [-5.5, 7.5] },
      acknowledge_warnings: true,
    };
    const p = await call("/plots", payload);
    return { base, id: p.id, payload };
  }, name);
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Parcelles", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Point de test inventé", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  let checks = dialog.getByRole("region", {
    name: "Cohérence pays indicative",
  });
  await expect(
    checks.getByText("Aucune comparaison enregistrée pour cette révision."),
  ).toBeVisible();
  await expect(
    checks.getByRole("button", { name: "Comparer le pays de cette révision" }),
  ).toBeDisabled();
  await checks.getByLabel("Marge de revue près des limites (m)").fill("1000");
  await checks
    .getByRole("button", { name: "Comparer le pays de cette révision" })
    .click();
  await expect(
    checks.getByText("Dans le référentiel — indicatif", { exact: true }),
  ).toBeVisible();
  await checks
    .getByText("Provenance et limites du contrôle", { exact: true })
    .click();
  await expect(checks.getByText(/NE-10M-MAPUNITS-CI/)).toBeVisible();
  await expect(
    checks.getByText(
      "Revue humaine nécessaire · pays non vérifié · risque non évalué",
    ),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await dialog.screenshot({
    path: "docs/rapports/preuves-chantier-4/monde-coherence-desktop.png",
  });
  await dialog.getByRole("button", { name: "Fermer la fenêtre" }).click();
  await page.evaluate(async (f) => {
    const me = await (await fetch("/api/v1/me")).json();
    const { supplier_id, ...data } = f.payload;
    void supplier_id;
    const r = await fetch(f.base + "/plots/" + f.id, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": me.csrf_token,
      },
      body: JSON.stringify({ ...data, country: "AQ", version: 1 }),
    });
    if (!r.ok) throw new Error("Revision fixture failed " + r.status);
  }, fixture);
  await page
    .getByRole("button", { name: "Point de test inventé", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  checks = dialog.getByRole("region", { name: "Cohérence pays indicative" });
  await expect(
    checks.getByText("Aucune comparaison enregistrée pour cette révision."),
  ).toBeVisible();
  await checks.getByLabel("Marge de revue près des limites (m)").fill("0");
  await checks
    .getByRole("button", { name: "Comparer le pays de cette révision" })
    .click();
  await expect(
    checks.getByText("Pays non couvert", { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("Révision consultée").selectOption("1");
  checks = dialog.getByRole("region", { name: "Cohérence pays indicative" });
  await expect(
    checks.getByText("Dans le référentiel — indicatif", { exact: true }),
  ).toBeVisible();
  await expect(
    checks.getByText("Pays non couvert", { exact: true }),
  ).toHaveCount(0);
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBeTruthy();
  }
  await checks.locator("article").first().screenshot({
    path: "docs/rapports/preuves-chantier-4/monde-coherence-mobile.png",
  });
  expect(errors).toEqual([]);
  // Renewal of the shared network-peer quota before the following dense suites.
  if (process.env.E2E_RATE_PACE === "1")
    await new Promise((resolve) => setTimeout(resolve, 65000));
});
