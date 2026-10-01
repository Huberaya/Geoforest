"use client";

import { Badge, Card, ErrorState, LoadingState, Metric, PageHeader } from "@/components/PageShell";
import RiskBadge from "@/components/RiskBadge";
import { ApiError, getPlot } from "@/lib/api";
import { COMMODITY_LABELS, type PlotDetail } from "@/lib/eudr/types";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function PlotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [plot, setPlot] = useState<PlotDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { id } = await params;
      try {
        setPlot(await getPlot(id));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Parcelle introuvable.");
      } finally {
        setLoading(false);
      }
    })();
  }, [params]);

  if (loading) return <LoadingState />;
  if (error || !plot) {
    return (
      <div>
        <PageHeader title="Parcelle" />
        <ErrorState message={error ?? "Parcelle introuvable."} />
        <div className="mt-4">
          <Link href="/plots" className="text-xs font-semibold text-emerald-700 hover:text-emerald-900">
            ← Retour aux parcelles
          </Link>
        </div>
      </div>
    );
  }

  const overFourHa = plot.areaHa > 4 && plot.geometryType === "Point";

  return (
    <div>
      <PageHeader
        title={plot.name}
        subtitle={`${plot.reference ?? "sans référence"} · ${COMMODITY_LABELS[plot.commodity] ?? plot.commodity} · ${plot.countryCode}`}
        actions={
          <Link href="/plots" className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            ← Parcelles
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Surface calculée" value={`${plot.areaHa.toFixed(4)} ha`} />
        <Metric label="Type de géométrie" value={plot.geometryType} />
        <Metric label="Sommets" value={plot.vertexCount} />
        <Metric
          label="Année de perte"
          value={plot.lossYear ?? null}
          hint={plot.lossYear === null ? "Aucune analyse probante" : undefined}
        />
      </div>

      {overFourHa && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          ⚠️ Parcelle de {plot.areaHa.toFixed(2)} ha déclarée par un simple point. Au-delà de 4 ha,
          l&apos;article 9(1)(d) du règlement 2023/1115 exige un polygone géolocalisé.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Géométrie</h2>
          <p className="mb-2 text-[11px] text-slate-500">
            Centroïde : <span className="font-mono">{plot.centroidLat.toFixed(6)}, {plot.centroidLon.toFixed(6)}</span>
          </p>
          <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[10px] leading-relaxed text-slate-100">
            {JSON.stringify(plot.geometry, null, 2)}
          </pre>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Analyses rattachées</h2>
          {plot.audits.length === 0 ? (
            <p className="text-xs leading-relaxed text-slate-500">
              {plot.audits_linked_by === "aucune_référence"
                ? "Cette parcelle n'a pas de référence : les audits ne peuvent donc pas lui être rattachés. Renseignez une référence puis relancez une analyse."
                : "Aucun audit enregistré pour cette référence de parcelle."}
            </p>
          ) : (
            <ul className="space-y-2">
              {plot.audits.map((a) => (
                <li key={a.id} className="rounded-lg border border-slate-200 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/analyses`} className="font-mono text-[11px] text-slate-700 hover:text-emerald-700">
                      {a.id.slice(0, 8)}
                    </Link>
                    <Badge tone={a.analysisProbative ? (a.compliant ? "green" : "red") : "grey"}>
                      {a.analysisProbative ? (a.compliant ? "conforme" : "non conforme") : "non probant"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">
                    {new Date(a.createdAt).toLocaleString("fr-FR")} · {a.analysisSource ?? "source inconnue"}
                    {a.lossYear ? ` · perte ${a.lossYear}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card className="p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Statut</h2>
          <div className="flex flex-wrap items-center gap-2">
            <RiskBadge level={plot.riskLevel} />
            <Badge tone={plot.status === "NON_COMPLIANT" ? "red" : plot.status === "COMPLIANT" ? "green" : "grey"}>
              {plot.status}
            </Badge>
            <span className="text-[11px] text-slate-500">
              {plot.lastAuditAt
                ? `Dernier audit : ${new Date(plot.lastAuditAt).toLocaleString("fr-FR")}`
                : "Aucun audit mené sur cette parcelle."}
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}
