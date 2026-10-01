"use client";

import { Badge, Card, EmptyState, ErrorState, LoadingState, Metric, PageHeader } from "@/components/PageShell";
import RiskBadge from "@/components/RiskBadge";
import { ApiError, getAnalyses } from "@/lib/api";
import { COMMODITY_LABELS, type AnalysesResponse, type Commodity } from "@/lib/eudr/types";
import { useEffect, useState } from "react";

export default function AnalysesPage() {
  const [data, setData] = useState<AnalysesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await getAnalyses());
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Impossible de charger les analyses.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const rows = data?.analyses ?? [];

  return (
    <div>
      <PageHeader
        title="Analyses"
        subtitle="Analyses de parcelles enregistrées, avec la provenance de chaque résultat."
      />

      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      {loading ? (
        <Card>
          <LoadingState />
        </Card>
      ) : !data ? null : (
        <>
          {data.notice && (
            <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
              ⚠️ {data.notice}
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Metric label="Analyses" value={data.summary.total} />
            <Metric label="Probantes" value={data.summary.probative} hint="Données réellement mesurées" />
            <Metric
              label="Conformes"
              value={data.summary.probative > 0 ? data.summary.compliant : null}
              hint={data.summary.probative > 0 ? undefined : "Non calculable sans analyse probante"}
            />
            <Metric
              label="Non conformes"
              value={data.summary.probative > 0 ? data.summary.non_compliant : null}
              hint={data.summary.probative > 0 ? undefined : "Non calculable sans analyse probante"}
            />
            <Metric
              label="Sans résultat"
              value={data.summary.unavailable + data.summary.simulated}
              hint="Indisponible ou simulée"
            />
          </div>

          <Card>
            {rows.length === 0 ? (
              <EmptyState
                title="Aucune analyse enregistrée"
                message="Lancez une analyse depuis une parcelle géolocalisée pour obtenir un résultat. Sans clé GFW configurée sur le serveur, l'analyse sera déclarée indisponible plutôt que simulée."
                cta={{ href: "/plots", label: "Aller aux parcelles" }}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Parcelle</th>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Surface</th>
                      <th className="px-4 py-2">Source</th>
                      <th className="px-4 py-2">Résultat</th>
                      <th className="px-4 py-2">Risque</th>
                      <th className="px-4 py-2">Brouillon</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => {
                      const a = r as Record<string, unknown>;
                      return (
                        <tr key={String(a.audit_id)} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5">
                            <div className="font-mono text-slate-800">{String(a.parcel_reference ?? "—")}</div>
                            <div className="text-[10px] text-slate-400">
                              {COMMODITY_LABELS[a.commodity as Commodity] ?? String(a.commodity)} · {String(a.country_code)}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-[10px] text-slate-500">
                            {new Date(String(a.created_at)).toLocaleString("fr-FR")}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-700">
                            {Number(a.area_ha).toFixed(2)} ha
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge tone={a.analysis_probative ? "green" : "grey"}>
                              {String(a.analysis_source ?? "—")}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5">
                            {a.compliant === true ? (
                              <Badge tone="green">conforme</Badge>
                            ) : a.compliant === false ? (
                              <Badge tone="red">non conforme</Badge>
                            ) : (
                              <Badge tone="grey">{String(a.status)}</Badge>
                            )}
                            {typeof a.loss_year === "number" && (
                              <div className="mt-0.5 text-[10px] text-slate-400">perte {a.loss_year}</div>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <RiskBadge level={String(a.risk_level ?? "STANDARD")} />
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[10px] text-slate-500">
                            {a.draft_reference ? String(a.draft_reference) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
