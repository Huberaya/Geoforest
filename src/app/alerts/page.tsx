"use client";

import { type AlertRecord } from "@/lib/eudr/types";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSeverity, setFilterSeverity] = useState<string>("ALL");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/alerts");
        if (res.ok) setAlerts(await res.json());
      } catch {
        /* fallback */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleAcknowledge = async (id: string) => {
    try {
      const res = await fetch("/api/v1/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "ACKNOWLEDGED" }),
      });

      if (res.ok) {
        setAlerts((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: "ACKNOWLEDGED" } : a)),
        );
      }
    } catch {
      alert("Erreur lors de l'acquittement.");
    }
  };

  const handleMarkAllRead = () => {
    setAlerts((prev) => prev.map((a) => ({ ...a, status: "ACKNOWLEDGED" })));
  };

  const filteredAlerts = alerts.filter((a) => {
    if (filterSeverity !== "ALL" && a.severity !== filterSeverity) return false;
    return true;
  });

  const criticalCount = alerts.filter((a) => a.severity === "CRITICAL").length;
  const highCount = alerts.filter((a) => a.severity === "HIGH").length;
  const unreadCount = alerts.filter((a) => a.status === "UNREAD").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Centre d'Action & Alertes de Conformité</h1>
          <p className="text-xs text-slate-500">
            Pilotage opérationnel en temps réel des blocages critiques, expirations documentaires et relances fournisseurs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
            >
              Tout marquer comme lu ✓
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Total Notifications</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{alerts.length}</div>
          <div className="text-[10px] text-slate-500">Signaux actifs sur la chaîne</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Non Lues / À Traiter</div>
          <div className="mt-2 text-2xl font-bold text-sky-600">{unreadCount}</div>
          <div className="text-[10px] text-sky-600 font-semibold">Action prioritaire</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Alertes Critiques (P1)</div>
          <div className="mt-2 text-2xl font-bold text-rose-600">{criticalCount}</div>
          <div className="text-[10px] text-rose-600 font-semibold">Déforestation & Rejet douane</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Échéances & Documents (P2)</div>
          <div className="mt-2 text-2xl font-bold text-amber-600">{highCount}</div>
          <div className="text-[10px] text-amber-600 font-semibold">Expiration sous 30 jours</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs focus:border-emerald-500 focus:outline-none"
          >
            <option value="ALL">Toutes les sévérités</option>
            <option value="CRITICAL">Critique (P1)</option>
            <option value="HIGH">Élevée (P2)</option>
            <option value="MEDIUM">Moyenne (P3)</option>
            <option value="LOW">Basse (P4)</option>
          </select>
        </div>
      </div>

      {/* Alert Cards Feed */}
      <div className="space-y-3">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-400">
            Chargement des alertes opérationnelles...
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-400">
            Aucune alerte dans cette catégorie.
          </div>
        ) : (
          filteredAlerts.map((a) => {
            const isCritical = a.severity === "CRITICAL";
            const isHigh = a.severity === "HIGH";
            const isUnread = a.status === "UNREAD";

            return (
              <div
                key={a.id}
                className={`rounded-2xl border p-4 shadow-xs transition flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${
                  isCritical
                    ? "border-rose-200 bg-rose-50/30"
                    : isHigh
                    ? "border-amber-200 bg-amber-50/30"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 text-xl">
                    {isCritical ? "🚨" : isHigh ? "⏳" : "📡"}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          isCritical
                            ? "bg-rose-600 text-white"
                            : isHigh
                            ? "bg-amber-600 text-white"
                            : "bg-slate-700 text-white"
                        }`}
                      >
                        {a.severity}
                      </span>
                      <h3 className="font-bold text-slate-900 text-xs">{a.title}</h3>
                      {isUnread && (
                        <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" title="Non lu" />
                      )}
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{a.description}</p>
                    <div className="text-[10px] font-mono text-slate-400">
                      {new Date(a.createdAt).toLocaleString("fr-FR")}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  {isUnread && (
                    <button
                      type="button"
                      onClick={() => handleAcknowledge(a.id)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                    >
                      Acquitter ✓
                    </button>
                  )}
                  <Link
                    href={a.linkHref}
                    className="rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800"
                  >
                    {a.linkLabel} →
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
