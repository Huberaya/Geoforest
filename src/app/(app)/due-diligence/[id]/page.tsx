"use client";

import { Badge, Card, ErrorState, LoadingState, Metric, PageHeader } from "@/components/PageShell";
import RiskBadge from "@/components/RiskBadge";
import { ApiError, getStatement, patchStatement } from "@/lib/api";
import {
  COMMODITY_LABELS,
  DDS_STATUS_LABELS,
  type DdsDetail,
  type DdsStatus,
} from "@/lib/eudr/types";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function DdsDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [dds, setDds] = useState<DdsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      setDds(await getStatement(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Dossier introuvable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      const { id } = await params;
      await load(id);
    })();
  }, [params]);

  const transition = async (next: DdsStatus) => {
    if (!dds) return;
    setBusy(true);
    setError(null);
    try {
      await patchStatement(dds.id, { status: next });
      await load(dds.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Transition impossible.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error || !dds) {
    return (
      <div>
        <PageHeader title="Dossier de diligence raisonnée" />
        <ErrorState message={error ?? "Dossier introuvable."} />
        <div className="mt-4">
          <Link href="/due-diligence" className="text-xs font-semibold text-emerald-700 hover:text-emerald-900">
            ← Retour aux dossiers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={dds.title}
        subtitle={`${dds.reference} · ${COMMODITY_LABELS[dds.commodity] ?? dds.commodity}`}
        actions={
          <Link href="/due-diligence" className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            ← Dossiers
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Statut" value={DDS_STATUS_LABELS[dds.status] ?? dds.status} />
        <Metric label="Complétude" value={`${dds.completenessScore} %`} />
        <Metric label="Parcelles" value={dds.plotsCount} />
        <Metric label="Poids net" value={dds.netWeightKg ? `${dds.netWeightKg} kg` : null} hint={dds.netWeightKg ? undefined : "Non renseigné"} />
      </div>

      <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
        ⚠️ {dds.transmission_notice}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Cycle de vie</h2>
          <p className="mb-3 text-[11px] text-slate-500">
            Statut actuel : <span className="font-semibold text-slate-800">{DDS_STATUS_LABELS[dds.status] ?? dds.status}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {dds.allowed_transitions.length === 0 ? (
              <p className="text-[11px] text-slate-500">Aucune transition disponible depuis ce statut.</p>
            ) : (
              dds.allowed_transitions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => void transition(s)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Passer à « {DDS_STATUS_LABELS[s] ?? s} »
                </button>
              ))
            )}
          </div>
          <p className="mt-3 text-[10px] leading-snug text-slate-400">
            Le statut « Déclaré » ne figure jamais parmi les transitions : il suppose un accusé du
            système d&apos;information EUDR, que ce produit ne peut pas obtenir (P0-06).
          </p>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Informations</h2>
          <dl className="space-y-2 text-[11px]">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Fournisseur</dt>
              <dd className="text-slate-800">{dds.supplierName ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Produit</dt>
              <dd className="text-slate-800">{dds.productName ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Niveau de risque</dt>
              <dd>
                <RiskBadge level={dds.riskLevel} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Surface totale</dt>
              <dd className="font-mono text-slate-800">{dds.totalAreaHa.toFixed(2)} ha</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Créé le</dt>
              <dd className="text-slate-800">{new Date(dds.createdAt).toLocaleString("fr-FR")}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="mt-4">
        <Card className="p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Actions du dossier</h2>
          {dds.tasks.length === 0 ? (
            <p className="text-[11px] text-slate-500">
              Aucune action enregistrée pour ce dossier. Créez-en une depuis l&apos;écran Risques si un
              risque a été identifié.
            </p>
          ) : (
            <ul className="space-y-2">
              {dds.tasks.map((t) => (
                <li key={t.id} className="rounded-lg border border-slate-200 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-800">{t.title}</span>
                    <Badge tone={t.severity === "CRITICAL" ? "red" : t.severity === "HIGH" ? "amber" : "grey"}>
                      {t.status}
                    </Badge>
                  </div>
                  {t.description && <p className="mt-1 text-[10px] text-slate-500">{t.description}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
