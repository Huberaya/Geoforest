import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "responsive.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5184", browserName: "chromium" },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --config tests/gis-browser/vite.config.mts",
    cwd: "../..",
    url: "http://127.0.0.1:5184",
    reuseExistingServer: false,
  },
  reporter: "list",
});
