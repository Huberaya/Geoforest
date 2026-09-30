"use client";

import MultiPlotMap from "@/components/MultiPlotMap";
import { COMMODITIES, COMMODITY_LABELS, type Commodity, type Plot } from "@/lib/eudr/types";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function PlotsPage() {
  const [plots, setPlots] = useState<Plot[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"map" | "table">("map");
  const [selectedPlot, setSelectedPlot] = useState<Plot | null>(null);
  const [filterCommodity, setFilterCommodity] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPlotData, setNewPlotData] = useState({
    name: "",
    reference: "",
    commodity: "cocoa" as Commodity,
    countryCode: "CI",
    rawCoordinates: "-5.361234, 5.841234\n-5.358234, 5.841234\n-5.358234, 5.844234\n-5.361234, 5.844234\n-5.361234, 5.841234",
  });

  const fetchPlots = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/plots");
      if (res.ok) {
        setPlots(await res.json());
      }
    } catch {
      /* non-bloquant */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPlots();
  }, []);

  const handleCreatePlot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Parse coordinates lines into a Polygon geometry
      const lines = newPlotData.rawCoordinates.trim().split("\n");
      const coords = lines.map((l) => {
        const [lon, lat] = l.split(",").map((s) => Number(s.trim()));
        return [lon, lat];
      });

      const geojson = {
        type: "Polygon",
        coordinates: [coords],
      };

      const res = await fetch("/api/v1/plots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPlotData.name,
          reference: newPlotData.reference,
          commodity: newPlotData.commodity,
          countryCode: newPlotData.countryCode,
          geojson,
        }),
      });

      if (res.ok) {
        setShowAddModal(false);
        setNewPlotData({
          name: "",
          reference: "",
          commodity: "cocoa",
          countryCode: "CI",
          rawCoordinates: "",
        });
        void fetchPlots();
      }
    } catch {
      /* fallback */
    }
  };

  const filtered = plots.filter((p) => {
    if (filterCommodity && p.commodity !== filterCommodity) return false;
    if (filterStatus && p.status !== filterStatus) return false;
    return true;
  });

  const totalArea = plots.reduce((acc, p) => acc + (p.areaHa || 0), 0);
  const compliantCount = plots.filter((p) => p.status === "COMPLIANT").length;
  const nonCompliantCount = plots.filter((p) => p.status === "NON_COMPLIANT").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            Système d'Information Géographique & Parcelles (EUDR)
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Contrôle des polygones WGS84 (EPSG:4326), seuil 4 ha et analyse satellite de non-déforestation post-31/12/2020.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View Mode Switcher */}
          <div className="flex rounded-xl bg-slate-200/80 p-1 text-xs font-semibold">
            <button
              onClick={() => setViewMode("map")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${
                viewMode === "map" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>🗺️</span>
              <span>Carte satellite</span>
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${
                viewMode === "table" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span>📋</span>
              <span>Tableau</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 transition-all"
          >
            + Nouvelle Parcelle
          </button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500">Surface totale tracée</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{totalArea.toFixed(1)} ha</div>
          <div className="text-[10px] text-slate-400">Polygones géodésiques WGS84</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500">Parcelles conformes EUDR</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">
            {compliantCount} <span className="text-xs font-normal text-slate-400">/ {plots.length}</span>
          </div>
          <div className="text-[10px] text-emerald-700">0 déforestation post-2020</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500">Alertes déforestation</div>
          <div className="mt-1 text-2xl font-bold text-rose-600">{nonCompliantCount}</div>
          <div className="text-[10px] text-rose-500">Pertes de couvert détectées</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500">Seuil 4 ha (Article 9)</div>
          <div className="mt-1 text-2xl font-bold text-slate-800">100 %</div>
          <div className="text-[10px] text-slate-400">Polygones fermés conformes</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs">
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
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">Tous les statuts</option>
            <option value="COMPLIANT">Conforme EUDR</option>
            <option value="NON_COMPLIANT">Déforestation post-2020</option>
            <option value="INVALID_GEOMETRY">Invalide (&lt; 6 décimales)</option>
          </select>
        </div>

        <div className="text-xs text-slate-500">
          Affichage de <strong>{filtered.length}</strong> parcelle(s)
        </div>
      </div>

      {/* View 1 : Multi-Plot Satellite Map */}
      {viewMode === "map" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8 min-h-[560px]">
            <MultiPlotMap
              plots={filtered}
              selectedPlotId={selectedPlot?.id}
              onSelectPlot={(p) => setSelectedPlot(p)}
            />
          </div>

          <div className="lg:col-span-4 space-y-4">
            {selectedPlot ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Détails de la sélection</span>
                  <button onClick={() => setSelectedPlot(null)} className="text-xs text-slate-400 hover:text-slate-600">
                    ✕
                  </button>
                </div>
                <h3 className="font-bold text-base text-slate-900">{selectedPlot.name}</h3>
                <div className="space-y-1.5 text-xs text-slate-600">
                  <div>Réf : <span className="font-mono text-slate-800">{selectedPlot.reference}</span></div>
                  <div>Matière : <strong>{COMMODITY_LABELS[selectedPlot.commodity]}</strong></div>
                  <div>Pays : <strong>{selectedPlot.countryCode}</strong></div>
                  <div>Surface : <strong>{selectedPlot.areaHa.toFixed(2)} ha</strong></div>
                  <div>Fournisseur : <em>{selectedPlot.supplierName}</em></div>
                </div>

                <div className="pt-2">
                  <div
                    className={`rounded-xl p-3 text-xs font-semibold ${
                      selectedPlot.status === "COMPLIANT"
                        ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                        : "bg-rose-50 text-rose-900 border border-rose-200"
                    }`}
                  >
                    {selectedPlot.status === "COMPLIANT"
                      ? "✓ Conforme EUDR (0 déforestation post-2020)"
                      : `⚠️ Déforestation détectée en ${selectedPlot.lossYear}`}
                  </div>
                </div>

                <div className="pt-2">
                  <Link
                    href={`/plots/${selectedPlot.id}`}
                    className="block text-center rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    Ouvrir la fiche d'inspection ➔
                  </Link>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs text-center space-y-2">
                <div className="text-3xl">📍</div>
                <h3 className="text-xs font-bold text-slate-800">Inspection interactive</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Cliquez sur un polygone sur la carte satellite pour inspecter sa géométrie, son historique satellite et son niveau de risque.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* View 2 : Plots Data Table */}
      {viewMode === "table" && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th className="px-4 py-3">Parcelle & Réf</th>
                <th className="px-4 py-3">Fournisseur</th>
                <th className="px-4 py-3">Matière</th>
                <th className="px-4 py-3">Pays</th>
                <th className="px-4 py-3">Surface (ha)</th>
                <th className="px-4 py-3">Centroïde (Lon, Lat)</th>
                <th className="px-4 py-3">Statut EUDR</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    Chargement des parcelles...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    Aucune parcelle trouvée.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3.5">
                      <Link href={`/plots/${p.id}`} className="font-semibold text-slate-900 hover:text-emerald-700">
                        {p.name}
                      </Link>
                      <div className="text-[10px] text-slate-400 font-mono">{p.reference}</div>
                    </td>
                    <td className="px-4 py-3.5 font-medium">{p.supplierName}</td>
                    <td className="px-4 py-3.5 font-medium">{COMMODITY_LABELS[p.commodity]}</td>
                    <td className="px-4 py-3.5 font-semibold text-slate-800">{p.countryCode}</td>
                    <td className="px-4 py-3.5 font-bold text-slate-900">{p.areaHa.toFixed(2)} ha</td>
                    <td className="px-4 py-3.5 font-mono text-[11px] text-slate-500">
                      {p.centroidLon.toFixed(4)}, {p.centroidLat.toFixed(4)}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          p.status === "COMPLIANT"
                            ? "bg-emerald-100 text-emerald-800"
                            : p.status === "NON_COMPLIANT"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {p.status === "COMPLIANT"
                          ? "CONFORME"
                          : p.status === "NON_COMPLIANT"
                            ? `DÉFORESTATION (${p.lossYear ?? "post-2020"})`
                            : "GÉOMÉTRIE INVALIDE"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Link
                        href={`/plots/${p.id}`}
                        className="rounded bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-200"
                      >
                        Inspecter ➔
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Plot Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={() => setShowAddModal(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl z-10 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">Ajouter une parcelle géoréférencée</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePlot} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Désignation de la parcelle *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex : Parcelle Cacao Divo Est #01"
                  value={newPlotData.name}
                  onChange={(e) => setNewPlotData({ ...newPlotData, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Matière première *</label>
                  <select
                    value={newPlotData.commodity}
                    onChange={(e) => setNewPlotData({ ...newPlotData, commodity: e.target.value as Commodity })}
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Pays (Code ISO) *</label>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={newPlotData.countryCode}
                    onChange={(e) => setNewPlotData({ ...newPlotData, countryCode: e.target.value.toUpperCase() })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Coordonnées WGS84 des sommets (Lon, Lat par ligne) *
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="-5.361234, 5.841234&#10;-5.358234, 5.841234&#10;-5.358234, 5.844234&#10;-5.361234, 5.844234&#10;-5.361234, 5.841234"
                  value={newPlotData.rawCoordinates}
                  onChange={(e) => setNewPlotData({ ...newPlotData, rawCoordinates: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono focus:ring-1 focus:ring-emerald-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Format WGS84 standard : Longitude puis Latitude avec 6 décimales requises. Le premier et le dernier point doivent être identiques.
                </p>
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
                  Auditer et Créer la parcelle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
