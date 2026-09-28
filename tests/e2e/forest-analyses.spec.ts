import { test, expect } from "@playwright/test";

test("Observations forestières : vraie source, preuves et historique par révision", async ({
  page,
}) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(15000);
  test.skip(
    !process.env.E2E_USERNAME || !process.env.E2E_PASSWORD,
    "Compte OIDC de recette requis",
  );
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== new URL(process.env.PUBLIC_ORIGIN!).origin)
      externalRequests.push(r.url());
  });
  await page.goto("/");
  await page
    .getByRole("link", { name: "Se connecter en toute sécurité" })
    .click();
  await page.locator("#username").fill(process.env.E2E_USERNAME!);
  await page.locator("#password").fill(process.env.E2E_PASSWORD!);
  await page.locator("#kc-login").click();
  const name = "Forêt Démo " + Date.now();
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
      reference: "FOREST-SUP",
      name: "Fournisseur fictif Forêt",
      country: "CI",
    });
    const payload = {
      supplier_id: s.id,
      reference: "FOREST-001",
      name: "Parcelle forestière inventée",
      country: "CI",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-5.5, 5.5],
            [-5.499, 5.5],
            [-5.499, 5.499],
            [-5.5, 5.499],
            [-5.5, 5.5],
          ],
        ],
      },
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
    .getByRole("button", { name: "Parcelle forestière inventée", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  let forest = dialog.getByRole("region", { name: "Observations forestières" });
  await expect(
    forest.getByText("Aucune observation enregistrée pour cette révision."),
  ).toBeVisible();
  const run = forest.getByRole("button", {
    name: "Analyser les signaux forestiers",
  });
  await expect(run).toBeDisabled();
  await forest.getByRole("checkbox").check();
  await run.click();
  await expect(
    forest.getByText("Observation calculée — revue nécessaire", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 110000 });
  await expect(
    forest.getByText("Signal de perte de couvert après 2020", { exact: true }),
  ).toBeVisible();
  await forest.locator("article").first().screenshot({
    path: "docs/rapports/preuves-chantier-5/forest-desktop.png",
  });
  const snapshot = await page.evaluate(async (f) => {
    const h = await (
      await fetch(`${f.base}/plots/${f.id}/forest-analyses?revision=1`)
    ).json();
    const e = await (
      await fetch(`${f.base}/plots/${f.id}/forest-analyses/${h.items[0].id}`)
    ).json();
    return e;
  }, fixture);
  expect(
    snapshot.result.windows[0].evidence[0].pixels_zlib_base64,
  ).toBeTruthy();
  expect(
    snapshot.result.windows[0].evidence[0].source_reads[0].generation,
  ).toMatch(/^\d+$/);
  expect(snapshot.result.regulatory_status).toBe("NOT_ASSESSED");
  const download = page.waitForEvent("download");
  await forest
    .getByRole("button", { name: "Télécharger les preuves JSON" })
    .click();
  expect((await download).suggestedFilename()).toContain(snapshot.id);
  await forest.getByLabel("Source à analyser").selectOption("tmf-2025-epoch");
  await expect(forest.getByRole("checkbox")).not.toBeChecked();
  await forest.getByRole("checkbox").check();
  await forest
    .getByRole("button", { name: "Analyser les signaux forestiers" })
    .click();
  await expect(forest.locator("article").first()).toContainText(
    "Source: EC JRC",
    { timeout: 110000 },
  );
  const tmfProof = await page.evaluate(async (f) => {
    const h = await (
      await fetch(`${f.base}/plots/${f.id}/forest-analyses?revision=1`)
    ).json();
    return (
      await fetch(`${f.base}/plots/${f.id}/forest-analyses/${h.items[0].id}`)
    ).json();
  }, fixture);
  expect(tmfProof.result.source_id).toBe("tmf-2025-epoch");
  expect(tmfProof.result.status).toBe("OBSERVED");
  expect(tmfProof.result.regulatory_status).toBe("NOT_ASSESSED");
  expect(tmfProof.result.windows[0].evidence).toHaveLength(3);
  expect(
    tmfProof.result.windows[0].evidence[0].source_reads[0].generation,
  ).toBeNull();
  expect(
    tmfProof.result.windows[0].evidence[0].source_reads[0].etag,
  ).toBeTruthy();
  await forest
    .locator("article")
    .first()
    .screenshot({ path: "docs/rapports/preuves-chantier-5/tmf-desktop.png" });
  await dialog
    .getByRole("button", { name: "Fermer la fenêtre", exact: true })
    .click();
  await page.evaluate(async (f) => {
    const me = await (await fetch("/api/v1/me")).json();
    const { supplier_id: omitted, ...data } = f.payload;
    void omitted;
    const r = await fetch(f.base + "/plots/" + f.id, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": me.csrf_token,
      },
      body: JSON.stringify({
        ...data,
        geometry: { type: "Point", coordinates: [0, 89] },
        version: 1,
      }),
    });
    if (!r.ok) throw new Error("Revision failed " + r.status);
  }, fixture);
  await page
    .getByRole("button", { name: "Parcelle forestière inventée", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  forest = dialog.getByRole("region", { name: "Observations forestières" });
  await expect(
    forest.getByText("Aucune observation enregistrée pour cette révision."),
  ).toBeVisible();
  await forest.getByRole("checkbox").check();
  await forest
    .getByRole("button", { name: "Analyser les signaux forestiers" })
    .click();
  await expect(
    forest.getByText("Hors couverture de la source", { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("Révision consultée").selectOption("1");
  forest = dialog.getByRole("region", { name: "Observations forestières" });
  await expect(
    forest.getByText("Signal de perte de couvert après 2020", { exact: true }),
  ).toBeVisible();
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBeTruthy();
  }
  await forest
    .locator("article")
    .first()
    .screenshot({ path: "docs/rapports/preuves-chantier-5/forest-mobile.png" });
  const unchanged = await page.evaluate(
    async (f) =>
      (
        await fetch(`${f.base}/plots/${f.id}/forest-analyses?revision=1`)
      ).json(),
    fixture,
  );
  expect(unchanged.items.map((item: { id: string }) => item.id)).toContain(
    snapshot.id,
  );
  expect(unchanged.items).toHaveLength(2);
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
  if (process.env.E2E_RATE_PACE === "1")
    await new Promise((resolve) => setTimeout(resolve, 65000));
});
