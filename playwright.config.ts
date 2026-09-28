import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PUBLIC_ORIGIN || "http://localhost:3000",
    headless: true,
    trace: "off",
    ignoreHTTPSErrors: process.env.E2E_LOCAL_TLS === "1",
    launchOptions:
      process.env.E2E_LOCAL_TLS === "1"
        ? {
            args: [
              `--host-resolver-rules=MAP ${new URL(process.env.PUBLIC_ORIGIN!).hostname} 127.0.0.1`,
            ],
          }
        : {},
  },
});
