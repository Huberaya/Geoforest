/** Server configuration only. Never reads or returns the Clerk secret key. */
function productionHost(value: string) {
  if (!/^https:\/\/[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(value))
    throw new Error("Production Clerk requires a canonical HTTPS domain");
  const host = new URL(value).hostname;
  if (
    !host.includes(".") ||
    host.length > 253 ||
    host
      .split(".")
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /^[0-9.]+$/.test(host) ||
    [".localhost", ".local", ".clerk.accounts.dev", ".vercel.app"].some(
      (suffix) => host.endsWith(suffix),
    )
  )
    throw new Error("Production Clerk requires an owned DNS domain");
  return host;
}

export function authProvider() {
  const mode = process.env.AUTH_PROVIDER || "oidc";
  if (
    mode !== "oidc" &&
    mode !== "clerk_development" &&
    mode !== "clerk_production"
  )
    throw new Error("Unknown AUTH_PROVIDER");
  if (mode === "oidc") return mode;
  const production = mode === "clerk_production";
  if (!production && process.env.APP_ENV === "production")
    throw new Error("Clerk development is prohibited in production");
  if (production && process.env.APP_ENV !== "production")
    throw new Error("Clerk production requires APP_ENV=production");
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
  const issuer = process.env.CLERK_ISSUER || "";
  if (production) {
    const issuerHost = productionHost(issuer);
    const originHost = productionHost(process.env.PUBLIC_ORIGIN || "");
    const domain = issuerHost.replace(/^clerk\./, "");
    if (
      !issuerHost.startsWith("clerk.") ||
      originHost === issuerHost ||
      !(originHost === domain || originHost.endsWith("." + domain)) ||
      !/^pk_live_[A-Za-z0-9_=\-]+$/.test(key)
    )
      throw new Error("Clerk production configuration missing or invalid");
  } else if (
    !/^pk_test_[A-Za-z0-9_=\-]+$/.test(key) ||
    !/^https:\/\/[a-z0-9-]+\.clerk\.accounts\.dev$/.test(issuer)
  )
    throw new Error("Clerk development configuration missing or invalid");
  const host = Buffer.from(key.slice(8), "base64").toString("utf8");
  if (host !== new URL(issuer).hostname + "$")
    throw new Error("Clerk publishable key and issuer mismatch");
  return mode;
}
