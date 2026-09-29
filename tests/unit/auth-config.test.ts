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

function production() {
  vi.stubEnv("AUTH_PROVIDER", "clerk_production");
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("PUBLIC_ORIGIN", "https://app.geoforest.example");
  vi.stubEnv("CLERK_ISSUER", "https://clerk.geoforest.example");
  vi.stubEnv("CLERK_SECRET_KEY", "");
  vi.stubEnv(
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "pk_live_" + Buffer.from("clerk.geoforest.example$").toString("base64"),
  );
}
it("accepts production public configuration without a server secret", () => {
  production();
  expect(authProvider()).toBe("clerk_production");
});
it.each([
  ["APP_ENV", "development"],
  ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_synthetic"],
  ["CLERK_ISSUER", "https://synthetic.clerk.accounts.dev"],
  ["CLERK_ISSUER", "https://clerk.other.example"],
  ["CLERK_ISSUER", "https://clerk.geoforest.example/"],
  ["PUBLIC_ORIGIN", "https://app.vercel.app"],
  ["PUBLIC_ORIGIN", "https://app.geoforest.example/"],
  ["PUBLIC_ORIGIN", "https://app.geoforest.example:443"],
  ["PUBLIC_ORIGIN", "https://other.example"],
  ["PUBLIC_ORIGIN", "https://clerk.geoforest.example"],
  ["PUBLIC_ORIGIN", "http://app.geoforest.example"],
  ["PUBLIC_ORIGIN", "https://127.0.0.1"],
  ["PUBLIC_ORIGIN", "https://evil.example;script-src"],
])("rejects unsafe production configuration %s=%s", (key, value) => {
  production();
  vi.stubEnv(key, value);
  expect(() => authProvider()).toThrow();
});
