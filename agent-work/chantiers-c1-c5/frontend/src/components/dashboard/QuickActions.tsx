"use client";

import Link from "next/link";

const ACTIONS = [
  {
    label: "Inviter un membre",
    href: "/settings",
    icon: "👥",
    available: true,
    desc: "Ajoutez votre équipe conformité/achats",
  },
  {
    label: "Ajouter un fournisseur",
    href: "/suppliers",
    icon: "🏭",
    available: true,
    desc: "Producteurs, coopératives, négociants",
  },
  {
    label: "Nouveau produit",
    href: "/products",
    icon: "📦",
    available: true,
    desc: "Cacao, café, bois, caoutchouc…",
  },
  {
    label: "Créer un lot",
    href: "/shipments",
    icon: "🚚",
    available: true,
    desc: "Lier un fournisseur à un produit",
  },
  {
    label: "Importer des parcelles",
    href: "/plots",
    icon: "🗺️",
    available: true,
    desc: "GeoJSON, KML, dessin sur carte",
  },
  {
    label: "Nouveau dossier DDR",
    href: "/dds",
    icon: "📋",
    available: false,
    chantier: 9,
    desc: "Générer un dossier de diligence",
  },
];

export default function QuickActions() {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-slate-900">⚡ Actions rapides</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ACTIONS.map((a) => {
          const content = (
            <div
              className={`flex items-start gap-3 rounded-xl border p-3 transition ${
                a.available
                  ? "border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40 cursor-pointer"
                  : "cursor-not-allowed border-slate-100 bg-slate-50 opacity-70"
              }`}
            >
              <span className="text-xl leading-none">{a.icon}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800">{a.label}</div>
                <div className="text-xs text-slate-500">{a.desc}</div>
                {!a.available && a.chantier && (
                  <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Chantier {a.chantier}
                  </div>
                )}
              </div>
            </div>
          );
          return a.available ? (
            <Link key={a.label} href={a.href}>{content}</Link>
          ) : (
            <div key={a.label}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
