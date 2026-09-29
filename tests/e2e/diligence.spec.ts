import { test, expect, type BrowserContext } from "@playwright/test";
import fs from "node:fs";

// Real browser + real API/RLS; test sessions seeded directly, not an OIDC login test.
const seedPath = process.env.E2E_DILIGENCE_SEED;
type Seed = {
  base: string;
  cookie_name: string;
  actors: Record<string, { token: string }>;
};
function seed(): Seed {
  return JSON.parse(fs.readFileSync(seedPath!, "utf8"));
}
async function login(context: BrowserContext, role = "Admin") {
  const s = seed();
  await context.addCookies([
    {
      name: s.cookie_name,
      value: s.actors[role].token,
      url: process.env.PUBLIC_ORIGIN || "http://localhost:3000",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
test.beforeEach(() => {
  test.skip(!seedPath, "Fixture synthétique privée requise");
});

for (const mobile of [false, true]) {
  test(`Diligence réelle : préparer, revue bloquée, exports, historique (${mobile ? "mobile" : "desktop"})`, async ({
    page,
    context,
  }) => {
    await login(context);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page
      .getByRole("button", { name: "Diligence raisonnée", exact: true })
      .click();
    const area = page.getByRole("region", {
      name: "Dossiers de diligence",
      exact: true,
    });
    await area.getByRole("button", { name: "Nouveau dossier" }).click();
    const title = `Recette FICTIVE ${mobile ? "mobile" : "desktop"} ${Date.now()}`;
    await area.getByLabel("Titre du dossier").fill(title);
    await area.locator(".diligence-lot-picker input").first().check();
    await area.getByRole("button", { name: "Figer cette révision" }).click();
    const revision = area.getByRole("region", {
      name: "Révision du dossier",
      exact: true,
    });
    await expect(revision.getByRole("heading", { name: title })).toBeVisible();
    await revision
      .getByLabel("Justification de la décision")
      .fill("Revue de recette fictive sans valeur réglementaire");
    await revision
      .getByRole("button", { name: "Soumettre à la revue interne" })
      .click();
    await expect(
      revision.getByRole("button", { name: "Valider en interne", exact: true }),
    ).toBeDisabled();
    for (const kind of ["PDF", "CSV", "JSON"]) {
      const download = page.waitForEvent("download");
      await revision
        .getByRole("button", { name: "Télécharger " + kind })
        .click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(
        new RegExp(`\\.${kind.toLowerCase()}$`),
      );
      expect(await file.failure()).toBeNull();
      await expect(area.getByRole("status")).toContainText(
        "empreinte vérifiée",
      );
    }
    await revision
      .getByRole("button", { name: "Préparer une nouvelle révision" })
      .click();
    await area.getByRole("button", { name: "Figer cette révision" }).click();
    await expect(revision.getByLabel("Révision à consulter")).toHaveValue("2");
    await revision.getByLabel("Révision à consulter").fill("1");
    await revision
      .getByRole("button", { name: "Consulter la révision", exact: true })
      .click();
    await expect(revision).toContainText("Révision historique");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("Viewer lit et exporte sans préparer ni décider", async ({
  page,
  context,
}) => {
  await login(context, "Viewer");
  await page.goto("/");
  await page
    .getByRole("button", { name: "Diligence raisonnée", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Nouveau dossier" }),
  ).toHaveCount(0);
  await page.locator(".diligence-card").first().click();
  await expect(
    page.getByRole("button", { name: "Télécharger PDF" }),
  ).toBeVisible();
  await expect(page.getByLabel("Justification de la décision")).toHaveCount(0);
});

test("Supplier exclu de la navigation et de l’API diligence", async ({
  page,
  context,
}) => {
  await login(context, "Supplier");
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Documents", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Diligence raisonnée", exact: true }),
  ).toHaveCount(0);
  const result = await page.request.get(seed().base + "/diligence");
  expect(result.status()).toBe(403);
});
