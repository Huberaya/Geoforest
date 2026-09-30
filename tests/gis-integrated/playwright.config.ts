import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "country-checks.spec.ts",
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    browserName: "chromium",
    headless: true,
    trace: "off",
  },
});
