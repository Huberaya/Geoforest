"use client";

import type { Shipment } from "@/lib/eudr/types";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newShipment, setNewShipment] = useState({
    reference: "",
    netWeightKg: 25000,
    harvestDate: new Date().toISOString().slice(0, 10),
    customsDeclarationRef: "",
  });

  const fetchShipments = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/shipments");
      if (res.ok) {
        setShipments(await res.json());
      }
    } catch {
      /* non-bloquant */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchShipments();
  }, []);

  const handleCreateShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/v1/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newShipment),
      });
      if (res.ok) {
        setShowAddModal(false);
        setNewShipment({
          reference: "",
          netWeightKg: 25000,
          harvestDate: new Date().toISOString().slice(0, 10),
          customsDeclarationRef: "",
        });
        void fetchShipments();
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
            Lots & Expéditions (Chaîne de traçabilité EUDR)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Liaison probatoire obligatoire : Produit ➔ Fournisseur ➔ Parcelles de récolte ➔ Expédition ➔ Déclaration DDS.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 transition-all"
        >
          + Nouveau Lot / Expédition
        </button>
      </div>

      {/* Traceability Flow Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
          Chaîne d'imputabilité EUDR (Article 9 & 10)
        </h2>
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 text-center">
          <div className="flex-1 rounded-xl bg-slate-50 p-3 border border-slate-100">
            <span className="text-base">📦</span>
            <div className="font-bold text-xs text-slate-800">1. Produit / SH</div>
            <div className="text-[10px] text-slate-500">Commodity ciblée</div>
          </div>
          <span className="text-slate-300 font-bold">➔</span>
          <div className="flex-1 rounded-xl bg-slate-50 p-3 border border-slate-100">
            <span className="text-base">👥</span>
            <div className="font-bold text-xs text-slate-800">2. Fournisseur & EORI</div>
            <div className="text-[10px] text-slate-500">Identité opérateur</div>
          </div>
          <span className="text-slate-300 font-bold">➔</span>
          <div className="flex-1 rounded-xl bg-slate-50 p-3 border border-slate-100">
            <span className="text-base">🗺️</span>
            <div className="font-bold text-xs text-slate-800">3. Parcelles WGS84</div>
            <div className="text-[10px] text-slate-500">Zéro déforestation 2020</div>
          </div>
          <span className="text-slate-300 font-bold">➔</span>
          <div className="flex-1 rounded-xl bg-slate-50 p-3 border border-slate-100">
            <span className="text-base">🚚</span>
            <div className="font-bold text-xs text-slate-800">4. Expédition / Poids</div>
            <div className="text-[10px] text-slate-500">Volume & douanes</div>
          </div>
          <span className="text-slate-300 font-bold">➔</span>
          <div className="flex-1 rounded-xl bg-emerald-50 p-3 border border-emerald-200">
            <span className="text-base">🏛️</span>
            <div className="font-bold text-xs text-emerald-900">5. Dossier TRACES-NT</div>
            <div className="text-[10px] text-emerald-700 font-semibold">DDS exportable</div>
          </div>
        </div>
      </div>

      {/* Shipments Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
          <thead className="bg-slate-50 font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-3">Réf. Lot / Expédition</th>
              <th className="px-4 py-3">Fournisseur</th>
              <th className="px-4 py-3">Produit</th>
              <th className="px-4 py-3">Poids net (kg)</th>
              <th className="px-4 py-3">Date récolte</th>
              <th className="px-4 py-3">Parcelles</th>
              <th className="px-4 py-3">Statut DDR</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  Chargement des lots...
                </td>
              </tr>
            ) : shipments.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  Aucun lot enregistré.
                </td>
              </tr>
            ) : (
              shipments.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="font-bold text-slate-900 font-mono">{s.reference}</div>
                    <div className="text-[10px] text-slate-400">{s.customsDeclarationRef ?? "En douane FR"}</div>
                  </td>
                  <td className="px-4 py-3.5 font-medium">{s.supplierName}</td>
                  <td className="px-4 py-3.5 font-medium text-slate-800">{s.productName}</td>
                  <td className="px-4 py-3.5 font-semibold text-slate-900">
                    {s.netWeightKg.toLocaleString("fr-FR")} kg
                  </td>
                  <td className="px-4 py-3.5 font-mono">{s.harvestDate}</td>
                  <td className="px-4 py-3.5">
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-800">
                      {s.plotsCount ?? 1} parcelle(s)
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                        s.status === "READY"
                          ? "bg-emerald-100 text-emerald-800"
                          : s.status === "AUDITED"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {s.status === "READY"
                        ? "PRÊT POUR TRACES"
                        : s.status === "AUDITED"
                          ? "AUDITÉ (CONFORME)"
                          : "EN PRÉPARATION"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right space-x-2">
                    <Link
                      href="/due-diligence"
                      className="rounded bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      Dossier DDR ➔
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Shipment Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={() => setShowAddModal(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl z-10 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">Déclarer un lot / expédition</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateShipment} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Numéro de lot / Réf Expédition *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex : LOT-2026-CAC-1092"
                  value={newShipment.reference}
                  onChange={(e) => setNewShipment({ ...newShipment, reference: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500 font-mono uppercase"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Poids net (kg) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={newShipment.netWeightKg}
                    onChange={(e) => setNewShipment({ ...newShipment, netWeightKg: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Date de récolte *</label>
                  <input
                    type="date"
                    required
                    max={new Date().toISOString().slice(0, 10)}
                    value={newShipment.harvestDate}
                    onChange={(e) => setNewShipment({ ...newShipment, harvestDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Déclaration douanière (optionnel)</label>
                <input
                  type="text"
                  placeholder="Ex : IM4-2026-FR-10928"
                  value={newShipment.customsDeclarationRef}
                  onChange={(e) => setNewShipment({ ...newShipment, customsDeclarationRef: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500 font-mono"
                />
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
                  Enregistrer le lot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
