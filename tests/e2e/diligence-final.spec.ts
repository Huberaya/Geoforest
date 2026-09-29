import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const privateDir = process.env.E2E_DILIGENCE_PRIVATE;
function data() {
  return {
    ...JSON.parse(
      fs.readFileSync(path.join(privateDir!, "config.json"), "utf8"),
    ),
    ...JSON.parse(
      fs.readFileSync(path.join(privateDir!, "fixture.json"), "utf8"),
    ),
  };
}
test.beforeEach(() =>
  test.skip(!privateDir, "Fixture READY et IdP OIDC locaux requis"),
);
async function open(page: Page, mobile = false) {
  const d = data();
  if (mobile) await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/espace");
  await page
    .getByRole("link", { name: "Se connecter en toute sécurité" })
    .click();
  await page.locator("#username").fill(d.username);
  await page.locator("#password").fill(d.password);
  await page.locator("#kc-login").click();
  await page
    .getByRole("button", { name: "Diligence raisonnée", exact: true })
    .click();
  await page.locator(".diligence-card").first().click();
  return page.getByRole("region", { name: "Révision du dossier", exact: true });
}
async function submit(page: Page) {
  await page
    .getByLabel("Justification de la décision")
    .fill("Décision FICTIVE pour recette, sans valeur réglementaire");
  await page
    .getByRole("button", { name: "Soumettre à la revue interne" })
    .click();
  await expect(
    page.getByRole("button", { name: "Valider en interne", exact: true }),
  ).toBeVisible();
}
async function confirm(page: Page) {
  await page
    .getByLabel("Justification de la décision")
    .fill("Revue humaine FICTIVE de recette uniquement");
  await page.getByRole("checkbox", { name: /J’ai examiné ce dossier/ }).check();
}
async function newRevision(page: Page) {
  await page
    .getByRole("button", { name: "Préparer une nouvelle révision" })
    .click();
  await page.getByRole("button", { name: "Figer cette révision" }).click();
  await expect(
    page.getByRole("button", { name: "Soumettre à la revue interne" }),
  ).toBeVisible();
}

test("OIDC réel : validation positive, corrections, révisions, retrait et exports", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const revision = await open(page);
  await submit(page);
  await expect(
    page.getByRole("button", { name: "Valider en interne", exact: true }),
  ).toBeDisabled();
  await confirm(page);
  await page
    .getByRole("button", { name: "Valider en interne", exact: true })
    .click();
  await expect(revision.locator(".badge")).toHaveText("Validé en interne");
  const d = data();
  const current = await page.request.get(d.url + "/export.json");
  expect((await current.json()).validation_applicability).toBe(
    "CURRENT_INTERNAL_VALIDATION",
  );
  for (const kind of ["PDF", "JSON", "CSV"]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Télécharger " + kind }).click();
    const f = await download;
    expect(await f.failure()).toBeNull();
    await f.saveAs(path.join(privateDir!, "validated." + kind.toLowerCase()));
  }
  await newRevision(page);
  await submit(page);
  await page
    .getByLabel("Justification de la décision")
    .fill("Corrections demandées lors de la recette fictive");
  await page.getByRole("button", { name: "Demander des corrections" }).click();
  await expect(revision.locator(".badge")).toHaveText("Corrections demandées");
  await newRevision(page);
  await submit(page);
  await confirm(page);
  await page
    .getByRole("button", { name: "Valider en interne", exact: true })
    .click();
  await expect(revision.locator(".badge")).toHaveText("Validé en interne");
  await page
    .getByLabel("Justification de la décision")
    .fill("Retrait interne FICTIF pour vérifier le parcours");
  await page.getByRole("button", { name: "Retirer en interne" }).click();
  await expect(revision.locator(".badge")).toHaveText("Retiré en interne");
  await page.getByLabel("Révision à consulter").fill("1");
  await page
    .getByRole("button", { name: "Consulter la révision", exact: true })
    .click();
  await expect(revision).toContainText("Révision historique");
  const old = await page.request.get(d.url + "/export.json");
  expect((await old.json()).validation_applicability).toBe(
    "NOT_A_CURRENT_VALIDATION",
  );
  expect(errors).toEqual([]);
});

function setRole(role: "Viewer" | "Admin") {
  const d = data();
  execFileSync(
    path.resolve(".venv/bin/python"),
    [
      "-c",
      `
import conftest
from sqlalchemy import text
with conftest.owner.begin() as c:
 c.execute(text("UPDATE memberships SET role=:r WHERE organization_id=:o AND user_id=:u"), {"r":${JSON.stringify(role)},"o":${JSON.stringify(d.org)},"u":${JSON.stringify(d.user)}})
`,
    ],
    {
      env: {
        ...process.env,
        PYTHONPATH: "backend:backend/tests",
        APP_ENV: "test",
      },
      stdio: "pipe",
    },
  );
}

test("OIDC 360px : conflit de revue, droits retirés et session révoquée", async ({
  page,
}) => {
  test.setTimeout(120000);
  const revision = await open(page, true);
  await newRevision(page);
  await submit(page);
  await confirm(page);
  const d = data();
  const me = await (await page.request.get("/api/v1/me")).json();
  const version = Number(
    await page.getByLabel("Révision à consulter").inputValue(),
  );
  const url = `${d.base}/diligence/${d.dossier}/revisions/${version}`;
  const other = await page.request.post(url + "/decisions", {
    headers: { Origin: "http://localhost:3000", "X-CSRF-Token": me.csrf_token },
    data: {
      request_id: crypto.randomUUID(),
      version: 2,
      action: "REQUEST_CHANGES",
      note: "Décision concurrente fictive de recette",
      acknowledged: false,
    },
  });
  expect(other.status()).toBe(200);
  await page
    .getByRole("button", { name: "Valider en interne", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: /./ }).first(),
  ).toBeVisible();
  await expect(revision.locator(".badge")).toHaveText("En revue");
  await page.getByRole("button", { name: "Actualiser les contrôles" }).click();
  await expect(revision.locator(".badge")).toHaveText("Corrections demandées");
  await newRevision(page);
  await submit(page);
  await confirm(page);
  try {
    setRole("Viewer");
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/decisions") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Valider en interne", exact: true })
      .click();
    expect((await response).status()).toBe(403);
    await expect(revision.locator(".badge")).toHaveText("En revue");
  } finally {
    setRole("Admin");
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(privateDir!, "mobile-360.png"),
    fullPage: true,
  });
  const logout = await page.request.post("/api/auth/logout", {
    headers: { Origin: "http://localhost:3000", "X-CSRF-Token": me.csrf_token },
  });
  expect(logout.status()).toBe(204);
  const response = page.waitForResponse((r) => r.url().endsWith("/export.pdf"));
  await page.getByRole("button", { name: "Télécharger PDF" }).click();
  expect((await response).status()).toBe(401);
});
