"use client";

import { COMMODITIES, COMMODITY_HS_CODES, COMMODITY_LABELS, type Commodity, type Product } from "@/lib/eudr/types";
import { useEffect, useState } from "react";

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
    sku: "",
    commodity: "cocoa" as Commodity,
    hsCode: "1801",
    countryOfOrigin: "CI",
    annualVolumeKg: 100000,
  });

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/products");
      if (res.ok) {
        setProducts(await res.json());
      }
    } catch {
      /* non-bloquant */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProducts();
  }, []);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/v1/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newProduct),
      });
      if (res.ok) {
        setShowAddModal(false);
        setNewProduct({
          name: "",
          sku: "",
          commodity: "cocoa",
          hsCode: "1801",
          countryOfOrigin: "CI",
          annualVolumeKg: 100000,
        });
        void fetchProducts();
      }
    } catch {
      /* fallback */
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Catalogue des Produits & Matières Premières EUDR
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Nomenclature des 7 matières premières visées par le Règlement (UE) 2023/1115 et codes douaniers SH.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 transition-all"
        >
          + Nouveau Produit
        </button>
      </div>

      {/* Official 7 EUDR Commodities Reference Grid */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Référentiel des 7 Matières Premières EUDR (Annexe I)
          </h2>
          <span className="text-[10px] text-slate-400">Règlement (UE) 2023/1115</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {COMMODITIES.map((c) => (
            <div key={c.value} className="rounded-xl bg-slate-50 p-3 border border-slate-100 text-center space-y-1">
              <div className="text-lg">
                {c.value === "cocoa"
                  ? "🍫"
                  : c.value === "coffee"
                    ? "☕"
                    : c.value === "palm_oil"
                      ? "🌴"
                      : c.value === "rubber"
                        ? "🛞"
                        : c.value === "soya"
                          ? "🌱"
                          : c.value === "cattle"
                            ? "🥩"
                            : "🪵"}
              </div>
              <div className="font-bold text-xs text-slate-800 truncate">{c.label.split("(")[0]}</div>
              <div className="text-[10px] font-mono font-semibold text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5 inline-block">
                SH {c.hsCode}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Company Products Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Références produits de l’entreprise ({products.length})</h2>
          <span className="text-xs text-slate-400">Traçabilité douanière active</span>
        </div>
        <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
          <thead className="bg-slate-50 font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-3">Désignation & SKU</th>
              <th className="px-4 py-3">Matière première</th>
              <th className="px-4 py-3">Code SH</th>
              <th className="px-4 py-3">Origine</th>
              <th className="px-4 py-3">Volume annuel estimé</th>
              <th className="px-4 py-3">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Chargement des produits...
                </td>
              </tr>
            ) : products.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  Aucun produit enregistré.
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="font-semibold text-slate-900">{p.name}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{p.sku ?? "Sans SKU"}</div>
                  </td>
                  <td className="px-4 py-3.5 font-medium">{COMMODITY_LABELS[p.commodity] ?? p.commodity}</td>
                  <td className="px-4 py-3.5 font-mono text-emerald-800 font-semibold">SH {p.hsCode}</td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-800">
                      <span>{p.countryOfOrigin === "CI" ? "🇨🇮" : p.countryOfOrigin === "ID" ? "🇮🇩" : p.countryOfOrigin === "BR" ? "🇧🇷" : p.countryOfOrigin === "CO" ? "🇨🇴" : "🌐"}</span>
                      <span>{p.countryOfOrigin}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-semibold text-slate-900">
                    {(p.annualVolumeKg / 1000).toLocaleString("fr-FR")} tonnes
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-[10px] font-bold">
                      ACTIF
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={() => setShowAddModal(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl z-10 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">Ajouter un produit / référence</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Désignation commerciale *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex : Fèves de cacao brutes fermentation naturelle"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Matière première *</label>
                  <select
                    value={newProduct.commodity}
                    onChange={(e) => {
                      const comm = e.target.value as Commodity;
                      setNewProduct({
                        ...newProduct,
                        commodity: comm,
                        hsCode: COMMODITY_HS_CODES[comm] ?? "0000",
                      });
                    }}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  >
                    {COMMODITIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Code SH (Douanes) *</label>
                  <input
                    type="text"
                    required
                    value={newProduct.hsCode}
                    onChange={(e) => setNewProduct({ ...newProduct, hsCode: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">SKU / Réf interne</label>
                  <input
                    type="text"
                    placeholder="Ex : CAC-CI-01"
                    value={newProduct.sku}
                    onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Pays d’origine *</label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={newProduct.countryOfOrigin}
                    onChange={(e) => setNewProduct({ ...newProduct, countryOfOrigin: e.target.value.toUpperCase() })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Ajouter le produit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
