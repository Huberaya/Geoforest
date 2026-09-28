"use client";

import { ApiError, exportTraces, triggerDownload } from "@/lib/api";
import { COMMODITY_LABELS, type ParcelAuditResponse, type RiskLevel, type TracesFormat } from "@/lib/eudr/types";
import { useState } from "react";

interface AuditResultCardProps {
  result: ParcelAuditResponse | null;
  error: string | null;
  loading: boolean;
  onExported?: () => void;
}

const RISK_STYLES: Record<RiskLevel, string> = {
  LOW: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  STANDARD: "bg-amber-100 text-amber-800 ring-amber-200",
  HIGH: "bg-red-100 text-red-800 ring-red-200",
};

const RISK_LABELS: Record<RiskLevel, string> = { LOW: "Faible", STANDARD: "Standard", HIGH: "Élevé" };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-slate-900">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export default function AuditResultCard({ result, error, loading, onExported }: AuditResultCardProps) {
  const [exporting, setExporting] = useState<TracesFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [netWeight, setNetWeight] = useState("");
  const [exportedRef, setExportedRef] = useState<string | null>(null);

  const handleExport = async (format: TracesFormat) => {
    if (!result) return;
    setExporting(format);
    setExportError(null);
    try {
      const file = await exportTraces({
        audit_id: result.audit_id,
        format,
        activity_type: "IMPORT",
        net_weight_kg: netWeight.trim() === "" ? null : Number(netWeight.replace(",", ".")),
        country_of_activity: "FR",
      });
      triggerDownload(file);
      setExportedRef(file.filename);
      onExported?.();
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "Export impossible");
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-100 border-t-emerald-600" />
        <p className="text-sm font-medium text-slate-700">Analyse en cours</p>
        <p className="text-xs text-slate-500">Topologie Shapely · surface géodésique · Hansen Tree Cover Loss</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col justify-center rounded-2xl border border-red-200 bg-red-50 p-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-red-600">Requête rejetée</div>
        <p className="mt-2 text-sm text-red-800">{error}</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="mt-3 text-sm font-semibold text-slate-700">Bilan d&apos;audit</p>
        <p className="mt-1 text-xs text-slate-500">Le badge de conformité, la surface calculée et l&apos;export TRACES-NT apparaîtront ici.</p>
      </div>
    );
  }

  const { status, validation, satellite } = result;
  const badge =
    status === "COMPLIANT"
      ? { text: "CONFORME EUDR", cls: "bg-emerald-600 text-white", icon: "✓" }
      : status === "NON_COMPLIANT"
        ? { text: "NON CONFORME", cls: "bg-red-600 text-white", icon: "✕" }
        : { text: "GÉOMÉTRIE INVALIDE", cls: "bg-amber-500 text-white", icon: "!" };

  const exportable = status !== "INVALID_GEOMETRY";

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Bilan d&apos;audit instantané</div>
          <div className="mt-1 font-mono text-[11px] text-slate-400">#{result.audit_id.slice(0, 8)} · {new Date(result.created_at).toLocaleString("fr-FR")}</div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold tracking-wide ${badge.cls}`}>
          <span>{badge.icon}</span>
          {badge.text}
        </span>
      </div>

      <p className={`rounded-xl px-3 py-2.5 text-sm leading-snug ${status === "COMPLIANT" ? "bg-emerald-50 text-emerald-900" : status === "NON_COMPLIANT" ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-900"}`}>
        {result.summary}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Surface calculée" value={validation.geometry_type?.includes("Point") ? "Point GPS" : `${validation.area_ha.toFixed(2)} ha`} sub={validation.eudr_geometry_rule === "POLYGON_REQUIRED" ? "≥ 4 ha : polygone obligatoire" : "< 4 ha : point ou polygone"} />
        <Stat label="Géométrie" value={validation.geometry_type ?? "—"} sub={`${validation.vertex_count} sommet${validation.vertex_count > 1 ? "s" : ""} · ${validation.min_decimals_found ?? "?"} décimales`} />
        <Stat label="Matière première" value={`SH ${result.hs_code}`} sub={COMMODITY_LABELS[result.commodity]} />
        <Stat label="Date de récolte" value={new Date(result.harvest_date).toLocaleDateString("fr-FR")} sub={`Butoir : ${new Date(result.eudr_cutoff_date).toLocaleDateString("fr-FR")}`} />
      </div>

      {satellite && (
        <div className="space-y-2 rounded-xl border border-slate-100 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Analyse satellite</span>
            <span className="font-mono text-[10px] text-slate-400">{satellite.source}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${RISK_STYLES[satellite.country_risk]}`}>
              Risque pays : {RISK_LABELS[satellite.country_risk]} ({satellite.country_code})
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${RISK_STYLES[satellite.risk_level]}`}>
              Risque parcelle : {RISK_LABELS[satellite.risk_level]}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
              Confiance {Math.round(satellite.confidence_score * 100)} %
            </span>
            {satellite.loss_year && (
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${satellite.loss_year > 2020 ? "bg-red-100 text-red-800 ring-red-200" : "bg-slate-100 text-slate-700 ring-slate-200"}`}>
                Perte de couvert : {satellite.loss_year}
                {satellite.loss_area_ha > 0 ? ` · ${satellite.loss_area_ha} ha` : ""}
              </span>
            )}
          </div>
          <p className="text-xs leading-relaxed text-slate-600">{satellite.details}</p>
        </div>
      )}

      {(validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="space-y-1.5">
          {validation.errors.map((e, i) => (
            <div key={`e-${i}`} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <span className="font-mono font-semibold">{e.code}</span> — {e.message}
            </div>
          ))}
          {validation.warnings.map((w, i) => (
            <div key={`w-${i}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span className="font-mono font-semibold">{w.code}</span> — {w.message}
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto space-y-2 border-t border-slate-100 pt-4">
        <div className="flex items-center gap-2">
          <label htmlFor="netWeight" className="text-xs font-medium text-slate-600">
            Poids net (kg)
          </label>
          <input id="netWeight" type="number" min="0" step="0.001" value={netWeight} onChange={(e) => setNetWeight(e.target.value)} placeholder="optionnel" className="w-32 rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-emerald-500" disabled={!exportable} />
        </div>
        <button
          type="button"
          disabled={!exportable || exporting !== null}
          onClick={() => void handleExport("xml")}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-sm transition ${
            exportable ? (status === "COMPLIANT" ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-red-700 text-white hover:bg-red-800") : "cursor-not-allowed bg-slate-200 text-slate-400"
          }`}
        >
          {exporting === "xml" ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
          Télécharger le dossier TRACES-NT (XML)
        </button>
        <button type="button" disabled={!exportable || exporting !== null} onClick={() => void handleExport("json")} className="w-full rounded-lg py-1.5 text-xs font-medium text-slate-500 hover:text-emerald-700 disabled:cursor-not-allowed disabled:text-slate-300">
          {exporting === "json" ? "Génération…" : "Version JSON du DDS"}
        </button>
        {status === "NON_COMPLIANT" && <p className="text-[11px] leading-snug text-red-700">Le DDS sera marqué <span className="font-mono">VERIFIED_NON_COMPLIANT</span> : la mise sur le marché de l&apos;UE est interdite (art. 3 EUDR).</p>}
        {!exportable && <p className="text-[11px] text-slate-500">Corrigez la géométrie puis relancez l&apos;audit pour débloquer l&apos;export.</p>}
        {exportedRef && <p className="text-[11px] text-emerald-700">Téléchargé : <span className="font-mono">{exportedRef}</span></p>}
        {exportError && <p className="text-[11px] text-red-700">{exportError}</p>}
      </div>
    </div>
  );
}
