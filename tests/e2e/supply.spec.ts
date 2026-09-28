import { test, expect } from "@playwright/test";
const username = process.env.E2E_USERNAME,
  password = process.env.E2E_PASSWORD;
test("Collecte réelle : CSV, fournisseur, produit, lot, portail mobile et revue humaine", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  test.skip(!username || !password, "Compte Keycloak de recette requis");
  // An explicit quota window between dense browser scenarios, never a UI readiness wait.
  // Keep the application's real rate limit unchanged; useful behind a shared local proxy.
  if (process.env.E2E_RATE_PACE === "1")
    await new Promise((resolve) => setTimeout(resolve, 65000));
  const runtimeErrors: string[] = [];
  page.on("pageerror", (e) => runtimeErrors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("link", { name: "Se connecter en toute sécurité" })
    .click();
  await page.locator("#username").fill(username!);
  await page.locator("#password").fill(password!);
  await page.locator("#kc-login").click();
  await expect(
    page.getByRole("heading", { name: "Vue d’ensemble", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Nom de l’organisation")
    .fill("Collecte Démo " + Date.now());
  await page.getByRole("button", { name: "Créer l’organisation" }).click();
  await expect(page.getByRole("status")).toContainText("créée");
  await page.getByRole("button", { name: "Fournisseurs", exact: true }).click();
  await page
    .getByRole("button", { name: "+ Ajouter un fournisseur", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Référence interne").fill("DEMO-CACAO");
  await dialog
    .getByLabel("Nom de l’organisation")
    .fill("Coopérative Cacao — FICTIF");
  await dialog
    .getByRole("combobox", { name: "Pays", exact: true })
    .selectOption("CI");
  await dialog
    .getByLabel("Email de l’organisation")
    .fill("collecte@example.invalid");
  await dialog
    .getByLabel("Adresse", { exact: true })
    .fill("Adresse synthétique — aucune localisation réelle");
  await dialog
    .getByRole("button", { name: "Enregistrer le fournisseur" })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".supply-metrics")).toHaveCSS("display", "grid");
  await page.getByRole("button", { name: "Importer CSV", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Contenu CSV")
    .fill("reference,name,country\nDEMO-BOIS,Bois synthétique,FR");
  await dialog.getByRole("button", { name: "Vérifier le fichier" }).click();
  await expect(dialog).toContainText("1 fournisseur(s) prêt(s)");
  await dialog.getByRole("button", { name: "Confirmer l’import" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Bois synthétique", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "docs/rapports/preuves-chantier-2/fournisseurs-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Produits", exact: true }).click();
  await page
    .getByRole("button", { name: "+ Ajouter un produit", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Référence interne").fill("PROD-CACAO");
  await dialog.getByLabel("Nom du produit").fill("Fèves de cacao — FICTIF");
  await dialog.getByLabel("Cacao", { exact: true }).check();
  await dialog.getByLabel("Code SH / NC déclaré").fill("1801");
  await dialog.getByRole("checkbox", { name: /Coopérative Cacao/ }).check();
  await dialog.getByRole("button", { name: "Enregistrer le produit" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Lots", exact: true }).click();
  await page
    .getByRole("button", { name: "+ Ajouter un lot", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Référence interne").fill("LOT-DEMO-001");
  await expect(
    dialog.getByLabel("Fournisseur du lot", { exact: true }),
  ).toContainText("Coopérative Cacao");
  await dialog
    .getByLabel("Fournisseur du lot", { exact: true })
    .selectOption({ label: "Coopérative Cacao — FICTIF · DEMO-CACAO" });
  await expect(
    dialog.getByLabel("Produit fourni", { exact: true }),
  ).toContainText("Fèves de cacao");
  await dialog
    .getByLabel("Produit fourni", { exact: true })
    .selectOption({ label: "Fèves de cacao — FICTIF · PROD-CACAO" });
  await dialog.getByLabel("Quantité").fill("2500,125");
  await dialog.getByLabel("Pays de production déclaré").selectOption("CI");
  await dialog.getByLabel("Début de production").fill("2025-01-01");
  await dialog.getByLabel("Fin de production").fill("2025-01-31");
  await dialog.getByRole("button", { name: "Enregistrer le lot" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("2500.125 KG")).toBeVisible();
  await page.getByRole("button", { name: "Fournisseurs", exact: true }).click();
  await page
    .getByRole("button", { name: "Coopérative Cacao — FICTIF", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom du contact").fill("Contact entièrement fictif");
  await dialog.getByLabel("Email du contact").fill("contact@example.invalid");
  await dialog
    .getByRole("button", { name: "Ajouter le contact", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Contact enregistré");
  await dialog.getByRole("button", { name: "Créer un lien sécurisé" }).click();
  const link = dialog.getByLabel("Lien sécurisé — affiché une seule fois");
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  await dialog.getByRole("button", { name: "Masquer le lien" }).click();
  await dialog.getByRole("button", { name: "Fermer la fenêtre" }).click();
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: process.env.E2E_LOCAL_TLS === "1",
    viewport: { width: 390, height: 844 },
  });
  const supplier = await ctx.newPage();
  supplier.on("pageerror", (e) => runtimeErrors.push(e.message));
  const requests: string[] = [];
  supplier.on("request", (r) => requests.push(r.url()));
  await supplier.goto(url);
  await expect(
    supplier.getByRole("button", { name: "Ouvrir mon espace sécurisé" }),
  ).toBeVisible();
  expect(new URL(supplier.url()).hash).toBe("");
  expect(requests.some((r) => r.includes("invite="))).toBe(false);
  await supplier
    .getByRole("button", { name: "Ouvrir mon espace sécurisé" })
    .click();
  await expect(
    supplier.getByRole("heading", { name: "Votre organisation", exact: true }),
  ).toBeVisible();
  await supplier.getByLabel("Nom du contact").fill("Responsable synthétique");
  await supplier
    .getByRole("button", { name: "Enregistrer mon brouillon" })
    .click();
  await expect(supplier.getByRole("status")).toContainText(
    "Brouillon enregistré",
  );
  await supplier.reload();
  await expect(supplier.getByLabel("Nom du contact")).toHaveValue(
    "Responsable synthétique",
  );
  await supplier.getByRole("button", { name: "Continuer" }).click();
  await supplier.getByRole("button", { name: "+ Ajouter un produit" }).click();
  await supplier.getByLabel("Nom du produit").fill("Cacao déclaré — FICTIF");
  await supplier.getByLabel("Matière déclarée").selectOption("cocoa");
  await supplier.getByLabel("Quantité").fill("2500.125");
  await supplier.getByLabel("Pays de production déclaré").selectOption("CI");
  await supplier
    .getByRole("button", { name: "Enregistrer mon brouillon" })
    .click();
  await expect(supplier.getByRole("status")).toContainText(
    "Brouillon enregistré",
  );
  for (const width of [390, 360]) {
    await supplier.setViewportSize({ width, height: 900 });
    expect(
      await supplier.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await supplier.screenshot({
    path: "docs/rapports/preuves-chantier-2/portail-produits-mobile.png",
    fullPage: true,
  });
  await supplier.getByRole("button", { name: "Continuer" }).click();
  await supplier
    .getByRole("checkbox", { name: /Je confirme avoir relu/ })
    .check();
  await supplier
    .getByRole("button", { name: "Transmettre à mon client" })
    .click();
  await expect(supplier.getByRole("status")).toContainText(
    "Informations transmises",
  );
  await expect(
    supplier.getByRole("button", { name: "Transmettre à mon client" }),
  ).toHaveCount(0);
  const cookie = (await ctx.cookies()).find((c) =>
    c.name.endsWith("gft-supplier"),
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  if (process.env.PUBLIC_ORIGIN?.startsWith("https"))
    expect(cookie?.secure).toBe(true);
  await page
    .getByRole("button", { name: "Coopérative Cacao — FICTIF", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByText("À revoir", { exact: true })).toBeVisible();
  await dialog
    .getByText("Consulter les données déclarées", { exact: true })
    .click();
  await expect(
    dialog.getByText("Cacao déclaré — FICTIF", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("Note de revue")
    .fill("Collecte fictive relue. Pas de conclusion réglementaire.");
  await dialog
    .getByRole("button", { name: "Marquer la collecte revue" })
    .click();
  await expect(
    dialog.getByText("Collecte revue", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/rapports/preuves-chantier-2/revue-collecte.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Fermer la fenêtre" }).click();
  await supplier.getByRole("button", { name: "Actualiser le statut" }).click();
  await expect(
    supplier.getByText("Collecte relue par votre client.", { exact: true }),
  ).toBeVisible();
  await supplier.screenshot({
    path: "docs/rapports/preuves-chantier-2/portail-transmis-mobile.png",
    fullPage: true,
  });
  await supplier.getByRole("button", { name: "Fermer mon accès" }).click();
  await expect(supplier.getByRole("status")).toContainText("Accès fermé");
  await ctx.close();
  for (const width of [768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });

    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.screenshot({
    path: "docs/rapports/preuves-chantier-2/fournisseurs-mobile.png",
    fullPage: true,
  });
  expect(runtimeErrors).toEqual([]);
});
