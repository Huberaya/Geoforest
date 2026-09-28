"use client";

import { useCallback, useEffect, useState } from "react";
import AlertRow from "@/components/dashboard/AlertRow";
import {
  type AlertCategory,
  type AlertItem,
  type AlertListParams,
  type AlertListResult,
  fetchAlerts,
  markAlertRead,
  markAlertUnread,
  markAllAlertsRead,
} from "@/lib/api";

const PAGE_SIZE = 20;
const CATEGORIES: { value: AlertCategory; label: string }[] = [
  { value: "onboarding", label: "Démarrage" },
  { value: "plot", label: "Parcelles" },
  { value: "document", label: "Documents" },
  { value: "supplier", label: "Fournisseurs" },
  { value: "analysis", label: "Analyses" },
  { value: "dds", label: "DDR" },
  { value: "compliance", label: "Conformité" },
  { value: "system", label: "Système" },
];

export default function AlertsPage() {
  const [data, setData] = useState<AlertListResult | null>(null);
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all");
  const [category, setCategory] = useState<AlertCategory | "all">("all");
  const [level, setLevel] = useState<AlertItem["level"] | "all">("all");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params: AlertListParams = { limit: PAGE_SIZE, offset };
    if (readFilter !== "all") params.is_read = readFilter === "read";
    if (category !== "all") params.category = category;
    if (level !== "all") params.level = level;
    try {
      setData(await fetchAlerts(params));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de charger les notifications.");
    } finally {
      setLoading(false);
    }
  }, [category, level, offset, readFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateReadState(id: string, isRead: boolean) {
    setWorking(true);
    setError(null);
    try {
      if (isRead) await markAlertRead(id);
      else await markAlertUnread(id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de mettre à jour la notification.");
    } finally {
      setWorking(false);
    }
  }

  async function markAllRead() {
    setWorking(true);
    setError(null);
    try {
      await markAllAlertsRead();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de marquer les notifications comme lues.");
    } finally {
      setWorking(false);
    }
  }

  function resetFilters() {
    setOffset(0);
  }

  const total = data?.total ?? 0;
  const unreadCount = data?.unread_count ?? 0;
  const firstItem = total === 0 ? 0 : offset + 1;
  const lastItem = Math.min(offset + PAGE_SIZE, total);

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Centre de notifications</h1>
          <p className="mt-1 text-sm text-slate-500">
            Vos notifications restent disponibles dans cet espace; l’état lu/non lu est personnel.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800" aria-live="polite">
            {unreadCount} non lue{unreadCount === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={markAllRead}
            disabled={working || unreadCount === 0}
            className="btn-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            Tout marquer comme lu
          </button>
        </div>
      </header>

      <div className="card flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          État
          <select
            value={readFilter}
            onChange={(event) => { setReadFilter(event.target.value as typeof readFilter); resetFilters(); }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
          >
            <option value="all">Toutes</option>
            <option value="unread">Non lues</option>
            <option value="read">Lues</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Catégorie
          <select
            value={category}
            onChange={(event) => { setCategory(event.target.value as AlertCategory | "all"); resetFilters(); }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
          >
            <option value="all">Toutes les catégories</option>
            {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600">
          Niveau
          <select
            value={level}
            onChange={(event) => { setLevel(event.target.value as typeof level); resetFilters(); }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
          >
            <option value="all">Tous les niveaux</option>
            <option value="critical">Critique</option>
            <option value="warning">Avertissement</option>
            <option value="info">Information</option>
            <option value="success">Succès</option>
          </select>
        </label>
        <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary px-3 py-2 text-xs">
          Actualiser
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
          <button type="button" onClick={() => void load()} className="ml-3 font-semibold underline">Réessayer</button>
        </div>
      )}

      <div className="card space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
          <span className="text-xs text-slate-500">{total} résultat{total === 1 ? "" : "s"}</span>
        </div>
        {loading && !data && <p className="py-8 text-center text-sm text-slate-500">Chargement…</p>}
        {!loading && data?.items.length === 0 && (
          <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            {readFilter === "unread" ? "Aucune notification non lue." : "Aucune notification pour ces filtres."}
          </p>
        )}
        {data?.items.map((alert) => (
          <AlertRow
            key={alert.id}
            alert={alert}
            onMarkRead={(id) => void updateReadState(id, true)}
            onMarkUnread={(id) => void updateReadState(id, false)}
          />
        ))}
        <footer className="flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-xs text-slate-500">
            {total > 0 ? `Affichage ${firstItem}–${lastItem} sur ${total}` : "Aucun résultat"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              disabled={offset === 0 || loading}
              className="btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              Précédent
            </button>
            <button
              type="button"
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total || loading}
              className="btn-secondary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              Suivant
            </button>
          </div>
        </footer>
      </div>
    </section>
  );
}
