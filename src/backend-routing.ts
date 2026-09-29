import { isIP } from "node:net";

type Environment = Record<string, string | undefined>;

function target(
  value: string | undefined,
  name: string,
  hosted: boolean,
  fallback: string,
) {
  if (!value && hosted)
    throw new Error(
      `${name} is required for hosted deployments; localhost fallback is prohibited`,
    );
  const raw = value || fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a canonical origin`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.origin !== raw
  )
    throw new Error(
      `${name} must be a canonical origin without credentials, path or query`,
    );
  if (
    hosted &&
    (url.protocol !== "https:" ||
      url.port ||
      isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
      !url.hostname.includes(".") ||
      url.hostname.endsWith(".") ||
      [
        ".localhost",
        ".local",
        ".internal",
        ".lan",
        ".home",
        ".localdomain",
      ].some((suffix) => url.hostname.endsWith(suffix)))
  )
    throw new Error(
      `${name} requires a public HTTPS DNS hostname in hosted deployments`,
    );
  return url.origin;
}

/** Two-project deployment: backend credentials stay out of the frontend. */
export function backendRewrites(env: Environment = process.env) {
  const hosted = env.VERCEL === "1" || env.APP_ENV === "production";
  const api = target(
    env.API_INTERNAL_URL,
    "API_INTERNAL_URL",
    hosted,
    "http://127.0.0.1:8000",
  );
  if (hosted && api === env.PUBLIC_ORIGIN)
    throw new Error(
      "API_INTERNAL_URL must not point back to the frontend origin",
    );
  const routes: { source: string; destination: string }[] = [];
  // No OIDC/Keycloak rewrite in Clerk modes. Hosted OIDC may use its own public issuer.
  if (
    (env.AUTH_PROVIDER || "oidc") === "oidc" &&
    (!hosted || env.KEYCLOAK_INTERNAL_URL)
  ) {
    const identity = target(
      env.KEYCLOAK_INTERNAL_URL,
      "KEYCLOAK_INTERNAL_URL",
      hosted,
      "http://127.0.0.1:8080",
    );
    for (const group of ["realms", "resources"])
      routes.push({
        source: `/identity/${group}/:path*`,
        destination: `${identity}/identity/${group}/:path*`,
      });
  }
  routes.push({ source: "/api/:path*", destination: `${api}/api/:path*` });
  return routes;
}
