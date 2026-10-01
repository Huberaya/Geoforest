"use client";

import { COMMODITIES, COMMODITY_LABELS, type Commodity, type RiskLevel, type Supplier } from "@/lib/eudr/types";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCommodity, setFilterCommodity] = useState<string>("");
  const [filterRisk, setFilterRisk] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSupplier, setNewSupplier] = useState({
    name: "",
    eori: "",
    country: "CI",
    commodity: "cocoa" as Commodity,
    contactName: "",
    contactEmail: "",
    contactPhone: "",
  });

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/suppliers");
      if (res.ok) {
        setSuppliers(await res.json());
      }
    } catch {
      /* non bloquant */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchSuppliers();
  }, []);

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/v1/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSupplier),
      });
      if (res.ok) {
        setShowAddModal(false);
        setNewSupplier({
          name: "",
          eori: "",
          country: "CI",
          commodity: "cocoa",
          contactName: "",
          contactEmail: "",
          contactPhone: "",
        });
        void fetchSuppliers();
      }
    } catch {
      /* fallback */
    }
  };

  const filtered = suppliers.filter((s) => {
    if (filterCommodity && s.commodity !== filterCommodity) return false;
    if (filterRisk && s.riskLevel !== filterRisk) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        (s.eori && s.eori.toLowerCase().includes(q)) ||
        (s.contactName && s.contactName.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Gestion des Fournisseurs & Producteurs
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Suivi des chaînes d’approvisionnement EUDR, collecte des données parcellaires et score de complétude.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/supplier-portal"
            className="rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-all flex items-center gap-1.5"
          >
            <span>📱</span>
            <span>Portail Fournisseur</span>
          </Link>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 transition-all"
          >
            + Nouveau Fournisseur
          </button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500">Total Fournisseurs</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{suppliers.length}</div>
          <div className="text-[10px] text-slate-400">Enregistrés dans le référentiel</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500">Complétude moyenne</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">
            {suppliers.length > 0
              ? Math.round(suppliers.reduce((acc, s) => acc + s.completenessScore, 0) / suppliers.length)
              : 0}{" "}
            %
          </div>
          <div className="text-[10px] text-slate-400">Parcelles rattachées</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500">Fournisseurs à risque élevé</div>
          <div className="mt-1 text-2xl font-bold text-rose-600">
            {suppliers.filter((s) => s.riskLevel === "HIGH" || s.riskLevel === "CRITICAL").length}
          </div>
          <div className="text-[10px] text-rose-500">Déforestation / Pays sensible</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500">Parcelles déclarées</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {suppliers.reduce((acc, s) => acc + s.plotsCount, 0)}
          </div>
          <div className="text-[10px] text-slate-400">Géolocalisées (WGS84)</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between shadow-xs">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Rechercher par nom, EORI, contact..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filterCommodity}
            onChange={(e) => setFilterCommodity(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">Toutes commodités</option>
            {COMMODITIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          <select
            value={filterRisk}
            onChange={(e) => setFilterRisk(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">Tous niveaux de risque</option>
            <option value="LOW">Risque Faible</option>
            <option value="STANDARD">Risque Standard</option>
            <option value="HIGH">Risque Élevé</option>
            <option value="CRITICAL">Critique</option>
          </select>
        </div>
      </div>

      {/* Suppliers Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
          <thead className="bg-slate-50 font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-3">Fournisseur & EORI</th>
              <th className="px-4 py-3">Pays</th>
              <th className="px-4 py-3">Matière première</th>
              <th className="px-4 py-3">Parcelles</th>
              <th className="px-4 py-3">Complétude</th>
              <th className="px-4 py-3">Risque EUDR</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Chargement des fournisseurs...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Aucun fournisseur ne correspond aux critères.
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-3.5">
                    <Link href={`/suppliers/${s.id}`} className="font-semibold text-slate-900 hover:text-emerald-700">
                      {s.name}
                    </Link>
                    <div className="text-[11px] text-slate-400 font-mono">{s.eori ?? "EORI non renseigné"}</div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-800">
                      <span>{s.country === "CI" ? "🇨🇮" : s.country === "ID" ? "🇮🇩" : s.country === "BR" ? "🇧🇷" : s.country === "CO" ? "🇨🇴" : "🌐"}</span>
                      <span>{s.country}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-medium">{COMMODITY_LABELS[s.commodity] ?? s.commodity}</td>
                  <td className="px-4 py-3.5 font-semibold text-slate-900">{s.plotsCount} parcelles</td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            s.completenessScore >= 80
                              ? "bg-emerald-500"
                              : s.completenessScore >= 50
                                ? "bg-amber-500"
                                : "bg-rose-500"
                          }`}
                          style={{ width: `${s.completenessScore}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-semibold text-slate-700">{s.completenessScore}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                        s.riskLevel === "LOW"
                          ? "bg-emerald-100 text-emerald-800"
                          : s.riskLevel === "STANDARD"
                            ? "bg-blue-100 text-blue-800"
                            : s.riskLevel === "HIGH"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {s.riskLevel === "LOW"
                        ? "FAIBLE"
                        : s.riskLevel === "STANDARD"
                          ? "STANDARD"
                          : s.riskLevel === "HIGH"
                            ? "ÉLEVÉ"
                            : "CRITIQUE"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right space-x-2">
                    <Link
                      href={`/suppliers/${s.id}`}
                      className="rounded bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
                    >
                      Détails
                    </Link>
                    <Link
                      href="/supplier-portal"
                      className="rounded bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      Relancer ➔
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal Add Supplier */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={() => setShowAddModal(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl z-10 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">Ajouter un nouveau fournisseur</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSupplier} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Raison sociale / Nom *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex : Coopérative Cacaoyère San Pedro"
                  value={newSupplier.name}
                  onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Matière première *</label>
                  <select
                    value={newSupplier.commodity}
                    onChange={(e) => setNewSupplier({ ...newSupplier, commodity: e.target.value as Commodity })}
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Pays d’origine *</label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    placeholder="CI, ID, BR, CO..."
                    value={newSupplier.country}
                    onChange={(e) => setNewSupplier({ ...newSupplier, country: e.target.value.toUpperCase() })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Numéro EORI (si export)</label>
                  <input
                    type="text"
                    placeholder="Ex : FR000000000000"
                    value={newSupplier.eori}
                    onChange={(e) => setNewSupplier({ ...newSupplier, eori: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Contact référent</label>
                  <input
                    type="text"
                    placeholder="Nom du responsable"
                    value={newSupplier.contactName}
                    onChange={(e) => setNewSupplier({ ...newSupplier, contactName: e.target.value })}
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
                  Créer le fournisseur
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
