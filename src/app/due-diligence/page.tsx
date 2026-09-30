"use client";

import {
  COMMODITY_LABELS,
  DDR_STATUS_LABELS,
  type Commodity,
  type DdrStatus,
  type DueDiligenceStatementRecord,
} from "@/lib/eudr/types";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function DueDiligencePage() {
  const [ddrs, setDdrs] = useState<DueDiligenceStatementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [commodityFilter, setCommodityFilter] = useState<string>("ALL");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [commodity, setCommodity] = useState<Commodity>("cocoa");
  const [supplierName, setSupplierName] = useState("");
  const [productName, setProductName] = useState("");
  const [netWeightKg, setNetWeightKg] = useState("25000");
  const [countryOfProduction, setCountryOfProduction] = useState("CI");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/due-diligence");
        if (res.ok) setDdrs(await res.json());
      } catch {
        /* fallback */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleCreateDdr = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      const res = await fetch("/api/v1/due-diligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          commodity,
          supplierName: supplierName || "Fournisseur Partenaire",
          productName: productName || "Produit Règlementé",
          netWeightKg: Number(netWeightKg),
          countryOfProduction,
        }),
      });

      if (res.ok) {
        const created: DueDiligenceStatementRecord = await res.json();
        setDdrs((prev) => [created, ...prev]);
        setShowCreateModal(false);
        setTitle("");
        setSupplierName("");
        setProductName("");
      }
    } catch {
      alert("Erreur lors de la création du dossier DDR.");
    } finally {
      setCreating(false);
    }
  };

  const filteredDdrs = ddrs.filter((d) => {
    if (statusFilter !== "ALL" && d.status !== statusFilter) return false;
    if (commodityFilter !== "ALL" && d.commodity !== commodityFilter) return false;
    return true;
  });

  const totalDdrs = ddrs.length;
  const readyDdrs = ddrs.filter((d) => d.status === "READY_FOR_DECLARATION").length;
  const declaredDdrs = ddrs.filter((d) => d.status === "DECLARED").length;
  const riskDdrs = ddrs.filter((d) => d.status === "RISK_IDENTIFIED" || d.status === "ACTION_REQUIRED").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dossiers de Diligence Raisonnée (DDR / DDS)</h1>
          <p className="text-xs text-slate-500">
            Constitution, validation humaine et préparation des déclarations officielles EUDR selon les articles 4 et 8.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 flex items-center justify-center gap-2"
        >
          <span>📁</span>
          <span>+ Nouveau dossier DDR</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Total Dossiers DDR</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{totalDdrs}</div>
          <div className="text-[10px] text-slate-500">Chaînes de valeur tracées</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Prêts pour Déclaration</div>
          <div className="mt-2 text-2xl font-bold text-emerald-600">{readyDdrs}</div>
          <div className="text-[10px] text-emerald-600 font-semibold">100% complétude validée ✓</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Déclarés sur TRACES-NT</div>
          <div className="mt-2 text-2xl font-bold text-sky-600">{declaredDdrs}</div>
          <div className="text-[10px] text-sky-600 font-semibold">Numéro de référence officiel</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Blocages & Risques Actifs</div>
          <div className="mt-2 text-2xl font-bold text-rose-600">{riskDdrs}</div>
          <div className="text-[10px] text-rose-600 font-semibold">Actions de mitigation requises</div>
        </div>
      </div>

      {/* Filters & Actions */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={commodityFilter}
              onChange={(e) => setCommodityFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">Toutes les commodities</option>
              {Object.entries(COMMODITY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">Tous les statuts de workflow</option>
              {Object.entries(DDR_STATUS_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table of DDRs */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">Référence & Titre</th>
                  <th className="px-4 py-3">Matière / Produit</th>
                  <th className="px-4 py-3">Fournisseur & Pays</th>
                  <th className="px-4 py-3">Volume & Parcelles</th>
                  <th className="px-4 py-3">Complétude</th>
                  <th className="px-4 py-3">Statut DDR</th>
                  <th className="px-4 py-3 text-right">Dossier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      Chargement des dossiers de diligence raisonnée...
                    </td>
                  </tr>
                ) : filteredDdrs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      Aucun dossier DDR trouvé.
                    </td>
                  </tr>
                ) : (
                  filteredDdrs.map((d) => {
                    const isDeclared = d.status === "DECLARED";
                    const isReady = d.status === "READY_FOR_DECLARATION";
                    const isRisk = d.status === "RISK_IDENTIFIED" || d.status === "ACTION_REQUIRED";

                    return (
                      <tr key={d.id} className="hover:bg-slate-50/75 transition">
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          <div>{d.title}</div>
                          <div className="text-[10px] font-mono text-slate-400 font-normal">
                            {d.reference} • {new Date(d.createdAt).toLocaleDateString("fr-FR")}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{COMMODITY_LABELS[d.commodity] || d.commodity}</div>
                          <div className="text-[10px] text-slate-500 truncate max-w-[160px]">{d.productName}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{d.supplierName || "—"}</div>
                          <div className="text-[10px] text-slate-400">Origine : {d.countryOfProduction}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono">{d.netWeightKg.toLocaleString("fr-FR")} kg</div>
                          <div className="text-[10px] text-slate-500">
                            {d.plotsCount} parcelle{d.plotsCount > 1 ? "s" : ""} ({d.totalAreaHa.toFixed(1)} ha)
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${
                                  d.completenessScore === 100
                                    ? "bg-emerald-500"
                                    : d.completenessScore > 50
                                    ? "bg-amber-500"
                                    : "bg-rose-500"
                                }`}
                                style={{ width: `${d.completenessScore}%` }}
                              />
                            </div>
                            <span className="font-bold text-[10px]">{d.completenessScore}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              isDeclared
                                ? "bg-sky-50 text-sky-700 border border-sky-200"
                                : isReady
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : isRisk
                                ? "bg-rose-50 text-rose-700 border border-rose-200"
                                : "bg-slate-100 text-slate-700 border border-slate-200"
                            }`}
                          >
                            <span>
                              {isDeclared
                                ? "🏛️ Déclaré"
                                : isReady
                                ? "✓ Prêt"
                                : isRisk
                                ? "⚠️ Risque"
                                : DDR_STATUS_LABELS[d.status] || d.status}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/due-diligence/${encodeURIComponent(d.id)}`}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                          >
                            Consulter →
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Création Dossier DDR */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">Nouveau Dossier de Diligence Raisonnée EUDR</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateDdr} className="space-y-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Titre / Référence interne du dossier</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Dossier DDR Cacao Fèves Brutes — Lot Anvers Octobre 2026"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Matière première (Annexe I)</label>
                  <select
                    value={commodity}
                    onChange={(e) => setCommodity(e.target.value as Commodity)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                  >
                    {Object.entries(COMMODITY_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pays de production (ISO-2)</label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    placeholder="CI, BR, ID, VN..."
                    value={countryOfProduction}
                    onChange={(e) => setCountryOfProduction(e.target.value.toUpperCase())}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Fournisseur</label>
                  <input
                    type="text"
                    placeholder="Nom du fournisseur"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Poids net estimé (kg)</label>
                  <input
                    type="number"
                    min="1"
                    value={netWeightKg}
                    onChange={(e) => setNetWeightKg(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600 space-y-1">
                <strong>Rappel EUDR (Art. 4) :</strong> La création d'un dossier DDR initie la collecte et la
                consolidation des preuves géographiques (polygones), des analyses de déforestation et des pièces de légalité.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
                >
                  {creating ? "Création..." : "Créer le dossier DDR"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
