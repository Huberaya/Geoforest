import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["*.e2b.app"],
  async rewrites() {
    return [
      {
        source: "/identity/realms/:path*",
        destination: `${process.env.KEYCLOAK_INTERNAL_URL || "http://127.0.0.1:8080"}/identity/realms/:path*`,
      },
      {
        source: "/identity/resources/:path*",
        destination: `${process.env.KEYCLOAK_INTERNAL_URL || "http://127.0.0.1:8080"}/identity/resources/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${process.env.API_INTERNAL_URL || "http://127.0.0.1:8000"}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'" +
              (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "") +
              "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
          },
          ...(process.env.APP_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
                { key: "X-Frame-Options", value: "DENY" },
              ]
            : []),
        ],
      },
    ];
  },
};
export default nextConfig;
