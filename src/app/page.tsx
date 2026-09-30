"use client";

import AuditHistory from "@/components/AuditHistory";
import AuditResultCard from "@/components/AuditResultCard";
import GeoUploader from "@/components/GeoUploader";
import MultiPlotMap from "@/components/MultiPlotMap";
import { ApiError, auditParcel, getAudit, listAudits } from "@/lib/api";
import type { AuditSummary, GeoJsonInput, ParcelAuditRequest, ParcelAuditResponse, Plot } from "@/lib/eudr/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const DEMO_PLOTS: Plot[] = [
  {
    id: "plot-ci-001",
    name: "PLT-008742 (Cacao Divo)",
    reference: "PLT-008742",
    supplierId: "sup-ci-001",
    supplierName: "Coopérative Cacaoyère de Divo",
    commodity: "cocoa",
    countryCode: "CI",
    geometryType: "Polygon",
    areaHa: 14.8,
    vertexCount: 5,
    centroidLon: -5.359734,
    centroidLat: 5.842734,
    status: "COMPLIANT",
    riskLevel: "LOW",
    lossYear: null,
    confidenceScore: 0.96,
    lastAuditAt: "2026-09-28T14:32:00Z",
    createdAt: "2026-09-10T10:00:00Z",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-5.361234, 5.841234],
          [-5.358234, 5.841234],
          [-5.358234, 5.844234],
          [-5.361234, 5.844234],
          [-5.361234, 5.841234],
        ],
      ],
    },
  },
  {
    id: "plot-br-002",
    name: "Fazenda Santa Maria Lote 04",
    reference: "PLT-BR-004",
    supplierId: "sup-br-002",
    supplierName: "AgroPecuária do Pará Ltda",
    commodity: "soya",
    countryCode: "BR",
    geometryType: "Polygon",
    areaHa: 142.3,
    vertexCount: 6,
    centroidLon: -52.123456,
    centroidLat: -5.123456,
    status: "NON_COMPLIANT",
    riskLevel: "CRITICAL",
    lossYear: 2022,
    confidenceScore: 0.98,
    lastAuditAt: "2026-09-27T09:15:00Z",
    createdAt: "2026-09-15T08:00:00Z",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-52.128456, -5.128456],
          [-52.118456, -5.128456],
          [-52.118456, -5.118456],
          [-52.128456, -5.118456],
          [-52.128456, -5.128456],
        ],
      ],
    },
  },
  {
    id: "plot-id-003",
    name: "Perkebunan Sawit Riau Block B",
    reference: "PLT-ID-009",
    supplierId: "sup-id-003",
    supplierName: "PT Sumatra Agro Palm",
    commodity: "palm_oil",
    countryCode: "ID",
    geometryType: "Polygon",
    areaHa: 68.0,
    vertexCount: 8,
    centroidLon: 101.451234,
    centroidLat: 0.541234,
    status: "WARNING",
    riskLevel: "STANDARD",
    lossYear: null,
    confidenceScore: 0.91,
    lastAuditAt: "2026-09-26T16:45:00Z",
    createdAt: "2026-09-18T11:00:00Z",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [101.445234, 0.535234],
          [101.457234, 0.535234],
          [101.457234, 0.547234],
          [101.445234, 0.547234],
          [101.445234, 0.535234],
        ],
      ],
    },
  },
];

export default function DashboardPage() {
  const [selectedCommodity, setSelectedCommodity] = useState<string>("ALL");
  const [pendingGeometry, setPendingGeometry] = useState<GeoJsonInput | null>(null);
  const [result, setResult] = useState<ParcelAuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<AuditSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistory(await listAudits(25));
    } catch {
      /* non-bloquant */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const handleGeometryLoaded = (geojson: GeoJsonInput | null) => {
    setPendingGeometry(geojson);
    setResult(null);
    setError(null);
  };

  const handleSubmit = async (payload: ParcelAuditRequest) => {
    setLoading(true);
    setError(null);
    try {
      const response = await auditParcel(payload);
      setResult(response);
      void refreshHistory();
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : "Le service d'audit est indisponible");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectHistory = async (summary: AuditSummary) => {
    setLoading(true);
    setError(null);
    try {
      const full = await getAudit(summary.audit_id);
      setResult(full);
      setPendingGeometry(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Audit introuvable");
    } finally {
      setLoading(false);
    }
  };

  const filteredPlots = DEMO_PLOTS.filter((p) => {
    if (selectedCommodity !== "ALL" && p.commodity !== selectedCommodity) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* 5.1 Header Mockup: "Bonjour Marie, Voici l'état actuel de votre conformité EUDR." */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight sm:text-2xl">Bonjour Marie,</h1>
          <p className="text-xs text-slate-500">Voici l'état actuel de votre conformité EUDR.</p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/due-diligence"
            className="rounded-xl bg-[#0D5B41] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#0a4833] transition"
          >
            + Nouveau Dossier DDR
          </Link>
        </div>
      </div>

      {/* 6 Macro KPI Cards (Mirroring exact values from Mockup 5.1) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <span>👥</span>
            <span>Fournisseurs</span>
          </div>
          <div className="text-2xl font-extrabold text-slate-900">248</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <span>📦</span>
            <span>Produits</span>
          </div>
          <div className="text-2xl font-extrabold text-slate-900">1 426</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <span>🗺️</span>
            <span>Parcelles</span>
          </div>
          <div className="text-2xl font-extrabold text-slate-900">8 742</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
            <span>📋</span>
            <span>Dossiers en cours</span>
          </div>
          <div className="text-2xl font-extrabold text-slate-900">186</div>
        </div>

        <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-4 shadow-2xs space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-700">
            <span>⚠️</span>
            <span>À risque</span>
          </div>
          <div className="text-2xl font-extrabold text-rose-600">23</div>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-amber-50/40 p-4 shadow-2xs space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
            <span>⏳</span>
            <span>Données manquantes</span>
          </div>
          <div className="text-2xl font-extrabold text-amber-600">47</div>
        </div>
      </div>

      {/* 5.1 Central Interactive Section (Gauge + Map + Actions) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Sub-Card: État de votre diligence raisonnée (Gauge 82%) */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-3 flex flex-col justify-between space-y-4">
          <div>
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4">
              État de votre diligence raisonnée
            </h2>

            {/* Circular Gauge 82% */}
            <div className="flex flex-col items-center justify-center my-2">
              <div className="relative flex items-center justify-center w-28 h-28">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" stroke="#F1F5F9" strokeWidth="9" fill="transparent" />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="#0D5B41"
                    strokeWidth="9"
                    strokeDasharray="251.2"
                    strokeDashoffset="45.2"
                    strokeLinecap="round"
                    fill="transparent"
                  />
                </svg>
                <div className="absolute text-center">
                  <span className="text-2xl font-black text-slate-900">82%</span>
                </div>
              </div>
            </div>

            {/* Breakdown List */}
            <div className="mt-4 space-y-2 text-xs">
              <div className="flex items-center gap-2 text-slate-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-semibold text-slate-900">1 368</span>
                <span className="text-slate-500">parcelles analysées</span>
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="font-semibold text-slate-900">43</span>
                <span className="text-slate-500">à vérifier</span>
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <span className="h-2 w-2 rounded-full bg-amber-600" />
                <span className="font-semibold text-slate-900">17</span>
                <span className="text-slate-500">avec données manquantes</span>
              </div>
              <div className="flex items-center gap-2 text-slate-700">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span className="font-semibold text-slate-900">6</span>
                <span className="text-slate-500">nécessitant action immédiate</span>
              </div>
            </div>
          </div>

          <Link
            href="/due-diligence"
            className="w-full text-center rounded-xl border border-slate-200 bg-slate-50 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Consulter les dossiers DDR →
          </Link>
        </div>

        {/* Center Sub-Card: Interactive MultiPlot Map with Pills & Floating Popup */}
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-xs lg:col-span-6 flex flex-col min-h-[460px]">
          {/* Commodity Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 px-2">
            <span className="text-xs font-bold text-slate-800">Parcelles</span>
            <div className="flex flex-wrap gap-1 text-[11px]">
              {[
                { id: "ALL", label: "Tout" },
                { id: "cocoa", label: "Cacao" },
                { id: "coffee", label: "Café" },
                { id: "soya", label: "Soja" },
                { id: "cattle", label: "Bovin" },
                { id: "palm_oil", label: "Huile de palme" },
              ].map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setSelectedCommodity(pill.id)}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                    selectedCommodity === pill.id
                      ? "bg-[#0D5B41] text-white"
                      : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          {/* Satellite Map with Live Color-Coded Polygons */}
          <div className="relative flex-1 rounded-xl overflow-hidden mt-2 min-h-[380px]">
            <MultiPlotMap plots={filteredPlots} onSelectPlot={(p) => console.log(p.id)} />

            {/* Floating Highlight Box for PLT-008742 (matching Mockup 5.1 popup) */}
            <div className="absolute bottom-4 left-4 z-[1000] rounded-xl bg-white/95 p-3.5 shadow-lg border border-slate-200 backdrop-blur-xs text-xs space-y-1.5 max-w-[220px]">
              <div className="flex items-center justify-between">
                <span className="font-extrabold text-slate-900">PLT-008742</span>
                <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[9px] font-bold text-amber-800">À vérifier</span>
              </div>
              <div className="text-[11px] text-slate-500">Côte d'Ivoire • Cacao</div>
              <div className="text-[11px] text-slate-700">
                Surface : <strong>14,8 ha</strong>
              </div>
              <div className="text-[10px] text-emerald-700 font-semibold">✓ Analyse terminée post-2020</div>
              <Link
                href="/plots/plot-ci-001"
                className="mt-1 block text-center rounded-lg bg-[#0D5B41] py-1 text-[11px] font-bold text-white shadow-2xs hover:bg-[#0a4833]"
              >
                Voir la parcelle
              </Link>
            </div>
          </div>
        </div>

        {/* Right Sub-Card: Actions rapides (Mirroring Mockup 5.1) */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-3 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Actions rapides</h2>

            <div className="space-y-2.5">
              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-rose-600 animate-pulse" />
                  <span className="font-bold text-xs text-rose-950">4 actions critiques</span>
                </div>
                <p className="text-[11px] text-rose-800">Perte forestière détectée en attente de blocage.</p>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span className="font-bold text-xs text-amber-950">17 actions à effectuer</span>
                </div>
                <p className="text-[11px] text-amber-800">Titres de propriété et permis à renouveler.</p>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="font-bold text-xs text-emerald-950">42 dossiers terminés</span>
                </div>
                <p className="text-[11px] text-emerald-800">Prêts pour déclaration douanière TRACES-NT.</p>
              </div>
            </div>
          </div>

          <Link
            href="/alerts"
            className="w-full text-center rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-slate-800"
          >
            Voir toutes les actions
          </Link>
        </div>
      </div>

      {/* Bottom Section: Instant Audit Studio & Audit Table */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-5 shadow-xs">
          <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">Audit instantané de parcelle GeoJSON/KML</h2>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">EPSG:4326</span>
          </div>
          <GeoUploader onGeometryLoaded={handleGeometryLoaded} onSubmit={handleSubmit} loading={loading} />
        </section>

        <section className="min-h-[460px] xl:col-span-7">
          <AuditResultCard result={result} error={error} loading={loading} onExported={() => void refreshHistory()} />
        </section>
      </div>

      {/* Audit History Log */}
      <AuditHistory audits={history} loading={historyLoading} selectedId={result?.audit_id ?? null} onSelect={(a) => void handleSelectHistory(a)} />
    </div>
  );
}
