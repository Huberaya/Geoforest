"use client";

import { Badge, Card, EmptyState, ErrorState, LoadingState, Metric, PageHeader } from "@/components/PageShell";
import RiskBadge from "@/components/RiskBadge";
import { ApiError, getDeclarations } from "@/lib/api";
import { COMMODITY_LABELS, DDS_STATUS_LABELS, type DeclarationsResponse } from "@/lib/eudr/types";
import { useEffect, useState } from "react";

/**
 * ⚠️ P0-06 — cet écran s'appelait « Déclarations TRACES » et laissait croire à
 * un dépôt effectif. Il présente désormais l'état réel : rien n'est transmis,
 * et rien ne peut l'être depuis ce produit.
 */
export default function DeclarationsPage() {
  const [data, setData] = useState<DeclarationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await getDeclarations());
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Impossible de charger les déclarations.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <PageHeader
        title="Déclarations"
        subtitle="Dossiers parvenus au stade du dépôt — et état réel de leur transmission."
      />

      <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
        <div className="mb-1 text-sm font-bold text-amber-900">
          ⚠️ Aucune déclaration n&apos;est transmise depuis ce produit
        </div>
        <p className="text-xs leading-relaxed text-amber-900">
          {data?.transmission_capability.reason ??
            "Aucun client du système d'information EUDR n'est implémenté."}{" "}
          Le dépôt d&apos;une déclaration de diligence raisonnée est une étape distincte, réalisée par
          l&apos;opérateur sur le portail EUDR. Cet écran ne fait que rassembler les dossiers prêts.
        </p>
      </div>

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
            <Metric label="Dossiers" value={data.declarations.length} />
            <Metric label="Prêts à déclarer" value={data.ready.length} />
            <Metric label="Transmis" value={0} hint="Aucun : capacité absente" />
            <Metric label="Accusés reçus" value={0} hint="Aucun : capacité absente" />
          </div>

          <Card>
            {data.declarations.length === 0 ? (
              <EmptyState
                title="Aucun dossier"
                message="Les dossiers de diligence raisonnée apparaissent ici au fil de leur cycle de vie. Créez-en un depuis l'écran « Diligence raisonnée »."
                cta={{ href: "/due-diligence", label: "Aller aux dossiers" }}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Dossier</th>
                      <th className="px-4 py-2">Matière</th>
                      <th className="px-4 py-2">Avancement</th>
                      <th className="px-4 py-2">Risque</th>
                      <th className="px-4 py-2">Transmission</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.declarations.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-800">{d.title}</div>
                          <div className="font-mono text-[10px] text-slate-400">{d.reference}</div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{COMMODITY_LABELS[d.commodity] ?? d.commodity}</td>
                        <td className="px-4 py-2.5">
                          <Badge tone={d.status === "READY_FOR_DECLARATION" ? "green" : "grey"}>
                            {DDS_STATUS_LABELS[d.status] ?? d.status}
                          </Badge>
                          <div className="mt-0.5 text-[10px] text-slate-400">{d.completenessScore} % de complétude</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <RiskBadge level={d.riskLevel} />
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone="amber">NON TRANSMIS</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">{data.notice}</p>
        </>
      )}
    </div>
  );
}
