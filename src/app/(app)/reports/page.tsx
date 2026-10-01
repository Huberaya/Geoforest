"use client";

import { Card, ErrorState, LoadingState, Metric, PageHeader } from "@/components/PageShell";
import { ApiError, getReport } from "@/lib/api";
import type { ComplianceReport } from "@/lib/eudr/types";
import { useEffect, useState } from "react";

const DOC_LABELS: Record<string, string> = {
  VALID: "Valide",
  TO_VERIFY: "À vérifier",
  EXPIRED: "Expiré",
  REJECTED: "Rejeté",
};
const DDS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon",
  MISSING_DATA: "Données manquantes",
  IN_ANALYSIS: "Analyse en cours",
  UNDER_REVIEW: "En revue",
  RISK_IDENTIFIED: "Risque identifié",
  ACTION_REQUIRED: "Action requise",
  READY_FOR_DECLARATION: "Prêt à déclarer",
  DECLARED: "Déclaré",
  ARCHIVED: "Archivé",
};

/**
 * ⚠️ P0-09 : cet écran remplace un tableau de bord affichant 91,4 % de
 * conformité et 1 248,5 ha de façon permanente. Tout ici est calculé ; ce qui
 * n'est pas calculable est rendu « — », jamais approximé.
 */
export default function ReportsPage() {
  const [data, setData] = useState<ComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await getReport());
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Impossible de calculer le rapport.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const rate =
    data && data.probativeAudits > 0
      ? `${Math.round(((data.compliantAudits ?? 0) / data.probativeAudits) * 100)} %`
      : null;

  return (
    <div>
      <PageHeader
        title="Rapports"
        subtitle="Vue d'ensemble calculée depuis la base de données de votre organisation."
      />

      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      {loading ? (
        <Card>
          <LoadingState label="Calcul…" />
        </Card>
      ) : !data ? null : (
        <>
          {data.notice && (
            <div className="mb-4 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
              {data.notice}
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Fournisseurs" value={data.counts.suppliers} />
            <Metric label="Parcelles" value={data.counts.plots} />
            <Metric label="Surface totale" value={data.counts.plots ? `${data.areaHa.toFixed(2)} ha` : null} />
            <Metric label="Documents" value={data.counts.documents} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Analyses</h2>
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Menées" value={data.counts.audits} />
                <Metric label="Probantes" value={data.probativeAudits} hint="Données réelles" />
                <Metric label="Conformes" value={data.compliantAudits} hint={data.compliantAudits === null ? "Non calculable" : undefined} />
                <Metric label="Non conformes" value={data.nonCompliantAudits} hint={data.nonCompliantAudits === null ? "Non calculable" : undefined} />
              </div>
              <div className="mt-3 rounded-lg bg-slate-50 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Taux de conformité
                </div>
                <div className={`mt-0.5 text-lg font-bold ${rate ? "text-slate-900" : "text-slate-300"}`}>
                  {rate ?? "—"}
                </div>
                <div className="mt-0.5 text-[10px] leading-snug text-slate-400">
                  {rate
                    ? "Calculé sur les seules analyses probantes."
                    : "Aucune analyse probante : le taux n'est pas calculable et n'est donc pas affiché."}
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Dossiers</h2>
              {Object.keys(data.statementsByStatus).length === 0 ? (
                <p className="text-[11px] text-slate-500">Aucun dossier enregistré.</p>
              ) : (
                <ul className="space-y-1.5">
                  {Object.entries(data.statementsByStatus).map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-600">{DDS_LABELS[k] ?? k}</span>
                      <span className="font-mono font-semibold text-slate-800">{v}</span>
                    </li>
                  ))}
                </ul>
              )}

              <h2 className="mb-3 mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">Documents</h2>
              {Object.keys(data.documentsByStatus).length === 0 ? (
                <p className="text-[11px] text-slate-500">Aucun document enregistré.</p>
              ) : (
                <ul className="space-y-1.5">
                  {Object.entries(data.documentsByStatus).map(([k, v]) => (
                    <li key={k} className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-600">{DOC_LABELS[k] ?? k}</span>
                      <span className="font-mono font-semibold text-slate-800">{v}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <p className="mt-3 text-[10px] text-slate-400">
            Rapport généré le {new Date(data.generatedAt).toLocaleString("fr-FR")}
            {data.organizationName ? ` · ${data.organizationName}` : ""}. Aucune valeur de ce rapport ne
            provient d&apos;une constante ou d&apos;un jeu de démonstration.
          </p>
        </>
      )}
    </div>
  );
}
