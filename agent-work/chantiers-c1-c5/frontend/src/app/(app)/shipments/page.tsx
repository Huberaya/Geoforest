"use client";

import { useEffect, useState } from "react";
import {
  type Product,
  type ProductList,
  type Shipment,
  type ShipmentCreate,
  type ShipmentList,
  type ShipmentStatus,
  type Supplier,
  type SupplierList,
  createShipment,
  listProducts,
  listShipments,
  listSuppliers,
} from "@/lib/api";

const STATUS_LABELS: Record<ShipmentStatus, { label: string; cls: string }> = {
  draft: { label: "Brouillon", cls: "bg-slate-100 text-slate-600" },
  awaiting_data: { label: "En attente de données", cls: "bg-amber-100 text-amber-700" },
  analyzed: { label: "Analysé", cls: "bg-sky-100 text-sky-700" },
  ready: { label: "DDR prêt", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Non-conforme", cls: "bg-red-100 text-red-700" },
};

export default function ShipmentsPage() {
  const [data, setData] = useState<ShipmentList | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<ShipmentCreate>({
    reference: "",
    supplier_id: "",
    product_id: "",
    quantity: null,
    unit: "kg",
    country_of_production: "",
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [ships, sups, prods]: [ShipmentList, SupplierList, ProductList] = await Promise.all([
        listShipments({ limit: 200 }),
        listSuppliers({ limit: 200 }),
        listProducts({ limit: 200 }),
      ]);
      setData(ships);
      setSuppliers(sups.items);
      setProducts(prods.items);
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
    if (!form.supplier_id || !form.product_id) {
      setError("Sélectionnez un fournisseur et un produit.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createShipment({
        ...form,
        country_of_production: form.country_of_production?.toUpperCase().slice(0, 2) || null,
        quantity: form.quantity ?? null,
      });
      setForm({
        reference: "",
        supplier_id: "",
        product_id: "",
        quantity: null,
        unit: "kg",
        country_of_production: "",
      });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création impossible");
    } finally {
      setSubmitting(false);
    }
  }

  const canCreate = suppliers.length > 0 && products.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lots (Shipments)</h1>
          <p className="text-sm text-slate-500">
            Lots de marchandises liant un fournisseur à un produit EUDR. Les parcelles et
            documents seront rattachés aux lots dans les prochains chantiers.
          </p>
        </div>
        <button
          className="btn-primary"
          disabled={!canCreate}
          onClick={() => setShowForm((v) => !v)}
          title={!canCreate ? "Créez d'abord un fournisseur et un produit" : undefined}
        >
          {showForm ? "× Annuler" : "+ Nouveau lot"}
        </button>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Total" value={data.total} />
          {Object.entries(data.by_status).map(([k, v]) => (
            <StatCard key={k} label={STATUS_LABELS[k as ShipmentStatus]?.label || k} value={v as number} />
          ))}
        </div>
      )}

      {!canCreate && !loading && (
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            <strong>⚡ Pour créer un lot, vous avez besoin d'au moins un fournisseur et un
            produit.</strong> Rendez-vous sur{" "}
            <a className="underline" href="/suppliers">Fournisseurs</a> puis{" "}
            <a className="underline" href="/products">Produits</a>.
          </p>
        </div>
      )}

      {showForm && canCreate && (
        <form onSubmit={handleCreate} className="card space-y-3">
          <h2 className="text-sm font-semibold">Nouveau lot</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="label">Référence *</label>
              <input
                className="input"
                required
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                placeholder="LOT-2026-001"
              />
            </div>
            <div>
              <label className="label">Fournisseur *</label>
              <select
                className="input"
                required
                value={form.supplier_id}
                onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
              >
                <option value="">— Sélectionner —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.country})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Produit *</label>
              <select
                className="input"
                required
                value={form.product_id}
                onChange={(e) => setForm({ ...form, product_id: e.target.value })}
              >
                <option value="">— Sélectionner —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.commodity_label ? `(${p.commodity_label})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Quantité</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={form.quantity ?? ""}
                onChange={(e) =>
                  setForm({ ...form, quantity: e.target.value ? Number(e.target.value) : null })
                }
              />
            </div>
            <div>
              <label className="label">Unité</label>
              <input
                className="input"
                value={form.unit || ""}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder="kg, t, m3, units"
              />
            </div>
            <div>
              <label className="label">Pays de production</label>
              <input
                className="input uppercase"
                maxLength={2}
                value={form.country_of_production || ""}
                onChange={(e) => setForm({ ...form, country_of_production: e.target.value })}
                placeholder="CI, BR, ID…"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? "Création…" : "Créer le lot"}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}

      <div className="card overflow-hidden p-0">
        {loading && <div className="p-6 text-sm text-slate-500">Chargement…</div>}
        {data && data.items.length === 0 && !loading && (
          <div className="p-8 text-center">
            <p className="text-2xl">🚚</p>
            <p className="mt-2 text-sm font-semibold">Aucun lot pour le moment</p>
            <p className="mt-1 text-xs text-slate-500">
              Créez votre premier lot pour rattacher ensuite parcelles et documents.
            </p>
          </div>
        )}
        {data && data.items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Référence</th>
                <th className="px-4 py-2 text-left">Fournisseur</th>
                <th className="px-4 py-2 text-left">Produit</th>
                <th className="px-4 py-2 text-left">Quantité</th>
                <th className="px-4 py-2 text-left">Pays</th>
                <th className="px-4 py-2 text-left">Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s: Shipment) => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs font-semibold text-slate-800">{s.reference}</td>
                  <td className="px-4 py-2 text-slate-700">{s.supplier_name || "—"}</td>
                  <td className="px-4 py-2 text-slate-700">{s.product_name || "—"}</td>
                  <td className="px-4 py-2 tabular-nums text-slate-600">
                    {s.quantity != null ? `${s.quantity} ${s.unit || ""}` : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {s.country_of_production ? (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        {s.country_of_production}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_LABELS[s.status].cls}`}>
                      {STATUS_LABELS[s.status].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <strong>Prochaines étapes :</strong> les champs récolte, documents de légalité,
        géolocalisation des parcelles, analyse déforestation et génération de DDR seront
        activés par les chantiers 5 à 9.
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}
