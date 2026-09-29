import { test, expect } from "@playwright/test";

// UI-only acceptance: no identity provider, business API, S3 or antivirus contacted.
test.skip(
  process.env.E2E_DOCUMENTS_MOCK !== "1",
  "Explicit opt-in to synthetic UI fixture",
);
const org = "00000000-0000-4000-8000-000000000001";
const supplier = "00000000-0000-4000-8000-000000000002";
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Background quarantine and status polling — ${viewport.width}px — synthetic API`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let scan = "SCANNING";
    let documentRequests = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = [];
      if (path === "/api/v1/me")
        body = {
          user: {
            id: "synthetic-user",
            name: "Recette fictive",
            email: "test@example.invalid",
          },
          csrf_token: "synthetic-only",
          environment: "test",
          admin_mfa_required: false,
          admin_mfa_satisfied: true,
          organizations: [
            {
              id: org,
              name: "Organisation FICTIVE",
              role: "Admin",
              version: 1,
              supplier_id: null,
            },
          ],
        };
      else if (path.endsWith("/documents")) {
        documentRequests++;
        body = {
          enabled: true,
          total: 1,
          page: 1,
          items: [
            {
              id: "00000000-0000-4000-8000-000000000003",
              document_id: "00000000-0000-4000-8000-000000000004",
              supplier_id: supplier,
              version: 1,
              state: scan,
              processing_mode: "background",
              attempts: 1,
              received_size: 80,
              expected_size: 80,
              sha256: "0".repeat(64),
              mime: scan === "SCAN_PASSED" ? "image/png" : null,
              created_at: "2026-09-29T12:00:00Z",
              plot_id: null,
              plot_revision: null,
              lot_id: null,
              metadata: {
                title: "Preuve FICTIVE en quarantaine",
                kind: "OTHER",
                issuer: "Recette",
                original_name: "fiction.png",
                valid_from: null,
                valid_until: null,
                expected_sha256: "0".repeat(64),
              },
              review: null,
            },
          ],
        };
      } else if (path.endsWith("/suppliers"))
        body = { items: [{ id: supplier, name: "Fournisseur FICTIF" }] };
      else if (path.endsWith("/lots") || path.endsWith("/plots"))
        body = { items: [] };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await page.goto("/espace");
    await page.getByRole("button", { name: "Documents", exact: true }).click();
    const vault = page.getByRole("region", { name: "Coffre documentaire" });
    await expect(
      vault.getByText("Contrôles en arrière-plan", { exact: false }),
    ).toBeVisible();
    await expect(
      vault.getByRole("button", { name: /Télécharger/ }),
    ).toHaveCount(0);
    await expect(
      vault.getByRole("button", { name: "Réessayer le contrôle" }),
    ).toHaveCount(0);
    scan = "SCAN_PASSED";
    await expect(
      vault.getByRole("button", { name: /Télécharger/ }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      vault.getByText("Contrôles techniques réussis — revue nécessaire"),
    ).toBeVisible();
    expect(documentRequests).toBeGreaterThanOrEqual(2);
    const after = documentRequests;
    await page.waitForTimeout(5500);
    expect(documentRequests).toBe(after);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `docs/rapports/preuves-chantier-8/s3-api/interface-${viewport.width}.png`,
      fullPage: true,
    });
  });
}
