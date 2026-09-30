import AppShell from "@/components/layout/AppShell";
import { AuthProvider } from "@/context/AuthContext";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "GeoForest Trace — Cockpit de Diligence Raisonnée EUDR",
  description:
    "Plateforme européenne de diligence raisonnée et de conformité au Règlement Déforestation (UE 2023/1115) : parcelles SIG, détection satellite GFW/Sentinel, légalité et exports TRACES-NT.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
