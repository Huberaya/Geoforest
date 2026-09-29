import { expect, it } from "vitest";
import { backendRewrites } from "../../src/backend-routing";

it("keeps explicit local development defaults", () => {
  expect(backendRewrites({})[2].destination).toBe(
    "http://127.0.0.1:8000/api/:path*",
  );
});
it.each([{ VERCEL: "1" }, { APP_ENV: "production" }])(
  "rejects a missing hosted API %j",
  (env) => {
    expect(() => backendRewrites(env)).toThrow(/required/);
  },
);
it.each([
  "http://api.example",
  "https://localhost",
  "https://127.0.0.1",
  "https://2130706433",
  "https://[::1]",
  "https://169.254.169.254",
  "https://192.168.0.1",
  "https://backend.internal",
  "https://a.local",
  "https://user:secret@api.example",
  "https://api.example/path",
  "https://api.example?key=secret",
  "https://api.example#x",
  "https://api.example:8000",
  "https://api.example/",
  "not a URL",
])("rejects unsafe hosted target %s", (url) => {
  expect(() =>
    backendRewrites({ VERCEL: "1", API_INTERNAL_URL: url }),
  ).toThrow();
});
it("preserves the full API path and omits Keycloak in Clerk mode", () => {
  expect(
    backendRewrites({
      VERCEL: "1",
      AUTH_PROVIDER: "clerk_production",
      API_INTERNAL_URL: "https://gft-api.vercel.app",
    }),
  ).toEqual([
    {
      source: "/api/:path*",
      destination: "https://gft-api.vercel.app/api/:path*",
    },
  ]);
});
it("does not silently add a localhost Keycloak rewrite for hosted OIDC", () => {
  expect(
    backendRewrites({
      APP_ENV: "production",
      API_INTERNAL_URL: "https://api.example",
    }),
  ).toHaveLength(1);
});
it("rejects an explicit private Keycloak target", () => {
  expect(() =>
    backendRewrites({
      VERCEL: "1",
      API_INTERNAL_URL: "https://api.example",
      KEYCLOAK_INTERNAL_URL: "http://127.0.0.1:8080",
    }),
  ).toThrow();
});
it("rejects a direct proxy loop", () => {
  expect(() =>
    backendRewrites({
      VERCEL: "1",
      API_INTERNAL_URL: "https://app.example",
      PUBLIC_ORIGIN: "https://app.example",
    }),
  ).toThrow(/frontend/);
});
