/** Server configuration only. Never returns the Clerk secret key. */
export function authProvider() {
  const mode = process.env.AUTH_PROVIDER || "oidc";
  if (mode !== "oidc" && mode !== "clerk_development")
    throw new Error("Unknown AUTH_PROVIDER");
  if (mode === "clerk_development") {
    if (process.env.APP_ENV === "production")
      throw new Error("Clerk development is prohibited in production");
    const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
    const issuer = process.env.CLERK_ISSUER || "";
    if (
      !/^pk_test_[A-Za-z0-9_=\-]+$/.test(key) ||
      !/^https:\/\/[a-z0-9-]+\.clerk\.accounts\.dev$/.test(issuer)
    )
      throw new Error("Clerk development configuration missing or invalid");
    const host = Buffer.from(key.slice(8), "base64").toString("utf8");
    if (host !== new URL(issuer).hostname + "$")
      throw new Error("Clerk publishable key and issuer mismatch");
  }
  return mode;
}
