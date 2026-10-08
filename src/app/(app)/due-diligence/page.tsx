"use client";

import { Badge, Card, EmptyState, ErrorState, LoadingState, Metric, PageHeader } from "@/components/PageShell";
import RiskBadge from "@/components/RiskBadge";
import { ApiError, createStatement, listStatements } from "@/lib/api";
import {
  COMMODITIES,
  COMMODITY_LABELS,
  DDS_STATUS_LABELS,
  type Commodity,
  type DdsStatus,
  type DiligenceStatement,
} from "@/lib/eudr/types";
import Link from "next/link";
import { useEffect, useState } from "react";

const TONES: Record<DdsStatus, string> = {
  DRAFT: "grey",
  MISSING_DATA: "amber",
  IN_ANALYSIS: "blue",
  UNDER_REVIEW: "blue",
  RISK_IDENTIFIED: "amber",
  ACTION_REQUIRED: "red",
  READY_FOR_DECLARATION: "green",
  DECLARED: "green",
  ARCHIVED: "grey",
};

export default function DueDiligencePage() {
  const [items, setItems] = useState<DiligenceStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", commodity: "cocoa" as Commodity });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listStatements());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Impossible de charger les dossiers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Différé d'un micro-tâche : l'effet ne déclenche pas de rendu
    // en cascade (règle react-hooks/set-state-in-effect).
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
     
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createStatement({ title: form.title, commodity: form.commodity });
      setForm({ title: "", commodity: form.commodity });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Création impossible : le dossier n'a pas été enregistré.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Diligence raisonnée"
        subtitle="Dossiers de diligence raisonnée et leur cycle de vie, de la collecte à la déclaration."
        actions={
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            {showForm ? "Annuler" : "+ Nouveau dossier"}
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Dossiers" value={items.length} />
        <Metric label="Brouillons" value={items.filter((i) => i.status === "DRAFT").length} />
        <Metric label="Prêts à déclarer" value={items.filter((i) => i.status === "READY_FOR_DECLARATION").length} />
        <Metric label="Actions ouvertes" value={items.reduce((s, i) => s + i.tasksOpen, 0)} />
      </div>

      {showForm && (
        <Card className="mb-4 p-4">
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700">Intitulé du dossier *</label>
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="ex. Cacao Côte d'Ivoire — campagne 2026"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Matière première *</label>
              <select
                value={form.commodity}
                onChange={(e) => setForm({ ...form, commodity: e.target.value as Commodity })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
              >
                {COMMODITIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {saving ? "Création…" : "Créer le dossier"}
              </button>
            </div>
          </form>
        </Card>
      )}

      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      <Card>
        {loading ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <EmptyState
            title="Aucun dossier de diligence raisonnée"
            message="Un dossier se constitue à partir d'un fournisseur, d'un produit, des parcelles géolocalisées et de leurs documents. Créez le premier dossier pour démarrer le cycle."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <Link href={`/due-diligence/${i.id}`} className="text-xs font-semibold text-slate-800 hover:text-emerald-700">
                    {i.title}
                  </Link>
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    <span className="font-mono">{i.reference}</span> · {COMMODITY_LABELS[i.commodity] ?? i.commodity}
                    {i.supplierName ? ` · ${i.supplierName}` : ""} · modifié le{" "}
                    {new Date(i.updatedAt).toLocaleDateString("fr-FR")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {i.tasksOpen > 0 && <Badge tone="amber">{i.tasksOpen} action(s)</Badge>}
                  <RiskBadge level={i.riskLevel} />
                  <Badge tone={TONES[i.status]}>{DDS_STATUS_LABELS[i.status] ?? i.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
