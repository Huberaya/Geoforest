import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "GeoForest Trace — Conformité EUDR",
  description:
    "Micro-SaaS de conformité au Règlement Européen Déforestation (EUDR 2023/1115) : validation GIS des parcelles, détection satellite de déforestation post-2020 et export TRACES-NT.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
