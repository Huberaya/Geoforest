"use client";

import AuditHistory from "@/components/AuditHistory";
import AuditResultCard from "@/components/AuditResultCard";
import GeoUploader from "@/components/GeoUploader";
import MapViewer, { type MapStatus } from "@/components/MapViewer";
import { ApiError, auditParcel, getAudit, getDashboardSummary, listAudits } from "@/lib/api";
import type { AuditSummary, DashboardSummary, GeoJsonInput, ParcelAuditRequest, ParcelAuditResponse } from "@/lib/eudr/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/** Indicateur non calculable : affiché tel quel, jamais remplacé par une estimation. */
const NON_CALCULABLE = "—";

const nombre = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const entier = new Intl.NumberFormat("fr-FR");

function ha(value: number | null): string {
  return value === null ? NON_CALCULABLE : `${nombre.format(value)} ha`;
}
function pct(value: number | null): string {
  return value === null ? NON_CALCULABLE : `${value} %`;
}
function n(value: number | null): string {
  return value === null ? NON_CALCULABLE : entier.format(value);
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "brouillon",
  IN_ANALYSIS: "en analyse",
  UNDER_REVIEW: "en revue",
  READY: "prêt",
  DECLARED: "déclaré",
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: "création",
  UPDATE: "modification",
  DELETE: "suppression",
  AUDIT: "audit",
  EXPORT: "export",
  TRANSMIT: "transmission",
  VALIDATE: "validation",
  LOGIN_SUCCESS: "connexion",
};

export default function DashboardPage() {
  const [pendingGeometry, setPendingGeometry] = useState<GeoJsonInput | null>(null);
  const [result, setResult] = useState<ParcelAuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<AuditSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

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

  const refreshSummary = useCallback(async () => {
    try {
      setSummary(await getDashboardSummary());
      setSummaryError(null);
    } catch (err) {
      setSummary(null);
      setSummaryError(
        err instanceof ApiError
          ? `Synthèse indisponible (HTTP ${err.status}) : les indicateurs ne sont pas affichés.`
          : "Synthèse indisponible : les indicateurs ne sont pas affichés.",
      );
    }
  }, []);

  useEffect(() => {
    // Différé d'un micro-tâche : l'effet ne déclenche pas de rendu en cascade.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void refreshHistory();
      void refreshSummary();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshHistory, refreshSummary]);

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
      void refreshSummary();
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : "Le service d'audit est indisponible");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectHistory = async (summaryItem: AuditSummary) => {
    setLoading(true);
    setError(null);
    try {
      const full = await getAudit(summaryItem.audit_id);
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

  const s = summary?.stats ?? null;
  const urgentOverdue = (summary?.urgentActions ?? []).filter((a) => a.overdue).length;

  return (
    <div className="space-y-6">
      {/* En-tête — aucune valeur n'est écrite ici : tout vient de /api/v1/dashboard/summary */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
              Règlement (UE) 2023/1115 · Date butoir 31/12/2020
            </div>
            <h1 className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">
              Cockpit de conformité EUDR — {summary?.organizationName ?? "organisation"}
            </h1>
            <p className="mt-1 text-xs text-slate-300 max-w-2xl leading-relaxed">
              Supervision des approvisionnements, analyse satellite de déforestation postérieure au 31/12/2020 et
              préparation des dossiers de diligence raisonnée.
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

        {summaryError ? (
          <p className="mt-4 rounded-xl border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
            {summaryError}
          </p>
        ) : null}

        {/* Barre de synthèse — valeurs calculées ou « — » */}
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-4 sm:grid-cols-4">
          <div>
            <div className="text-[11px] font-medium text-slate-300">Indice de conformité</div>
            <div className="text-xl font-extrabold text-emerald-400">{pct(summary?.complianceScore ?? null)}</div>
            <div className="text-[10px] text-slate-400">
              {summary && summary.complianceScore !== null
                ? `${entier.format(summary.complianceScoreBasis.compliant)} / ${entier.format(summary.complianceScoreBasis.decidedAnalyses)} analyses probantes concluantes`
                : "aucune analyse concluante"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-300">Surface totale tracée</div>
            <div className="text-xl font-extrabold text-white">{ha(s?.plots.totalAreaHa ?? null)}</div>
            <div className="text-[10px] text-slate-400">
              {s && s.plots.total > 0 ? `sur ${entier.format(s.plots.total)} parcelle(s)` : "aucune parcelle"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-300">Fournisseurs</div>
            <div className="text-xl font-extrabold text-white">{n(s?.suppliers.total ?? null)}</div>
            <div className="text-[10px] text-slate-400">
              {s && s.suppliers.completeness !== null
                ? `complétude moyenne ${s.suppliers.completeness} %`
                : "complétude non calculable"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-300">Dossiers de diligence</div>
            <div className="text-xl font-extrabold text-emerald-300">{n(s?.dds.total ?? null)}</div>
            <div className="text-[10px] text-slate-400">
              {s
                ? `${entier.format(s.dds.ready)} prêt(s) · ${entier.format(s.dds.declared)} transmis`
                : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Ce qui n'est pas calculable est dit explicitement */}
      {summary && summary.notices.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Indicateurs non calculables — pourquoi
          </p>
          <ul className="mt-2 space-y-1">
            {summary.notices.map((notice) => (
              <li key={notice} className="text-xs text-slate-600">
                • {notice}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Cartes d'indicateurs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Fournisseurs actifs</span>
            <span className="text-lg">👥</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{n(s?.suppliers.active ?? null)}</div>
          <div className="mt-1 text-xs text-slate-600">
            {s && s.suppliers.total > 0 ? (
              <span>
                {s.suppliers.atRisk > 0
                  ? `${entier.format(s.suppliers.atRisk)} à risque élevé ou critique`
                  : "aucun à risque élevé"}
                {s.suppliers.withoutCountry > 0
                  ? ` · ${entier.format(s.suppliers.withoutCountry)} pays non renseigné`
                  : ""}
              </span>
            ) : (
              <span className="text-slate-400">aucun fournisseur enregistré</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Parcelles</span>
            <span className="text-lg">🗺️</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{n(s?.plots.total ?? null)}</div>
          <div className="mt-1 text-xs text-slate-600">
            {s && s.plots.total > 0 ? (
              <span>
                {entier.format(s.plots.compliant)} conforme(s) · {entier.format(s.plots.nonCompliant)} non
                conforme(s) · {entier.format(s.plots.pending)} à analyser
              </span>
            ) : (
              <span className="text-slate-400">aucune parcelle enregistrée</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Dossiers DDR</span>
            <span className="text-lg">📋</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{n(s?.dds.total ?? null)}</div>
          <div className="mt-1 text-xs text-slate-600">
            {s && s.dds.total > 0 ? (
              <span>
                {Object.entries(s.dds.byStatus)
                  .map(([status, count]) => `${entier.format(count)} ${STATUS_LABELS[status] ?? status}`)
                  .join(" · ")}
              </span>
            ) : (
              <span className="text-slate-400">aucun dossier</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Alertes & actions</span>
            <span className="text-lg">⚠️</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{n(s?.alerts.total ?? null)}</div>
          <div className="mt-1 text-xs text-slate-600">
            {s && s.alerts.total > 0 ? (
              <span>
                {entier.format(s.alerts.critical)} critique(s) · {entier.format(s.alerts.high)} haute(s) ·{" "}
                {entier.format(s.alerts.medium)} moyenne(s)
              </span>
            ) : (
              <span className="text-slate-400">aucune alerte calculée</span>
            )}
            {urgentOverdue > 0 ? (
              <div className="mt-0.5 font-medium text-rose-700">{entier.format(urgentOverdue)} action(s) en retard</div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Actions en attente — issues des tâches réellement enregistrées */}
      {summary && summary.urgentActions.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900">Actions de conformité en cours</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {summary.urgentActions.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 py-2.5">
                <div>
                  <Link href={a.href} className="text-xs font-semibold text-slate-800 hover:text-emerald-700">
                    {a.title}
                  </Link>
                  {a.description ? <p className="mt-0.5 text-[11px] text-slate-500">{a.description}</p> : null}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    a.overdue ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {a.dueDate ? (a.overdue ? `échu le ${a.dueDate}` : `échéance ${a.dueDate}`) : "sans échéance"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Activité récente — issue du journal d'audit, jamais reconstituée */}
      {summary && summary.recentActivities.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900">Activité récente</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {summary.recentActivities.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-4 py-2 text-xs">
                <span className="text-slate-700">
                  <span className="font-semibold">{a.actor}</span> — {ACTION_LABELS[a.action] ?? a.action} ·{" "}
                  {a.entityType}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">
                  {new Date(a.timestamp).toLocaleString("fr-FR")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
        GeoForest Trace · Moteur de conformité au Règlement (UE) 2023/1115 (EUDR) · Référentiel WGS84 (EPSG:4326) ·
        Indicateurs calculés depuis la base de données
      </footer>
    </div>
  );
}
