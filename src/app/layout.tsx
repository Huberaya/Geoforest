import type { Metadata } from "next";
import type { ReactNode } from "react";
import "leaflet/dist/leaflet.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "GeoForest Trace — Traçabilité et diligence raisonnée",
  description:
    "Fournisseurs, parcelles et preuves : préparez votre diligence raisonnée avec une validation humaine.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
