import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // En dev, toutes les requêtes /api/v1 sont proxifiées vers le backend FastAPI si NEXT_PUBLIC_API_URL n'est pas défini.
  // Sinon on appelle directement NEXT_PUBLIC_API_URL.
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl) return [];
    return [
      {
        source: "/api/v1/:path*",
        destination: `${process.env.BACKEND_URL || "http://localhost:8000"}/api/v1/:path*`,
      },
      {
        source: "/health",
        destination: `${process.env.BACKEND_URL || "http://localhost:8000"}/health`,
      },
    ];
  },
};

export default config;
