"use client";

import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
}

interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: string;
  badgeColor?: "red" | "amber" | "emerald" | "slate";
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: "📊" },
  { label: "Fournisseurs", href: "/suppliers", icon: "👥" },
  { label: "Produits", href: "/products", icon: "📦" },
  { label: "Lots / Expéditions", href: "/shipments", icon: "🚚" },
  { label: "Parcelles", href: "/plots", icon: "🗺️" },
  { label: "Analyses", href: "/analyses", icon: "🛰️" },
  { label: "Documents", href: "/documents", icon: "📁", badge: "17 à vérifier", badgeColor: "amber" },
  { label: "Risques", href: "/risks", icon: "⚠️", badge: "23 à risque", badgeColor: "red" },
  { label: "Diligence raisonnée", href: "/due-diligence", icon: "📋" },
  { label: "Déclarations", href: "/declarations", icon: "🏛️" },
  { label: "Alertes", href: "/alerts", icon: "🔔", badge: "4 critiques", badgeColor: "red" },
  { label: "Rapports", href: "/reports", icon: "📑" },
  { label: "Audit Log", href: "/audit-logs", icon: "📜" },
  { label: "Paramètres", href: "/settings", icon: "⚙️" },
];

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, organization, isAuthenticated, logout, switchOrganization, availableOrganizations } = useAuth();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [actionCenterOpen, setActionCenterOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  // If on pure authentication pages, render full-screen view
  const isAuthPage =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password";

  if (isAuthPage) {
    return <>{children}</>;
  }

  const handleLogout = () => {
    logout();
    setUserDropdownOpen(false);
    router.push("/login");
  };

  const userInitials = user?.avatar || (user?.name ? user.name.slice(0, 2).toUpperCase() : "MD");

  return (
    <div className="flex min-h-screen bg-[#F8FAFC] text-slate-900 font-sans">
      {/* Sidebar Desktop */}
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        {/* Logo / Brand Header */}
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0D5B41] text-white shadow-sm font-bold text-base">
              🌿
            </div>
            <div>
              <div className="font-extrabold text-sm tracking-tight text-slate-900 leading-tight">GeoForest Trace</div>
              <div className="text-[10px] text-[#0D5B41] font-bold tracking-wide uppercase">
                Traçabilité • Conformité • Durabilité
              </div>
            </div>
          </Link>
        </div>

        {/* Tenant Selector Pill */}
        <div className="px-3 pt-3 pb-1">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2 text-xs flex items-center justify-between">
            <div className="overflow-hidden">
              <div className="font-bold text-slate-900 truncate text-[11px]">{organization?.name || "Entreprise SA"}</div>
              <div className="text-[10px] text-slate-400 font-mono">EORI: {organization?.eori || "FR123456789"}</div>
            </div>
            <Link
              href="/settings"
              className="text-slate-400 hover:text-slate-700 text-xs px-1"
              title="Paramètres de l'organisation"
            >
              ⚙️
            </Link>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3 text-xs">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between rounded-xl px-3 py-2 font-medium transition ${
                  isActive
                    ? "bg-[#0D5B41] text-white font-semibold shadow-xs"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-sm">{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
                      item.badgeColor === "red"
                        ? isActive
                          ? "bg-rose-500 text-white"
                          : "bg-rose-100 text-rose-700"
                        : item.badgeColor === "amber"
                        ? isActive
                          ? "bg-amber-500 text-white"
                          : "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User Profile Footer */}
        <div className="border-t border-slate-200 p-3 bg-slate-50/60 relative">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setUserDropdownOpen(!userDropdownOpen)}
              className="flex items-center gap-2.5 text-left focus:outline-none flex-1 overflow-hidden"
            >
              <div className="h-8 w-8 rounded-full bg-[#0D5B41] text-white flex items-center justify-center font-bold text-xs shrink-0">
                {userInitials}
              </div>
              <div className="truncate">
                <div className="text-xs font-bold text-slate-900 truncate">{user?.name || "Marie Dupont"}</div>
                <div className="text-[10px] text-slate-500 truncate">{user?.jobTitle || "Lead EUDR"}</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setUserDropdownOpen(!userDropdownOpen)}
              className="text-slate-400 hover:text-slate-700 text-xs px-1"
            >
              ⋮
            </button>
          </div>

          {/* User Dropdown Menu */}
          {userDropdownOpen && (
            <div className="absolute bottom-16 left-3 right-3 z-50 rounded-2xl bg-white border border-slate-200 shadow-xl p-2 text-xs space-y-1">
              <div className="px-3 py-2 border-b border-slate-100">
                <div className="font-bold text-slate-900">{user?.name}</div>
                <div className="text-[10px] text-slate-400">{user?.email}</div>
              </div>
              <Link
                href="/profile"
                onClick={() => setUserDropdownOpen(false)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-700 hover:bg-slate-50"
              >
                <span>👤</span>
                <span>Mon Profil</span>
              </Link>
              <Link
                href="/settings"
                onClick={() => setUserDropdownOpen(false)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-700 hover:bg-slate-50"
              >
                <span>⚙️</span>
                <span>Paramètres Organisation</span>
              </Link>
              <Link
                href="/onboarding"
                onClick={() => setUserDropdownOpen(false)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-700 hover:bg-slate-50"
              >
                <span>🌱</span>
                <span>Guide de démarrage</span>
              </Link>
              <div className="border-t border-slate-100 pt-1">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-rose-700 hover:bg-rose-50 text-left font-semibold"
                >
                  <span>🚪</span>
                  <span>Se déconnecter</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Navbar */}
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              ☰
            </button>
            <div className="relative hidden sm:block w-72">
              <input
                type="text"
                placeholder="Rechercher parcelle, fournisseur, lot..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-8 pr-3 py-1.5 text-xs focus:border-[#0D5B41] focus:bg-white focus:outline-none"
              />
              <span className="absolute left-2.5 top-2 text-slate-400 text-xs">🔍</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Link to Mobile Supplier Portal */}
            <Link
              href="/supplier-portal"
              className="hidden sm:inline-flex rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs items-center gap-1.5"
            >
              <span>📱</span>
              <span>Portail Mobile Fournisseur</span>
            </Link>

            {/* Action Center Button */}
            <button
              type="button"
              onClick={() => setActionCenterOpen(!actionCenterOpen)}
              className="relative rounded-xl bg-rose-50 border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 flex items-center gap-1.5 shadow-2xs"
            >
              <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
              <span>ACTIONS</span>
              <span className="rounded-full bg-rose-600 px-1.5 py-0.2 text-[10px] text-white">4</span>
            </button>

            {/* User Profile Avatar with dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="h-8 w-8 rounded-full bg-[#0D5B41] text-white flex items-center justify-center font-bold text-xs shadow-xs focus:ring-2 focus:ring-[#0D5B41]"
              >
                {userInitials}
              </button>

              {userDropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white border border-slate-200 shadow-xl p-2 text-xs space-y-1 z-50">
                  <div className="px-3 py-2 border-b border-slate-100">
                    <div className="font-bold text-slate-900">{user?.name || "Marie Dupont"}</div>
                    <div className="text-[10px] text-slate-400">{user?.email}</div>
                  </div>
                  <Link
                    href="/profile"
                    onClick={() => setUserDropdownOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-700 hover:bg-slate-50"
                  >
                    <span>👤</span>
                    <span>Mon Profil</span>
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setUserDropdownOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-700 hover:bg-slate-50"
                  >
                    <span>⚙️</span>
                    <span>Paramètres Organisation</span>
                  </Link>
                  <Link
                    href="/onboarding"
                    onClick={() => setUserDropdownOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-slate-700 hover:bg-slate-50"
                  >
                    <span>🌱</span>
                    <span>Guide de démarrage</span>
                  </Link>
                  <div className="border-t border-slate-100 pt-1">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-rose-700 hover:bg-rose-50 text-left font-semibold"
                    >
                      <span>🚪</span>
                      <span>Se déconnecter</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div className="fixed inset-0 bg-slate-900/50" onClick={() => setMobileMenuOpen(false)} />
            <div className="relative flex w-64 flex-col bg-white p-4 shadow-xl">
              <div className="flex items-center justify-between border-b pb-3 mb-3">
                <span className="font-bold text-sm text-[#0D5B41]">GeoForest Trace</span>
                <button type="button" onClick={() => setMobileMenuOpen(false)} className="text-slate-400 text-sm">
                  ✕
                </button>
              </div>

              <div className="rounded-xl bg-slate-50 border p-2 mb-3 text-xs">
                <div className="font-bold text-slate-900">{organization?.name}</div>
                <div className="text-[10px] text-slate-500 font-mono">EORI: {organization?.eori}</div>
              </div>

              <nav className="flex-1 space-y-1 overflow-y-auto text-xs">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-between rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <span className="flex items-center gap-2">
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </span>
                    {item.badge && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                ))}
              </nav>

              <div className="border-t pt-3 mt-3">
                <Link
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-rose-700 hover:bg-rose-50 text-xs font-semibold"
                >
                  <span>🚪</span>
                  <span>Changer de compte / Se déconnecter</span>
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Quick Action Drawer */}
        {actionCenterOpen && (
          <div className="fixed inset-y-0 right-0 z-50 w-80 bg-white border-l border-slate-200 shadow-2xl p-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b pb-3">
                <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <span>🚨</span>
                  <span>Centre d'Action Immédiat</span>
                </h3>
                <button type="button" onClick={() => setActionCenterOpen(false)} className="text-slate-400 text-sm">
                  ✕
                </button>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-1">
                  <div className="font-bold text-rose-900">4 Actions Critiques</div>
                  <p className="text-[11px] text-rose-800">Déforestation post-2020 détectée sur Fazenda Santa Maria (BR).</p>
                  <Link href="/plots" className="text-[10px] font-bold text-rose-700 underline block pt-1">
                    Bloquer le lot →
                  </Link>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
                  <div className="font-bold text-amber-900">17 Actions à effectuer</div>
                  <p className="text-[11px] text-amber-800">Documents de légalité arrivant à expiration sous 30 jours.</p>
                  <Link href="/documents" className="text-[10px] font-bold text-amber-700 underline block pt-1">
                    Gérer les relances →
                  </Link>
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-1">
                  <div className="font-bold text-emerald-900">42 Dossiers terminés</div>
                  <p className="text-[11px] text-emerald-800">DDR 100% complètes prêtes pour transmission TRACES-NT.</p>
                  <Link href="/due-diligence" className="text-[10px] font-bold text-emerald-700 underline block pt-1">
                    Voir les dossiers →
                  </Link>
                </div>
              </div>
            </div>

            <Link
              href="/alerts"
              onClick={() => setActionCenterOpen(false)}
              className="w-full text-center rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800"
            >
              Voir toutes les actions
            </Link>
          </div>
        )}

        {/* Page Content Body */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
