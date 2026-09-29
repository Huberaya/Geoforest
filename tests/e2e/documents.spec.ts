import { test, expect } from "@playwright/test";

test("Coffre réel, revue, légalité, risque, actions et portail mobile", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(15000);
  test.skip(
    !process.env.E2E_USERNAME || !process.env.E2E_PASSWORD,
    "Compte OIDC requis",
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
  const name = "Documents FICTIFS " + Date.now();
  await page.getByLabel("Nom de l’organisation").fill(name);
  await page.getByRole("button", { name: "Créer l’organisation" }).click();
  await expect(page.getByRole("status")).toContainText("créée");
  const f = await page.evaluate(async (name) => {
    const me = await (await fetch("/api/v1/me")).json();
    const base =
      "/api/v1/organizations/" +
      me.organizations.find((o: { name: string }) => o.name === name).id;
    const call = async (path: string, body: unknown) => {
      const r = await fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrf_token,
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw Error("Fixture " + r.status + " " + (await r.text()));
      return r.json();
    };
    const s = await call("/suppliers", {
      reference: "DOC-FICTIF",
      name: "Fournisseur documentaire fictif",
      country: "CI",
    });
    const p = await call("/products", {
      reference: "DOC-P",
      name: "Cacao fictif",
      commodities: ["cocoa"],
      supplier_ids: [s.id],
      hs_code: "1801",
    });
    const l = await call("/lots", {
      reference: "DOC-LOT",
      supplier_id: s.id,
      product_id: p.id,
      quantity: "10",
      unit: "KG",
      origin_country: "CI",
      production_start: "2025-01-01",
      production_end: "2025-12-31",
    });
    const invitation = await call(`/suppliers/${s.id}/invitations`, {});
    return { base, sid: s.id, lid: l.id, url: invitation.url };
  }, name);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  const vault = page.getByRole("region", { name: "Coffre documentaire" });
  await vault.getByLabel("Fournisseur du document").selectOption(f.sid);
  await vault.getByLabel("Lot concerné — facultatif").selectOption(f.lid);
  await vault
    .getByLabel("Titre du justificatif")
    .fill("Preuve documentaire FICTIVE");
  // Real PNG constructed below in browser, no external file or business data.
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 5;
    c.height = 5;
    const x = c.getContext("2d")!;
    x.fillStyle = "white";
    x.fillRect(0, 0, 5, 5);
    return c.toDataURL().split(",")[1];
  });
  const file = {
    name: "fictif.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  };
  await vault.getByLabel("Fichier PDF, JPEG ou PNG").setInputFiles(file);
  await vault.getByRole("button", { name: "Déposer et contrôler" }).click();
  await expect(vault.locator("article")).toContainText(
    "Contrôles techniques réussis",
    { timeout: 100000 },
  );
  const d = page.waitForEvent("download");
  await vault
    .getByRole("button", { name: "Télécharger le justificatif" })
    .click();
  expect((await d).suggestedFilename()).toMatch(/\.png$/);
  await vault.getByRole("button", { name: "Revoir cette version" }).click();
  await vault
    .getByLabel("Justification de la revue (visible au fournisseur)")
    .fill("Recette fictive uniquement, aucun constat de conformité.");
  await vault.getByRole("button", { name: "Enregistrer la revue" }).click();
  await expect(vault.locator("article")).toContainText("ACCEPTED");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "docs/rapports/preuves-chantier-6/documents-desktop.png",
    fullPage: true,
  });
  for (const width of [768, 390, 360]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "docs/rapports/preuves-chantier-6/documents-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Légalité & risque", exact: true })
    .click();
  const c = page.getByRole("region", { name: "Légalité et risque" });
  await c.getByLabel("Lot à examiner").selectOption(f.lid);
  await c
    .getByLabel("Synthèse de légalité")
    .fill("Cadre national non qualifié, recette fictive seulement.");
  await c
    .getByRole("button", { name: "Enregistrer la légalité", exact: true })
    .click();
  await expect(c.getByRole("status")).toContainText("Enregistrement effectué");
  await c
    .getByText("2. Évaluation du risque — article 10", { exact: true })
    .click();
  await c
    .getByLabel("Motivation de l’évaluation")
    .fill("Dossier fictif incomplet : revue et compléments nécessaires.");
  await c.getByLabel("Risque résiduel proposé").selectOption("NEGLIGIBLE");
  await c
    .getByRole("button", { name: "Enregistrer l’évaluation du risque" })
    .click();
  await expect(c.getByRole("alert")).toBeVisible();
  await c.getByLabel("Risque résiduel proposé").selectOption("UNDETERMINED");
  await c
    .getByRole("button", { name: "Enregistrer l’évaluation du risque" })
    .click();
  await expect(c.getByRole("status")).toContainText("Enregistrement effectué");
  await c
    .getByLabel("Titre de l’action")
    .fill("Obtenir les justificatifs manquants");
  await c
    .getByLabel("Description de l’action")
    .fill("Demande de recette, pas de message réellement envoyé.");
  await c
    .getByRole("combobox", { name: "Responsable", exact: true })
    .selectOption({ index: 1 });
  await c.getByLabel("Échéance", { exact: true }).fill("2026-09-01");
  await c.getByRole("button", { name: "Enregistrer l’action" }).click();
  await expect(
    c.getByText("Obtenir les justificatifs manquants", { exact: true }),
  ).toBeVisible();
  await c.getByRole("button", { name: "Modifier cette action" }).click();
  await c.getByLabel("État de l’action").selectOption("RESOLVED");
  await c
    .getByLabel("Justification de résolution")
    .fill("Preuve fictive revue pour tester la résolution documentée.");
  await c.getByLabel("Preuve de résolution").selectOption({ index: 1 });
  await c.getByRole("button", { name: "Enregistrer l’action" }).click();
  await expect(c.getByText(/RESOLVED · échéance/)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "docs/rapports/preuves-chantier-6/risque-desktop.png",
    fullPage: true,
  });
  for (const width of [768, 390, 360]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "docs/rapports/preuves-chantier-6/risque-mobile.png",
    fullPage: true,
  });
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: process.env.E2E_LOCAL_TLS === "1",
    viewport: { width: 360, height: 900 },
  });
  const portal = await ctx.newPage();
  portal.on("pageerror", (e) => errors.push(e.message));
  await portal.goto(f.url);
  await portal
    .getByRole("button", { name: "Ouvrir mon espace sécurisé" })
    .click();
  const pv = portal.getByRole("region", { name: "Coffre documentaire" });
  await expect(pv.locator("article")).toContainText("ACCEPTED");
  await expect(
    pv.getByRole("button", { name: "Revoir cette version" }),
  ).toHaveCount(0);
  await pv.getByRole("button", { name: "Ajouter une version" }).click();
  await pv.getByLabel("Fichier PDF, JPEG ou PNG").setInputFiles(file);
  await pv.getByRole("button", { name: "Déposer et contrôler" }).click();
  await expect(pv.locator("article")).toHaveCount(2, { timeout: 100000 });
  await expect(pv.locator("article").first()).toContainText(
    "Contrôles techniques réussis",
  );
  expect(
    await portal.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await portal.evaluate(() => window.scrollTo(0, 0));
  await portal.screenshot({
    path: "docs/rapports/preuves-chantier-6/portail-documents-mobile.png",
    fullPage: true,
  });
  expect(
    await portal.evaluate(
      async () => (await fetch("/api/portal/compliance")).status,
    ),
  ).toBe(404);
  await ctx.close();
  expect(errors).toEqual([]);
});
