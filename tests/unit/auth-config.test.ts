import { afterEach, expect, it, vi } from "vitest";
import { authProvider } from "../../src/auth-provider";
afterEach(() => vi.unstubAllEnvs());
function development() {
  vi.stubEnv("AUTH_PROVIDER", "clerk_development");
  vi.stubEnv("APP_ENV", "development");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_synthetic");
  vi.stubEnv("CLERK_ISSUER", "https://synthetic.clerk.accounts.dev");
  vi.stubEnv(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "pk_test_" +
      Buffer.from("synthetic.clerk.accounts.dev$").toString("base64"),
  );
}
it("keeps OIDC as default", () => {
  vi.stubEnv("AUTH_PROVIDER", "");
  expect(authProvider()).toBe("oidc");
});
it("accepts matching development configuration", () => {
  development();
  expect(authProvider()).toBe("clerk_development");
});
it.each([
  ["APP_ENV", "production"],
  ["AUTH_PROVIDER", "typo"],
  ["CLERK_ISSUER", "https://another.clerk.accounts.dev"],
  ["CLERK_ISSUER", "http://synthetic.clerk.accounts.dev"],
  ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_live_synthetic"],
])("rejects inconsistent configuration %s", (key, value) => {
  development();
  vi.stubEnv(key, value);
  expect(() => authProvider()).toThrow();
});

it("does not need the backend secret in the frontend", () => {
  development();
  vi.stubEnv("CLERK_SECRET_KEY", "");
  expect(authProvider()).toBe("clerk_development");
});
