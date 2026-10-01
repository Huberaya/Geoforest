"use client";

import { Badge, Card, EmptyState, ErrorState, LoadingState, Metric, PageHeader } from "@/components/PageShell";
import { ApiError, getAlerts } from "@/lib/api";
import type { AlertsResponse } from "@/lib/eudr/types";
import Link from "next/link";
import { useEffect, useState } from "react";

const KIND_LABELS: Record<string, string> = {
  DEFORESTATION: "Déforestation",
  DOCUMENT_EXPIRY: "Document",
  MISSING_DATA: "Donnée manquante",
  TASK_OVERDUE: "Action en retard",
};
const TONES: Record<string, string> = {
  CRITICAL: "red",
  HIGH: "amber",
  MEDIUM: "blue",
  LOW: "grey",
};

/**
 * ⚠️ P0-09 : le tableau de bord annonçait « 2 alertes critiques » de façon
 * permanente. Ces alertes sont ici **calculées** depuis les données réelles du
 * tenant ; un tenant sans donnée en affiche zéro, ce qui est exact.
 */
export default function AlertsPage() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await getAlerts());
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Impossible de charger les alertes.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <PageHeader
        title="Alertes"
        subtitle="Alertes calculées à partir des données réelles de votre organisation."
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
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Alertes" value={data.counts.total} />
            <Metric label="Critiques" value={data.counts.critical} />
            <Metric label="Élevées" value={data.counts.high} />
            <Metric label="Moyennes" value={data.counts.medium} />
          </div>

          <Card>
            {data.alerts.length === 0 ? (
              <EmptyState
                title="Aucune alerte"
                message="Aucun document échu ou à échéance proche, aucune analyse probante concluant à une déforestation, aucune action en retard, aucun fournisseur sans parcelle. Cet état est calculé : il reflète réellement le contenu de votre base."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.alerts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={TONES[a.severity] ?? "grey"}>{a.severity}</Badge>
                        <Badge tone="grey">{KIND_LABELS[a.kind] ?? a.kind}</Badge>
                        <span className="text-xs font-semibold text-slate-800">{a.title}</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{a.description}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {a.dueDate && <span className="font-mono text-[10px] text-slate-500">{a.dueDate}</span>}
                      <Link
                        href={a.href}
                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        Ouvrir
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
            Sources : {data.derived_from.join(" · ")}. Les analyses non probantes ne génèrent jamais
            d&apos;alerte de déforestation : une absence de résultat n&apos;est pas un résultat.
          </p>
        </>
      )}
    </div>
  );
}
