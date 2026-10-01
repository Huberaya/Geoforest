"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

export interface ShellUser {
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  organizationName: string | null;
}

interface AppShellProps {
  children: ReactNode;
  /** Utilisateur authentifié — fourni par le layout serveur (jamais par le client). */
  user: ShellUser;
}

interface NavItem {
  label: string;
  href: string;
  icon: string;
  /**
   * Compteur affiché en regard de l'entrée. `badgeFrom` désigne la route dont
   * le compteur est calculé côté serveur (`/api/v1/nav/counts`). Sans valeur
   * calculée, aucun badge n'est affiché : un badge annonçait auparavant
   * « 2 critiques » et « 3 à revoir » alors que la base était vide (P0-09).
   */
  badgeFrom?: string;
  badgeColor?: "red" | "amber" | "emerald" | "slate";
}

const NAV_ITEMS: NavItem[] = [
  { label: "Tableau de bord", href: "/", icon: "📊" },
  { label: "Fournisseurs", href: "/suppliers", icon: "👥" },
  { label: "Produits", href: "/products", icon: "📦" },
  { label: "Lots / Expéditions", href: "/shipments", icon: "🚚" },
  { label: "Parcelles", href: "/plots", icon: "🗺️" },
  { label: "Analyses", href: "/analyses", icon: "🛰️" },
  { label: "Documents", href: "/documents", icon: "📁", badgeFrom: "/documents", badgeColor: "amber" },
  { label: "Risques", href: "/risks", icon: "⚠️", badgeFrom: "/risks", badgeColor: "red" },
  { label: "Diligence raisonnée", href: "/due-diligence", icon: "📋" },
  { label: "Déclarations TRACES", href: "/declarations", icon: "🏛️" },
  { label: "Alertes", href: "/alerts", icon: "🔔" },
  { label: "Rapports", href: "/reports", icon: "📑" },
  { label: "Audit Log", href: "/audit-logs", icon: "📜" },
  { label: "Paramètres", href: "/settings", icon: "⚙️" },
];

export default function AppShell({ children, user }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [actionCenterOpen, setActionCenterOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [navCounts, setNavCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/v1/nav/counts", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { counts?: Record<string, number> };
        if (!cancelled && body.counts) setNavCounts(body.counts);
      } catch {
        /* Un badge manquant n'est pas une erreur fonctionnelle. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const initials = user.name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Sidebar Desktop */}
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        {/* Logo / Brand */}
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm font-bold text-base">
            🌲
          </div>
          <div>
            <div className="font-bold text-sm tracking-tight text-slate-900 leading-tight">GeoForest Trace</div>
            <div className="text-[10px] text-emerald-700 font-semibold tracking-wide uppercase">EUDR Compliance SaaS</div>
          </div>
        </div>

        {/* Organisation active — issue de la session */}
        <div className="p-3 border-b border-slate-100 bg-slate-50/50">
          <span className="block text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">
            Organisation active
          </span>
          <div className="w-full truncate rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800">
            {user.organizationName ?? "Aucune organisation rattachée"}
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  active
                    ? "bg-emerald-50 text-emerald-900 font-semibold"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-sm" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>
                {item.badgeFrom && (navCounts[item.badgeFrom] ?? 0) > 0 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      item.badgeColor === "red"
                        ? "bg-rose-100 text-rose-700"
                        : item.badgeColor === "amber"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {navCounts[item.badgeFrom!]}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Quick Portal Switch */}
        <div className="border-t border-slate-200 p-3 space-y-2">
          <Link
            href="/supplier-portal"
            className="flex items-center justify-center gap-2 w-full rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-colors"
          >
            <span>📱</span>
            <span>Portail Fournisseur Mobile</span>
          </Link>
          <div className="flex items-center gap-2.5 px-2 py-1 text-xs text-slate-500">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-[11px]">EUDR Règl. 2023/1115 · V1</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-x-hidden">
        {/* Top Navbar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
              aria-label="Ouvrir le menu"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="hidden sm:block">
              <span className="text-xs text-slate-400">Cockpit EUDR</span>
              <span className="mx-2 text-slate-300">/</span>
              <span className="text-xs font-medium text-slate-700">Diligence raisonnée & Contrôle géospatial</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Action Center Trigger */}
            <button
              type="button"
              onClick={() => setActionCenterOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 transition-all animate-pulse"
            >
              <span className="inline-block h-2 w-2 rounded-full bg-white" />
              <span>CENTRE D’ACTIONS (3)</span>
            </button>

            {/* User Badge — données réelles de la session */}
            <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
              <div
                className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-700 text-white font-bold text-[10px]"
                aria-hidden="true"
              >
                {initials || "?"}
              </div>
              <div className="hidden text-left sm:block">
                <div className="font-semibold text-slate-800 leading-tight">{user.name}</div>
                <div className="text-[10px] text-slate-500">{user.roleLabel}</div>
              </div>
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={loggingOut}
                className="ml-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-60"
              >
                {loggingOut ? "…" : "Se déconnecter"}
              </button>
            </div>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden flex">
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
            <div className="relative flex w-full max-w-xs flex-1 flex-col bg-white p-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div className="font-bold text-sm text-slate-900">Navigation GeoForest</div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                >
                  ✕
                </button>
              </div>
              <nav className="mt-3 space-y-1 overflow-y-auto">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <span>{item.icon} {item.label}</span>
                    {item.badgeFrom && (navCounts[item.badgeFrom] ?? 0) > 0 && (
                      <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] text-rose-700 font-semibold">
                        {navCounts[item.badgeFrom]}
                      </span>
                    )}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        )}

        {/* Slide-over Action Center */}
        {actionCenterOpen && (
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setActionCenterOpen(false)} />
            <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col h-full z-10 animate-in slide-in-from-right duration-200">
              <div className="flex items-center justify-between border-b border-slate-200 p-4 bg-slate-900 text-white">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⚡</span>
                  <div>
                    <h2 className="font-bold text-sm">Centre d’Actions Prioritaires</h2>
                    <p className="text-[11px] text-slate-300">Ce que vous devez traiter aujourd’hui</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActionCenterOpen(false)}
                  className="rounded-lg p-1 text-slate-300 hover:bg-slate-800"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                      Critique
                    </span>
                    <span className="text-[11px] text-rose-700 font-medium">Échéance : 05/10/2026</span>
                  </div>
                  <h3 className="font-semibold text-xs text-rose-950">Alerte Déforestation — Parcelle Riau-04 (Indonésie)</h3>
                  <p className="text-xs text-rose-800 leading-relaxed">
                    Perte de couvert forestier détectée en 2022 (après le 31/12/2020). Risque élevé d’infraction EUDR.
                  </p>
                  <div className="pt-1 flex gap-2">
                    <Link
                      href="/plots"
                      onClick={() => setActionCenterOpen(false)}
                      className="rounded bg-rose-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-rose-800"
                    >
                      Inspecter la parcelle ➔
                    </Link>
                  </div>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                      Document expiré
                    </span>
                    <span className="text-[11px] text-amber-800 font-medium">Échéance : 08/10/2026</span>
                  </div>
                  <h3 className="font-semibold text-xs text-amber-950">Titre foncier expiré — Coopérative San Pedro (CI)</h3>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Attestation de légalité échue le 15/09/2026. Relance fournisseur requise pour conformité légale.
                  </p>
                  <div className="pt-1 flex gap-2">
                    <Link
                      href="/documents"
                      onClick={() => setActionCenterOpen(false)}
                      className="rounded bg-amber-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-800"
                    >
                      Relancer le fournisseur ➔
                    </Link>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-slate-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                      Données manquantes
                    </span>
                    <span className="text-[11px] text-slate-500 font-medium">Échéance : 12/10/2026</span>
                  </div>
                  <h3 className="font-semibold text-xs text-slate-900">Coordonnées incomplètes — Lot Café Minas Gerais #881</h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Surface déclarée de 8.2 ha sans polygone WGS84 fermé (seuil obligatoire 4 ha EUDR).
                  </p>
                  <div className="pt-1 flex gap-2">
                    <Link
                      href="/shipments"
                      onClick={() => setActionCenterOpen(false)}
                      className="rounded bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-900"
                    >
                      Compléter le dossier ➔
                    </Link>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 p-3 bg-slate-50 text-center">
                <span className="text-[11px] text-slate-500">3 actions prioritaires requièrent une validation humaine</span>
              </div>
            </div>
          </div>
        )}

        {/* Page Body */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
