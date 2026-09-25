"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  type Supplier,
  type SupplierCreate,
  type SupplierList,
  type SupplierStatus,
  type SupplierType,
  createSupplier,
  listSuppliers,
} from "@/lib/api";

const STATUS_TONE: Record<SupplierStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-700",
  suspended: "bg-red-100 text-red-700",
  archived: "bg-slate-200 text-slate-500",
};

const SUPPLIER_TYPE_LABELS: Record<SupplierType, string> = {
  producer: "Producteur",
  cooperative: "Coopérative",
  trader: "Négociant",
  processor: "Transformateur",
  other: "Autre",
};

const EMPTY_FORM: SupplierCreate = {
  name: "",
  supplier_type: "producer",
  country: "",
  contact_email: "",
};

export default function SuppliersPage() {
  const [data, setData] = useState<SupplierList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SupplierCreate>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await listSuppliers({ limit: 200 });
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createSupplier({
        ...form,
        country: form.country.toUpperCase().slice(0, 2),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création impossible");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Fournisseurs</h1>
          <p className="text-sm text-slate-500">
            Producteurs, coopératives, négociants — toutes les entités de votre chaîne
            d'approvisionnement.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "× Annuler" : "+ Nouveau fournisseur"}
        </button>
      </div>

      {/* Compteurs */}
      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total" value={data.total} />
          <StatCard label="Actifs" value={data.by_status.active || 0} tone="emerald" />
          <StatCard label="En attente" value={data.by_status.pending || 0} tone="amber" />
          <StatCard label="À risque évalué" value={data.by_risk.high || 0} tone="red" />
        </div>
      )}

      {/* Formulaire de création */}
      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Nouveau fournisseur</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="label">Nom *</label>
              <input
                className="input"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex : Coopérative Cacao Kpalimé"
              />
            </div>
            <div>
              <label className="label">Type</label>
              <select
                className="input"
                value={form.supplier_type}
                onChange={(e) =>
                  setForm({ ...form, supplier_type: e.target.value as SupplierType })
                }
              >
                {Object.entries(SUPPLIER_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Pays (ISO 2) *</label>
              <input
                className="input uppercase"
                required
                maxLength={2}
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                placeholder="CI, TG, BR, ID…"
              />
            </div>
            <div>
              <label className="label">Email contact</label>
              <input
                className="input"
                type="email"
                value={form.contact_email || ""}
                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                placeholder="contact@fournisseur.com"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? "Création…" : "Créer le fournisseur"}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}

      {/* Liste */}
      <div className="card overflow-hidden p-0">
        {loading && <div className="p-6 text-sm text-slate-500">Chargement…</div>}
        {error && !showForm && <div className="p-6 text-sm text-red-600">{error}</div>}
        {data && data.items.length === 0 && !loading && (
          <div className="p-8 text-center">
            <p className="text-2xl">🏭</p>
            <p className="mt-2 text-sm font-semibold text-slate-800">
              Aucun fournisseur pour le moment
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Créez votre premier fournisseur pour commencer à cartographier votre chaîne
              d'approvisionnement.
            </p>
            <button className="btn-primary mt-4" onClick={() => setShowForm(true)}>
              + Créer un fournisseur
            </button>
          </div>
        )}
        {data && data.items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Nom</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">Pays</th>
                <th className="px-4 py-2 text-left">Lots</th>
                <th className="px-4 py-2 text-left">Statut</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((s: Supplier) => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-800">
                    <Link href={`/suppliers/${s.id}`} className="hover:underline">
                      {s.name}
                    </Link>
                    {s.contact_email && (
                      <div className="text-xs text-slate-500">{s.contact_email}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {SUPPLIER_TYPE_LABELS[s.supplier_type]}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {s.country}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular-nums text-slate-600">{s.shipments_count}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[s.status]}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/suppliers/${s.id}`} className="text-xs font-semibold text-emerald-700 hover:underline">
                      Détails →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <strong>Portail fournisseur :</strong> invitez le contact depuis la fiche du fournisseur
        pour lui permettre de compléter ses coordonnées. La saisie des parcelles et le dépôt de
        documents par le fournisseur ne sont pas encore disponibles dans ce portail.
      </div>
    </div>
  );
}

function StatCard({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "emerald" | "amber" | "red" }) {
  const map = {
    slate: "bg-white border-slate-200 text-slate-900",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    red: "bg-red-50 border-red-200 text-red-800",
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${map}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
