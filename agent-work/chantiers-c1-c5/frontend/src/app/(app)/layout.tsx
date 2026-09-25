"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const NAV = [
  { href: "/dashboard", label: "Tableau de bord", icon: "📊" },
  { href: "/suppliers", label: "Fournisseurs", icon: "🏭", badge: "Chantier 3" },
  { href: "/products", label: "Produits", icon: "📦", badge: "Chantier 3" },
  { href: "/shipments", label: "Lots", icon: "🚚", badge: "Chantier 3" },
  { href: "/plots", label: "Parcelles", icon: "🗺️", badge: "Chantier 4" },
  { href: "/analysis", label: "Analyse géographique", icon: "🛰️", badge: "Chantier 5–6" },
  { href: "/documents", label: "Documents", icon: "📁", badge: "Chantier 7" },
  { href: "/risks", label: "Risques", icon: "⚠️", badge: "Chantier 8" },
  { href: "/dds", label: "Diligence raisonnée", icon: "📋", badge: "Chantier 8-9" },
  { href: "/declarations", label: "Déclarations", icon: "🇪🇺", badge: "Chantier 9" },
  { href: "/alerts", label: "Alertes", icon: "🔔", badge: "Chantier 10" },
  { href: "/reports", label: "Rapports", icon: "📈", badge: "Chantier 12" },
  { href: "/settings", label: "Paramètres", icon: "⚙️", badge: "Chantier 12" },
  { href: "/audit-log", label: "Journal d'audit", icon: "📜", badge: "Chantier 12" },
];

function AppShell({ children }: { children: ReactNode }) {
  const { user, organization, loading, isAuthed, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!loading && !isAuthed) router.replace("/auth/login");
    if (!loading && isAuthed && user?.role === "supplier") router.replace("/supplier-portal");
  }, [loading, isAuthed, user?.role, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Chargement de GeoForest Trace…</div>
      </div>
    );
  }

  if (!isAuthed || user?.role === "supplier") return null;

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside
        className={`${sidebarOpen ? "w-64" : "w-16"} flex flex-col border-r border-slate-200 bg-white transition-all duration-200`}
      >
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l4 6h-3l3.5 5H13v4h-2v-4H7.5L11 9H8l4-6z" />
            </svg>
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-900">GeoForest Trace</div>
              <div className="truncate text-[10px] uppercase tracking-wide text-slate-400">EUDR SaaS</div>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {NAV.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-emerald-50 font-semibold text-emerald-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
                title={item.label}
              >
                <span className="text-base leading-none">{item.icon}</span>
                {sidebarOpen && (
                  <>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500 group-hover:bg-white">
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-2">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="w-full rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
          >
            {sidebarOpen ? "◀ Réduire" : "▶"}
          </button>
          {sidebarOpen && user && (
            <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs">
              <div className="truncate font-semibold text-slate-800">
                {user.first_name || ""} {user.last_name || ""}
              </div>
              <div className="truncate text-slate-500">{user.email}</div>
              {organization && (
                <div className="mt-1 truncate text-[10px] text-emerald-700">{organization.name}</div>
              )}
              <button
                onClick={logout}
                className="mt-2 w-full rounded-md bg-white px-2 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-red-50 hover:text-red-700 hover:ring-red-200"
              >
                Se déconnecter
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Contenu */}
      <main className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {findCrumb(pathname)}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">
              MVP · Chantier 1
            </span>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </main>
    </div>
  );
}

function findCrumb(path: string | null) {
  if (!path) return "";
  const item = NAV.find((n) => path.startsWith(n.href));
  return item?.label ?? "GeoForest Trace";
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
