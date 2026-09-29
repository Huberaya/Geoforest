import { test, expect, type Page } from "@playwright/test";
const username = process.env.E2E_USERNAME,
  password = process.env.E2E_PASSWORD;
async function api(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const me = await (await fetch("/api/v1/me")).json();
      const r = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrf_token,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(
          "Fixture API " + r.status + ": " + JSON.stringify(data),
        );
      return data;
    },
    { path, method, body },
  );
}
test("Parcelles : OIDC réel, GPS simulé, dessin, versions de lot, import et revue fournisseur", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  test.skip(!username || !password, "Compte Keycloak de recette requis");
  const errors: string[] = [],
    external: string[] = [];
  const origin = new URL(process.env.PUBLIC_ORIGIN!).origin;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().startsWith("http") && new URL(r.url()).origin !== origin)
      external.push(r.url());
  });
  await page.goto("/espace");
  await page
    .getByRole("link", { name: "Se connecter en toute sécurité" })
    .click();
  await page.locator("#username").fill(username!);
  await page.locator("#password").fill(password!);
  await page.locator("#kc-login").click();
  const name = "Parcelles Démo " + Date.now();
  await page.getByLabel("Nom de l’organisation").fill(name);
  await page.getByRole("button", { name: "Créer l’organisation" }).click();
  await expect(page.getByRole("status")).toContainText("créée");
  const me = await api(page, "/api/v1/me");
  const org = me.organizations.find(
    (o: { name: string }) => o.name === name,
  ).id;
  const base = "/api/v1/organizations/" + org;
  const s = await api(page, base + "/suppliers", "POST", {
    reference: "SUP-GEO",
    name: "Fournisseur géographique fictif",
    country: "FR",
  });
  const prod = await api(page, base + "/products", "POST", {
    reference: "PROD-GEO",
    name: "Produit synthétique",
    commodities: ["cocoa"],
    supplier_ids: [s.id],
  });
  const lot = await api(page, base + "/lots", "POST", {
    reference: "LOT-GEO",
    supplier_id: s.id,
    product_id: prod.id,
    quantity: "10",
    unit: "KG",
  });
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await nav.getByRole("button", { name: "Parcelles", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Parcelles", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "+ Créer une parcelle", exact: true })
    .click();
  let d = page.getByRole("dialog");
  await d
    .getByLabel("Fournisseur de la parcelle", { exact: true })
    .selectOption({ label: "Fournisseur géographique fictif · SUP-GEO" });
  await d.getByLabel("Référence parcelle").fill("GEO-001");
  await d.getByLabel("Nom de la parcelle").fill("Point synthétique en océan");
  await d
    .getByRole("combobox", { name: "Pays déclaré *", exact: true })
    .selectOption("FR");
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: -30, latitude: 0, accuracy: 12 });
  await d.getByRole("button", { name: "Utiliser ma position GPS" }).click();
  await expect(d.getByRole("status")).toContainText("précision annoncée");
  await d.getByRole("button", { name: "Vérifier la géométrie" }).click();
  await expect(
    d.getByText("Un point ne permet pas de calculer une superficie"),
  ).toBeVisible();
  await d.getByRole("checkbox", { name: /J’ai relu les données/ }).check();
  await d
    .getByRole("button", { name: "Enregistrer la parcelle", exact: true })
    .click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Point synthétique en océan",
      exact: true,
    }),
  ).toBeVisible();
  // Link a specific revision through the real lot UI.
  await nav.getByRole("button", { name: "Lots", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "LOT-GEO" })
    .getByRole("button", { name: "Parcelles", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Rattacher", exact: true }).click();
  await d.getByRole("button", { name: "Enregistrer les liens du lot" }).click();
  await expect(d).not.toBeVisible();
  await nav.getByRole("button", { name: "Parcelles", exact: true }).click();
  await page
    .getByRole("button", { name: "Point synthétique en océan", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d
    .getByRole("button", { name: "Modifier la parcelle", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Dessiner un contour" }).click();
  const map = d.locator(".geo-map");
  await expect(map).toHaveClass(/leaflet-container/);
  await map.scrollIntoViewIfNeeded();
  await map.click({ position: { x: 180, y: 95 } });
  await map.click({ position: { x: 240, y: 95 } });
  await map.click({ position: { x: 240, y: 155 } });
  await map.click({ position: { x: 180, y: 155 } });
  await d.getByRole("button", { name: "Terminer le contour" }).click();
  await d.getByLabel("Nom de la parcelle").fill("Contour synthétique en océan");
  await d.getByRole("button", { name: "Vérifier la géométrie" }).click();
  await expect(d.getByText(/ha calculés/)).toBeVisible();
  await d.getByRole("checkbox", { name: /J’ai relu les données/ }).check();
  await d
    .getByRole("button", { name: "Enregistrer la parcelle", exact: true })
    .click();
  await expect(d).not.toBeVisible();
  const stored = await api(page, base + "/plots");
  expect(stored.items[0].current_revision).toBe(2);
  const pinned = await api(page, base + "/lots/" + lot.id + "/plots");
  expect(pinned.items[0].revision).toBe(1);
  expect(pinned.items[0].payload.capture_method).toBe("GPS");
  expect(pinned.items[0].payload.gps_accuracy_m).toBe(12);
  await page.getByRole("button", { name: "Importer GeoJSON / KML" }).click();
  d = page.getByRole("dialog");
  await d
    .getByLabel("Fournisseur de l’import", { exact: true })
    .selectOption({ label: "Fournisseur géographique fictif · SUP-GEO" });
  await d
    .getByRole("combobox", { name: "Pays par défaut *", exact: true })
    .selectOption("FR");
  await d.getByLabel("Préfixe des références").fill("IMPORT");
  await d.getByLabel("Contenu du fichier").fill(
    JSON.stringify({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-30.01, 0],
            [-30.009, 0],
            [-30.009, 0.001],
            [-30.01, 0.001],
            [-30.01, 0],
          ],
        ],
      },
      properties: { name: "Contour importé fictif" },
    }),
  );
  await d.getByRole("button", { name: "Prévisualiser l’import" }).click();
  await expect(d.getByText("1 parcelle(s)", { exact: true })).toBeVisible();
  await d.getByRole("checkbox", { name: /J’ai vérifié l’aperçu/ }).check();
  await d
    .getByRole("button", { name: "Confirmer l’import des parcelles" })
    .click();
  await expect(d).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Contour importé fictif", exact: true }),
  ).toBeVisible();
  // Canvas renderer: verify the actual viewport via the bbox API, not nonexistent SVG paths.
  const filtered = page.waitForResponse(
    (r) => r.url().includes("/plots?") && r.url().includes("bbox="),
  );
  await page
    .getByRole("button", { name: "Filtrer sur la zone visible" })
    .click();
  expect((await (await filtered).json()).total).toBe(2);
  await expect(
    page.getByText("2 résultat(s) · 2 affiché(s) sur la carte", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retirer le filtre géographique" })
    .click();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: "docs/rapports/preuves-chantier-3/parcelles-desktop.png",
    fullPage: true,
  });
  const invite = await api(
    page,
    base + "/suppliers/" + s.id + "/invitations",
    "POST",
    {},
  );
  const sc = await browser.newContext({
    ignoreHTTPSErrors: process.env.E2E_LOCAL_TLS === "1",
    viewport: { width: 390, height: 900 },
  });
  const sp = await sc.newPage();
  sp.setDefaultTimeout(15000);
  sp.on("pageerror", (e) => errors.push(e.message));
  sp.on("request", (r) => {
    if (r.url().startsWith("http") && new URL(r.url()).origin !== origin)
      external.push(r.url());
  });
  await sp.goto(invite.url);
  await sp.getByRole("button", { name: "Ouvrir mon espace sécurisé" }).click();
  await sp
    .getByRole("button", { name: "Proposer une parcelle", exact: true })
    .click();
  let sd = sp.getByRole("dialog");
  // Explicitly simulated permission refusal; no real supplier/device position is collected.
  await sp.evaluate(() => {
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
      configurable: true,
      value: (_ok: unknown, fail: (e: { code: number }) => void) =>
        fail({ code: 1 }),
    });
  });
  await sd.getByRole("button", { name: "Utiliser ma position GPS" }).click();
  await expect(sd.getByRole("status")).toContainText("Permission GPS refusée");
  await sd.getByLabel("Référence parcelle").fill("FOURN-GEO");
  await sd
    .getByLabel("Nom de la parcelle")
    .fill("Proposition fictive en océan");
  await sd
    .getByRole("combobox", { name: "Pays déclaré *", exact: true })
    .selectOption("FR");
  await sd.getByLabel("Longitude du point", { exact: true }).fill("-30.02");
  await sd.getByLabel("Latitude du point", { exact: true }).fill("0");
  await sd
    .getByRole("button", { name: "Appliquer les coordonnées du point" })
    .click();
  await sd.getByRole("button", { name: "Vérifier la géométrie" }).click();
  await sd.getByRole("checkbox", { name: /J’ai relu les données/ }).check();
  await sd.getByRole("button", { name: "Enregistrer la proposition" }).click();
  await expect(sd).not.toBeVisible();
  await sp.getByRole("checkbox", { name: /J’ai relu la géométrie/ }).check();
  await sp.getByRole("button", { name: "Transmettre la parcelle" }).click();
  await expect(sp.getByText("À revoir", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Propositions fournisseurs" }).click();
  await page
    .getByText("Voir la géométrie et les contrôles", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Vérifier les relations avec le référentiel" })
    .click();
  await page
    .getByLabel("Note de revue parcellaire")
    .fill("Veuillez préciser la référence de collecte fictive.");
  await page
    .getByRole("button", { name: "Demander une correction parcellaire" })
    .click();
  await expect(
    page.getByText("Corrections demandées", { exact: true }),
  ).toBeVisible();
  await sp.getByRole("button", { name: "Actualiser les propositions" }).click();
  await expect(
    sp.getByText("Corrections demandées", { exact: true }),
  ).toBeVisible();
  await sp
    .getByRole("button", { name: "Modifier la proposition", exact: true })
    .click();
  sd = sp.getByRole("dialog");
  await sd
    .getByLabel("Source / observations")
    .fill("Correction synthétique apportée.");
  await sd.getByRole("button", { name: "Vérifier la géométrie" }).click();
  await sd.getByRole("checkbox", { name: /J’ai relu les données/ }).check();
  await sd.getByRole("button", { name: "Enregistrer la proposition" }).click();
  await expect(sd).not.toBeVisible();
  await sp.getByRole("checkbox", { name: /J’ai relu la géométrie/ }).check();
  await sp.getByRole("button", { name: "Transmettre la parcelle" }).click();
  await expect(sp.getByText("À revoir", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Référentiel parcellaire" }).click();
  await page.getByRole("tab", { name: "Propositions fournisseurs" }).click();
  await page
    .getByLabel("Note de revue parcellaire")
    .fill("Adoption après revue humaine. Aucune conclusion EUDR.");
  await page
    .getByRole("checkbox", { name: /J’ai relu les données et contrôles/ })
    .check();
  await page
    .getByRole("button", { name: "Adopter la parcelle", exact: true })
    .click();
  await expect(
    page.getByText("Adoptée dans le référentiel", { exact: true }),
  ).toBeVisible();
  await sp.getByRole("button", { name: "Actualiser les propositions" }).click();
  await expect(
    sp.getByText("Adoptée dans le référentiel", { exact: true }),
  ).toBeVisible();
  await sp
    .getByText("Voir la géométrie et les contrôles", { exact: true })
    .click();
  for (const width of [390, 360]) {
    await sp.setViewportSize({ width, height: 1000 });
    expect(
      await sp.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await sp.screenshot({
    path: "docs/rapports/preuves-chantier-3/parcelle-portail-mobile.png",
    fullPage: true,
  });
  await sc.close();
  await page.getByRole("tab", { name: "Référentiel parcellaire" }).click();
  await expect(
    page.getByRole("button", {
      name: "Proposition fictive en océan",
      exact: true,
    }),
  ).toBeVisible();
  for (const width of [768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.screenshot({
    path: "docs/rapports/preuves-chantier-3/parcelles-mobile.png",
    fullPage: true,
  });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("Saisie avancée : brouillon géométrique corrompu, coordonnées négatives et changement de méthode", async ({
  page,
}) => {
  test.skip(!username || !password, "Compte Keycloak de recette requis");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/espace");
  await page
    .getByRole("link", { name: "Se connecter en toute sécurité" })
    .click();
  await page.locator("#username").fill(username!);
  await page.locator("#password").fill(password!);
  await page.locator("#kc-login").click();
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Parcelles", exact: true })
    .click();
  await page
    .getByRole("button", { name: "+ Créer une parcelle", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByRole("textbox", { name: "Géométrie GeoJSON", exact: true })
    .fill('{"type":"Polygon","coordinates":[null]}');
  await d.getByRole("button", { name: "Vérifier la géométrie" }).click();
  await expect(d.getByRole("alert")).toBeVisible();
  await d.getByLabel("Longitude du point", { exact: true }).fill("-");
  await expect(
    d.getByRole("button", { name: "Vérifier la géométrie" }),
  ).toBeDisabled();
  await d
    .getByRole("textbox", { name: "Géométrie GeoJSON", exact: true })
    .fill('{"type":"Point","coordinates":[-31,0.5]}');
  await expect(d.getByLabel("Longitude du point", { exact: true })).toHaveValue(
    "-31",
  );
  await expect(d.getByLabel("Latitude du point", { exact: true })).toHaveValue(
    "0.5",
  );
  await expect(
    d.getByRole("button", { name: "Vérifier la géométrie" }),
  ).toBeEnabled();
  await d.getByRole("button", { name: "Vérifier la géométrie" }).click();
  await expect(
    d.getByText("Un point ne permet pas de calculer une superficie"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
