"use client";

import AuditHistory from "@/components/AuditHistory";
import AuditResultCard from "@/components/AuditResultCard";
import GeoUploader from "@/components/GeoUploader";
import MapViewer, { type MapStatus } from "@/components/MapViewer";
import { ApiError, auditParcel, getAudit, listAudits } from "@/lib/api";
import type { AuditSummary, GeoJsonInput, ParcelAuditRequest, ParcelAuditResponse } from "@/lib/eudr/types";
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
      /* l'historique est non bloquant */
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
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.9}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l4 6h-3l3.5 5H13v4h-2v-4H7.5L11 9H8l4-6z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900">GeoForest Trace</h1>
              <p className="text-xs text-slate-500">Conformité EUDR — Règlement (UE) 2023/1115 · Diligence raisonnée géospatiale</p>
            </div>
          </div>
          <div className="hidden items-center gap-4 text-xs text-slate-500 sm:flex">
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium">Date butoir : 31/12/2020</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium">Polygone requis ≥ 4 ha</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium">Précision ≥ 6 décimales</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-6 px-6 py-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 xl:col-span-4">
            <h2 className="mb-4 text-sm font-semibold text-slate-900">1. Parcelle & dossier</h2>
            <GeoUploader onGeometryLoaded={handleGeometryLoaded} onSubmit={handleSubmit} loading={loading} />
          </section>

          <section className="min-h-[520px] xl:col-span-5">
            <MapViewer geometry={mapGeometry} status={mapStatus} areaHa={result?.validation.area_ha ?? null} lossYear={result?.satellite?.loss_year ?? null} />
          </section>

          <section className="min-h-[520px] xl:col-span-3">
            <AuditResultCard result={result} error={error} loading={loading} onExported={() => void refreshHistory()} />
          </section>
        </div>

        <AuditHistory audits={history} loading={historyLoading} selectedId={result?.audit_id ?? null} onSelect={(a) => void handleSelectHistory(a)} />

        <footer className="pb-6 text-center text-[11px] text-slate-400">
          Données satellite : Hansen/UMD Tree Cover Loss via Global Forest Watch · Export au format de soumission DDS TRACES-NT · Système géodésique WGS84 (EPSG:4326)
        </footer>
      </main>
    </div>
  );
}
