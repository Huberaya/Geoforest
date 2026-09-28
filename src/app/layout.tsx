import type { Metadata } from "next";
import type { ReactNode } from "react";
import "leaflet/dist/leaflet.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "GeoForest Trace — Espace de travail",
  description:
    "Espace sécurisé de préparation de la diligence raisonnée. Modules réglementaires en cours de développement.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
