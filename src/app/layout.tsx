import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

/**
 * Rendu dynamique garanti pour que Next.js lise l'en-tête `Content-Security-Policy`
 * posé par `src/proxy.ts` et applique automatiquement le nonce cryptographique de
 * la requête à chaque balise `<script>` d'hydratation et de flux RSC.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GeoForest Trace — Cockpit de Diligence Raisonnée EUDR",
  description:
    "Plateforme de diligence raisonnée et de contrôle géospatial pour le Règlement (UE) 2023/1115.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
