"use client";

import AuditHistory from "@/components/AuditHistory";
import AuditResultCard from "@/components/AuditResultCard";
import GeoUploader from "@/components/GeoUploader";
import MapViewer, { type MapStatus } from "@/components/MapViewer";
import { ApiError, auditParcel, getAudit, listAudits } from "@/lib/api";
import type { AuditSummary, GeoJsonInput, ParcelAuditRequest, ParcelAuditResponse } from "@/lib/eudr/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export default function DashboardPage() {
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

  const mapGeometry = result ? (result.validation.normalized_geometry ?? pendingGeometry) : pendingGeometry;
  const mapStatus: MapStatus = result ? result.status : "PENDING";

  return (
    <div className="space-y-6">
      {/* Welcome & Global Compliance Header */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Règlement (UE) 2023/1115 · Diligence Raisonnée Active
            </div>
            <h1 className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">
              Cockpit de Conformité EUDR — GeoForest Agrobusiness SAS
            </h1>
            <p className="mt-1 text-xs text-slate-300 max-w-2xl leading-relaxed">
              Supervision consolidée des approvisionnements, analyse satellite de déforestation post-31/12/2020 et préparation des dossiers de déclaration TRACES-NT.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/due-diligence"
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 transition-all"
            >
              + Nouveau Dossier DDR
            </Link>
            <Link
              href="/supplier-portal"
              className="rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20 transition-all border border-white/10"
            >
              📱 Portail Fournisseur
            </Link>
          </div>
        </div>

        {/* Global Compliance Bar */}
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 sm:grid-cols-4">
          <div>
            <div className="text-[11px] font-medium text-slate-300">Indice de conformité global</div>
            <div className="text-xl font-extrabold text-emerald-400">91.4 %</div>
            <div className="text-[10px] text-slate-400">38 / 42 parcelles conformes</div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-300">Surface totale tracée</div>
            <div className="text-xl font-extrabold text-white">1 248.5 ha</div>
            <div className="text-[10px] text-slate-400">Polygones géodésiques WGS84</div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-300">Fournisseurs engagés</div>
            <div className="text-xl font-extrabold text-white">14</div>
            <div className="text-[10px] text-slate-400">Côte d'Ivoire, Indonésie, Brésil...</div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-300">Dossiers prêts TRACES</div>
            <div className="text-xl font-extrabold text-emerald-300">5 / 8</div>
            <div className="text-[10px] text-slate-400">XML/JSON générés conformes</div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Fournisseurs actifs</span>
            <span className="text-lg">👥</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">14</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-amber-700">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span>2 fournisseurs avec données incomplètes</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Parcelles auditées</span>
            <span className="text-lg">🗺️</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">42</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-rose-700 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            <span>4 alertes déforestation identifiées</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Dossiers DDR</span>
            <span className="text-lg">📋</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">8</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>5 prêts pour transmission DDS</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Alertes & Légalité</span>
            <span className="text-lg">⚠️</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">3</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-rose-700 font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
            <span>3 actions requises aujourd'hui</span>
          </div>
        </div>
      </div>

      {/* Main Interactive Studio (Map + Uploader + Audit Result) */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-4 shadow-xs">
          <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">1. Audit instantané de parcelle</h2>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">GIS & GFW</span>
          </div>
          <GeoUploader onGeometryLoaded={handleGeometryLoaded} onSubmit={handleSubmit} loading={loading} />
        </section>

        <section className="min-h-[520px] xl:col-span-5 rounded-2xl border border-slate-200 bg-white p-2 shadow-xs flex flex-col">
          <div className="px-3 py-2 flex items-center justify-between border-b border-slate-100">
            <h3 className="text-xs font-semibold text-slate-800">2. Imagerie Satellite & Polygone WGS84</h3>
            <span className="text-[10px] text-slate-500">Hansen / GFW · Esri World Imagery</span>
          </div>
          <div className="flex-1 min-h-[460px] rounded-xl overflow-hidden mt-2">
            <MapViewer geometry={mapGeometry} status={mapStatus} areaHa={result?.validation.area_ha ?? null} lossYear={result?.satellite?.loss_year ?? null} />
          </div>
        </section>

        <section className="min-h-[520px] xl:col-span-3">
          <AuditResultCard result={result} error={error} loading={loading} onExported={() => void refreshHistory()} />
        </section>
      </div>

      {/* Audit History */}
      <AuditHistory audits={history} loading={historyLoading} selectedId={result?.audit_id ?? null} onSelect={(a) => void handleSelectHistory(a)} />

      <footer className="pt-2 pb-6 text-center text-[11px] text-slate-400">
        GeoForest Trace V1 · Moteur de conformité au Règlement (UE) 2023/1115 (EUDR) · Référentiel WGS84 (EPSG:4326) · Format TRACES-NT
      </footer>
    </div>
  );
}
