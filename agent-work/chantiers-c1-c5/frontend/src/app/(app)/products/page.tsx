"use client";

import { useEffect, useState } from "react";
import {
  type Commodity,
  type Product,
  type ProductCreate,
  type ProductList,
  createProduct,
  listCommodities,
  listProducts,
} from "@/lib/api";

export default function ProductsPage() {
  const [data, setData] = useState<ProductList | null>(null);
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProductCreate>({ name: "", commodity: "cocoa", hs_code: "" });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [products, comms] = await Promise.all([listProducts({ limit: 200 }), listCommodities()]);
      setData(products);
      setCommodities(comms.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
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
      await createProduct({
        ...form,
        hs_code: form.hs_code || undefined,
      });
      setForm({ name: "", commodity: "cocoa", hs_code: "" });
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
          <h1 className="text-2xl font-bold text-slate-900">Produits & Commodités</h1>
          <p className="text-sm text-slate-500">
            Commodités EUDR (Annexe I) que vous mettez sur le marché européen.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "× Annuler" : "+ Nouveau produit"}
        </button>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatCard label="Produits" value={data.total} />
          <StatCard label="Commodités EUDR" value={commodities.length} tone="emerald" />
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="card space-y-3">
          <h2 className="text-sm font-semibold">Nouveau produit</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="md:col-span-1">
              <label className="label">Commodité EUDR *</label>
              <select
                className="input"
                value={form.commodity}
                onChange={(e) => setForm({ ...form, commodity: e.target.value })}
              >
                {commodities.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label} ({c.hs})
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="label">Nom du produit *</label>
              <input
                className="input"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex : Cacao fèves grade 1"
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Code SH pré-rempli selon la commodité. Il pourra être affiné à 6/8 chiffres au chantier 7 (DDR).
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? "Création…" : "Créer"}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}

      <div className="card overflow-hidden p-0">
        {loading && <div className="p-6 text-sm text-slate-500">Chargement…</div>}
        {data && data.items.length === 0 && !loading && (
          <div className="p-8 text-center">
            <p className="text-2xl">📦</p>
            <p className="mt-2 text-sm font-semibold">Aucun produit enregistré</p>
            <p className="mt-1 text-xs text-slate-500">
              Sélectionnez une commodité EUDR (cacao, café, bois…) et créez votre premier produit.
            </p>
          </div>
        )}
        {data && data.items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Nom</th>
                <th className="px-4 py-2 text-left">Commodité</th>
                <th className="px-4 py-2 text-left">Code SH</th>
                <th className="px-4 py-2 text-left">Lots</th>
                <th className="px-4 py-2 text-left">Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p: Product) => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-800">{p.name}</td>
                  <td className="px-4 py-2 text-slate-600">{p.commodity_label || p.commodity}</td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-emerald-50 px-2 py-0.5 font-mono text-xs text-emerald-700">
                      {p.hs_code || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{p.shipments_count}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <strong>Source :</strong> la liste des commodités est basée sur l'Annexe I du Règlement (UE)
        2023/1115. Les codes SH à 4 chiffres sont indicatifs ; la classification précise
        (nomenclature combinée 2025) sera intégrée au chantier 7.
      </div>
    </div>
  );
}

function StatCard({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "emerald" }) {
  const cls = tone === "emerald" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-white border-slate-200 text-slate-900";
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
