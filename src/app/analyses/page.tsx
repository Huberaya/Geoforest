"use client";

import { COMMODITY_LABELS, type Commodity, type SatelliteAnalysis, type SatelliteSource } from "@/lib/eudr/types";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function AnalysesPage() {
  const [analyses, setAnalyses] = useState<SatelliteAnalysis[]>([]);
  const [sources, setSources] = useState<SatelliteSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCommodity, setFilterCommodity] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [showNewModal, setShowNewModal] = useState(false);

  // Form State
  const [plotName, setPlotName] = useState("");
  const [commodity, setCommodity] = useState<Commodity>("cocoa");
  const [bufferMeters, setBufferMeters] = useState(50);
  const [canopyThreshold, setCanopyThreshold] = useState(30);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [resAna, resSrc] = await Promise.all([
          fetch("/api/v1/analyses"),
          fetch("/api/v1/analyses/sources"),
        ]);
        if (resAna.ok) setAnalyses(await resAna.json());
        if (resSrc.ok) setSources(await resSrc.json());
      } catch {
        /* fallback */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleLaunchAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true);

    try {
      const geojson = {
        type: "Polygon",
        coordinates: [
          [
            [-5.359734, 5.842734],
            [-5.356734, 5.842734],
            [-5.356734, 5.845734],
            [-5.359734, 5.845734],
            [-5.359734, 5.842734],
          ],
        ],
      };

      const res = await fetch("/api/v1/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plot_name: plotName || "Nouvelle analyse",
          commodity,
          buffer_meters: bufferMeters,
          canopy_threshold: canopyThreshold,
          geojson,
        }),
      });

      if (res.ok) {
        const created: SatelliteAnalysis = await res.json();
        setAnalyses((prev) => [created, ...prev]);
        setShowNewModal(false);
        setPlotName("");
      }
    } catch {
      alert("Erreur lors du lancement de l'analyse.");
    } finally {
      setRunning(false);
    }
  };

  const filteredAnalyses = analyses.filter((a) => {
    if (filterCommodity !== "ALL" && a.commodity !== filterCommodity) return false;
    if (filterStatus !== "ALL" && a.status !== filterStatus) return false;
    return true;
  });

  const totalRuns = analyses.length;
  const compliantRuns = analyses.filter((a) => a.compliant).length;
  const criticalRuns = analyses.filter((a) => a.status === "NON_COMPLIANT").length;
  const warningRuns = analyses.filter((a) => a.status === "WARNING").length;

  return (
    <div className="space-y-6 font-sans">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Analyses Satellites & Détection Déforestation</h1>
          <p className="text-xs text-slate-500">
            Croisement multi-capteurs haute précision (GFW Hansen 30m, Copernicus Sentinel-2 MSI 10m, ESA WorldCover) pour l'audit EUDR post-2020.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="rounded-xl bg-[#0D5B41] px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[#0a4833] flex items-center justify-center gap-2"
        >
          <span>🛰️</span>
          <span>Lancer un audit satellite</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-1">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Total Audits Satellites</div>
          <div className="text-2xl font-extrabold text-slate-900">{totalRuns}</div>
          <div className="text-[10px] text-slate-500">Analyses multi-spectrales</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-1">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Conformes Zéro-Déforestation</div>
          <div className="text-2xl font-extrabold text-emerald-600">{compliantRuns}</div>
          <div className="text-[10px] text-emerald-600 font-semibold">Post-31/12/2020 validé ✓</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-1">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Alertes Buffer (50m-100m)</div>
          <div className="text-2xl font-extrabold text-amber-600">{warningRuns}</div>
          <div className="text-[10px] text-amber-600 font-semibold">Vigilance lisière</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-1">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Pertes Avérées (Rejet EUDR)</div>
          <div className="text-2xl font-extrabold text-rose-600">{criticalRuns}</div>
          <div className="text-[10px] text-rose-600 font-semibold">Non-conformité bloquante</div>
        </div>
      </div>

      {/* Visual Analytics Section (Inspired by Palmoil.io and EOS Data Analytics Screenshots) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left: Donut Chart & Risk Insights */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-4 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Répartition du Couvert Végétal</span>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-800">Landscape 2026</span>
            </div>

            {/* Donut Simulation */}
            <div className="flex items-center justify-center my-3">
              <div className="relative flex items-center justify-center w-32 h-32">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="38" stroke="#F1F5F9" strokeWidth="12" fill="transparent" />
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    stroke="#10b981"
                    strokeWidth="12"
                    strokeDasharray="238.7"
                    strokeDashoffset="12"
                    fill="transparent"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="38"
                    stroke="#ef4444"
                    strokeWidth="12"
                    strokeDasharray="238.7"
                    strokeDashoffset="226"
                    fill="transparent"
                  />
                </svg>
                <div className="absolute text-center">
                  <span className="text-xl font-black text-slate-900">95.4%</span>
                  <span className="block text-[9px] text-slate-400">Zéro-déforestation</span>
                </div>
              </div>
            </div>

            {/* Legend breakdown */}
            <div className="space-y-1.5 text-[11px] text-slate-600">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Forêt conservée (post-2020)
                </span>
                <span className="font-bold text-slate-900">95.40%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-700" /> Plantations établies avant 2016
                </span>
                <span className="font-bold text-slate-900">3.80%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-500" /> Perte forestière post-2020
                </span>
                <span className="font-bold text-rose-600">0.80%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Monthly Alerts & Tree Cover Loss Histogram */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-8 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Historique des Alertes Déforestation 2021-2026 (Sentinel-2 / Hansen)
              </span>
              <span className="text-[10px] text-slate-500">Surface cumulée impactée (ha)</span>
            </div>

            {/* Simulated Bar Chart */}
            <div className="pt-2">
              <div className="h-36 flex items-end gap-2.5 px-2 border-b border-slate-100">
                {[
                  { year: "2018", ha: 12, preCutoff: true },
                  { year: "2019", ha: 18, preCutoff: true },
                  { year: "2020", ha: 14, preCutoff: true },
                  { year: "2021", ha: 3, postCutoff: true },
                  { year: "2022", ha: 8, postCutoff: true },
                  { year: "2023", ha: 2, postCutoff: true },
                  { year: "2024", ha: 1, postCutoff: true },
                  { year: "2025", ha: 0, postCutoff: true },
                  { year: "2026", ha: 0, postCutoff: true },
                ].map((b) => (
                  <div key={b.year} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                    <span className="text-[9px] font-mono text-slate-400 opacity-0 group-hover:opacity-100 transition">
                      {b.ha} ha
                    </span>
                    <div
                      className={`w-full rounded-t-md transition-all duration-300 ${
                        b.preCutoff ? "bg-slate-300" : b.ha > 0 ? "bg-rose-500" : "bg-emerald-400"
                      }`}
                      style={{ height: `${Math.max(b.ha * 5.5, 6)}%` }}
                    />
                    <span className="text-[10px] font-semibold text-slate-600">{b.year}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 px-2">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-slate-300" /> Historique pré-2020 (Ligne de base)
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-rose-500" /> Perte post-cutoff (31/12/2020)
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-emerald-400" /> Zéro perte détectée
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Satellite Connectors Status Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">État des Connecteurs Satellites</h2>
          <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Tous les connecteurs opérationnels
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {sources.map((src) => (
            <div key={src.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900">{src.name}</span>
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                  {src.resolution}
                </span>
              </div>
              <div className="text-[11px] text-slate-500">{src.provider}</div>
              <div className="text-[10px] text-slate-400 pt-1 line-clamp-2">{src.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters & Table */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterCommodity}
              onChange={(e) => setFilterCommodity(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs focus:border-[#0D5B41] focus:outline-none"
            >
              <option value="ALL">Toutes les commodities</option>
              {Object.entries(COMMODITY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs focus:border-[#0D5B41] focus:outline-none"
            >
              <option value="ALL">Tous les statuts</option>
              <option value="COMPLIANT">Conforme (Zéro Déforestation)</option>
              <option value="WARNING">Vigilance (Buffer / Dégradation)</option>
              <option value="NON_COMPLIANT">Non Conforme (Perte post-2020)</option>
            </select>
          </div>
        </div>

        {/* Table of Analyses */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">Parcelle / Référence</th>
                  <th className="px-4 py-3">Commodity</th>
                  <th className="px-4 py-3">Pays</th>
                  <th className="px-4 py-3">Surface (ha)</th>
                  <th className="px-4 py-3">Hansen (30m)</th>
                  <th className="px-4 py-3">Sentinel-2 NDVI</th>
                  <th className="px-4 py-3">Statut EUDR</th>
                  <th className="px-4 py-3 text-right">Dossier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      Chargement des analyses satellites...
                    </td>
                  </tr>
                ) : filteredAnalyses.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      Aucune analyse trouvée pour ces filtres.
                    </td>
                  </tr>
                ) : (
                  filteredAnalyses.map((a) => {
                    const isOk = a.status === "COMPLIANT";
                    const isWarn = a.status === "WARNING";

                    return (
                      <tr key={a.analysis_id} className="hover:bg-slate-50/75 transition">
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          <div>{a.plot_name}</div>
                          <div className="text-[10px] font-mono text-slate-400">{a.analysis_id}</div>
                        </td>
                        <td className="px-4 py-3">{COMMODITY_LABELS[a.commodity] || a.commodity}</td>
                        <td className="px-4 py-3">
                          <span className="font-semibold">{a.country_name}</span>{" "}
                          <span className="text-[10px] text-slate-400">({a.country_code})</span>
                        </td>
                        <td className="px-4 py-3 font-mono">{a.area_ha.toFixed(2)} ha</td>
                        <td className="px-4 py-3">
                          {a.layers.hansen.loss_detected_post_2020 ? (
                            <span className="font-semibold text-rose-600">
                              Perte en {a.layers.hansen.loss_year} ({a.layers.hansen.loss_area_ha} ha)
                            </span>
                          ) : (
                            <span className="text-emerald-700">0 alerte post-2020</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono text-[11px]">
                            NDVI {a.layers.sentinel2.current_ndvi}{" "}
                            <span
                              className={`text-[10px] ${
                                a.layers.sentinel2.delta_ndvi < -0.1 ? "text-rose-600 font-bold" : "text-slate-400"
                              }`}
                            >
                              (Δ {a.layers.sentinel2.delta_ndvi})
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              isOk
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : isWarn
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-rose-50 text-rose-700 border border-rose-200"
                            }`}
                          >
                            <span>{isOk ? "✓ Conforme" : isWarn ? "⚠️ Vigilance" : "✕ Déforestation"}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/analyses/${encodeURIComponent(a.analysis_id)}`}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                          >
                            Détails & Preuves →
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

      {/* Modal Lancement Analyse */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">Lancer un Audit Satellite Multi-Capteurs</h3>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleLaunchAnalysis} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nom / Référence de la parcelle</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Parcelle Cacao Divo Ouest #03"
                  value={plotName}
                  onChange={(e) => setPlotName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-[#0D5B41] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Matière première EUDR</label>
                  <select
                    value={commodity}
                    onChange={(e) => setCommodity(e.target.value as Commodity)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-[#0D5B41] focus:outline-none"
                  >
                    {Object.entries(COMMODITY_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Zone Tampon (Buffer)</label>
                  <select
                    value={bufferMeters}
                    onChange={(e) => setBufferMeters(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-[#0D5B41] focus:outline-none"
                  >
                    <option value={50}>50 mètres (Standard)</option>
                    <option value={100}>100 mètres (Vigilance)</option>
                    <option value={200}>200 mètres (Haute sensibilité)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Seuil de densité canopée GFW : <span className="font-bold text-slate-900">{canopyThreshold}%</span>
                </label>
                <input
                  type="range"
                  min="10"
                  max="75"
                  step="5"
                  value={canopyThreshold}
                  onChange={(e) => setCanopyThreshold(Number(e.target.value))}
                  className="w-full accent-[#0D5B41]"
                />
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>10% (forêt claire)</span>
                  <span>30% (standard UE)</span>
                  <span>75% (forêt dense)</span>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 text-[11px] text-slate-600 space-y-1">
                <div className="font-semibold text-slate-800">Capteurs interrogés simultanément :</div>
                <div className="flex gap-2 text-[10px] text-slate-500">
                  <span className="rounded bg-white px-2 py-0.5 border border-slate-200">GFW Hansen 30m</span>
                  <span className="rounded bg-white px-2 py-0.5 border border-slate-200">Sentinel-2 MSI 10m</span>
                  <span className="rounded bg-white px-2 py-0.5 border border-slate-200">ESA WorldCover 10m</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={running}
                  className="rounded-xl bg-[#0D5B41] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0a4833] disabled:opacity-50"
                >
                  {running ? "Calcul géospatial..." : "Lancer l'audit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
