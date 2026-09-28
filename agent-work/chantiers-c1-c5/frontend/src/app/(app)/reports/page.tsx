"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type ReportDatasetKey,
  type ReportDatasetSummary,
  type ReportOverview,
  downloadOperationalReport,
  fetchReportOverview,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  active: "Actif",
  suspended: "Suspendu",
  archived: "Archivé",
  draft: "Brouillon",
  awaiting_data: "Données attendues",
  analyzed: "Analysé",
  ready: "Prêt (ne signifie pas qu’une déclaration a été déposée)",
  rejected: "Rejeté",
  valid: "Valide techniquement",
  validating: "Validation en cours",
  invalid: "Invalide",
  to_review: "À examiner",
  reviewed: "Examiné",
  follow_up: "Suivi nécessaire",
  in_assessment: "Évaluation en cours",
  mitigation_required: "Mesures d’atténuation requises",
  human_decision_recorded: "Décision humaine enregistrée",
  preparation_incomplete: "Préparation incomplète",
  prepared_for_declaration: "Préparé pour déclaration",
  blocked: "Bloqué",
  stale: "À régénérer",
  none: "Aucune décision",
  current: "À jour",
};

const DATASET_DESCRIPTIONS: Record<ReportDatasetKey, string> = {
  suppliers: "Identité de base, pays, statut et niveau de risque; aucune coordonnée de contact.",
  products: "Commodité, code SH et statut; descriptions libres exclues.",
  shipments: "Références, produit, fournisseur, quantité et dates; notes libres exclues.",
  plots: "Références et indicateurs de validation; géométrie et coordonnées exclues.",
  documents: "Métadonnées de suivi uniquement; aucun nom de fichier, contenu ou clé de stockage.",
  ddr: "État des dossiers, décisions humaines et dernière préparation interne; aucune preuve ni géodonnée détaillée.",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status.replaceAll("_", " ");
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function DatasetCard({
  dataset,
  exporting,
  canExportPlots,
  onExport,
}: {
  dataset: ReportDatasetSummary;
  exporting: boolean;
  canExportPlots: boolean;
  onExport: (key: ReportDatasetKey) => void;
}) {
  const canExport = dataset.key !== "plots" || canExportPlots;
  const statuses = Object.entries(dataset.status_counts).sort(([a], [b]) => a.localeCompare(b));
  return (
    <article className="card flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">{dataset.label}</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{DATASET_DESCRIPTIONS[dataset.key]}</p>
        </div>
        <div className="rounded-xl bg-indigo-50 px-3 py-2 text-right">
          <div className="text-2xl font-bold text-indigo-800">{dataset.total}</div>
          <div className="text-[10px] uppercase tracking-wide text-indigo-700">enregistrement(s)</div>
        </div>
      </div>
      {statuses.length > 0 && (
        <dl className="mt-4 space-y-1 border-t border-slate-100 pt-3">
          {statuses.map(([status, count]) => (
            <div key={status} className="flex justify-between gap-3 text-xs">
              <dt className="text-slate-500">{statusLabel(status)}</dt>
              <dd className="font-medium text-slate-800">{count}</dd>
            </div>
          ))}
        </dl>
      )}
      {dataset.key === "documents" && dataset.archived !== undefined && (
        <p className="mt-2 text-xs text-slate-500">Dont {dataset.archived} archivé(s).</p>
      )}
      {dataset.key === "ddr" && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="text-xs font-semibold text-slate-700">Préparations internes : {dataset.preparations_total || 0}</div>
          {Object.entries(dataset.preparation_status_counts || {}).map(([status, count]) => (
            <div key={status} className="mt-1 flex justify-between gap-3 text-xs">
              <span className="text-slate-500">{statusLabel(status)}</span><span className="text-slate-700">{count}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-auto pt-4">
        <button
          className="btn-secondary w-full"
          disabled={exporting || !canExport}
          onClick={() => onExport(dataset.key)}
          title={!canExport ? "L’export des références de parcelles est réservé aux rôles autorisés aux géodonnées." : undefined}
        >
          {exporting ? "Préparation du CSV…" : canExport ? "Télécharger le CSV" : "Export réservé aux rôles autorisés"}
        </button>
      </div>
    </article>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [report, setReport] = useState<ReportOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ReportDatasetKey | null>(null);
  const canExportPlots = !!user && ["admin", "compliance", "procurement", "analyst"].includes(user.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchReportOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Les rapports sont indisponibles.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function exportCsv(dataset: ReportDatasetKey) {
    setExporting(dataset);
    setError(null);
    try {
      await downloadOperationalReport(dataset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de générer le CSV.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rapports opérationnels</h1>
          <p className="mt-1 text-sm text-slate-500">Synthèse tenant-scopée des données enregistrées et exports CSV minimisés.</p>
        </div>
        <button className="btn-secondary" disabled={loading} onClick={() => void load()}>↻ Actualiser</button>
      </header>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
        {report?.notice || "Les rapports sont des outils de suivi internes. Ils ne certifient pas la conformité et ne déposent aucune déclaration EUDR."}
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {loading && <div className="card py-10 text-center text-sm text-slate-500">Calcul de la synthèse…</div>}
      {!loading && report && (
        <>
          <div className="text-xs text-slate-500">Synthèse générée le {formatGeneratedAt(report.generated_at)}. Les statuts correspondent à l’état enregistré dans l’application.</div>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {report.datasets.map((dataset) => (
              <DatasetCard
                key={dataset.key}
                dataset={dataset}
                exporting={exporting === dataset.key}
                canExportPlots={canExportPlots}
                onExport={(key) => void exportCsv(key)}
              />
            ))}
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            Les CSV ne contiennent ni géométries/coordonnées précises, ni notes libres, ni coordonnées de contact, ni clés de stockage de documents. Les références de parcelles restent réservées aux rôles habilités à consulter les géodonnées.
          </p>
        </>
      )}
    </div>
  );
}
