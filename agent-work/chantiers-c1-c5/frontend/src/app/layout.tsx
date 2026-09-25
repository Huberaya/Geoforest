import type { Metadata } from "next";
import type { ReactNode } from "react";
import "leaflet/dist/leaflet.css";
import "@/styles/globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "GeoForest Trace — Conformité EUDR",
  description:
    "GeoForest Trace - Plateforme SaaS de diligence raisonnée EUDR. Collecte, vérification, analyse géospatiale, documentation et orchestration de la conformité déforestation.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
