import { expect, test } from "@playwright/test";
for (const width of [360, 390, 1280]) {
  test(`catalogue failure/retry and indicative result at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByText(/Catalogue indisponible/)).toBeVisible();
    await expect(
      page.getByText("Pays non couvert", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Réessayer le catalogue" }).click();
    await expect(page.getByText(/246 codes ISO/)).toBeVisible();
    await expect(page.getByText(/pays non vérifié/)).toBeVisible();
    await page.getByText("Provenance et limites du contrôle").click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `docs/rapports/preuves-chantier-4/reprise-production/component-${width}.png`,
      fullPage: true,
    });
  });
}
