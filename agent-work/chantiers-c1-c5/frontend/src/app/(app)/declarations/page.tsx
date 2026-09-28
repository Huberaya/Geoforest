"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import {
  type DeclarationPreparation,
  type RiskCase,
  type RiskCaseList,
  downloadDeclarationPreparation,
  listRiskCases,
} from "@/lib/api";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.rel = "noreferrer";
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function statusText(status: DeclarationPreparation["status"]) {
  if (status === "prepared_for_declaration") return "Préparé pour déclaration";
  if (status === "stale") return "À régénérer";
  return "Préparation incomplète";
}

export default function DeclarationsPage() {
  const { user } = useAuth();
  const canExport = user?.role === "admin" || user?.role === "compliance";
  const [cases, setCases] = useState<RiskCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result: RiskCaseList = await listRiskCases({ limit: 200 });
      setCases(result.items);
    } catch (err) { setError(err instanceof Error ? err.message : "Chargement impossible."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function onDownload(riskCase: RiskCase, preparation: DeclarationPreparation) {
    setBusy(preparation.id); setError(null);
    try {
      const result = await downloadDeclarationPreparation(riskCase.id, preparation.id);
      downloadBlob(result.blob, result.filename);
    } catch (err) { setError(err instanceof Error ? err.message : "Téléchargement impossible."); }
    finally { setBusy(null); }
  }

  const rows = cases.flatMap((riskCase) => riskCase.declaration_preparations.map((preparation) => ({ riskCase, preparation })));
  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Préparation et contrôle humain</div>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Déclarations</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">Registre des préremplissages internes issus des dossiers de diligence. Aucun connecteur EUDR-IS, dépôt officiel ou statut « déclaré » n'est disponible. La voie distincte de l'article 4 bis n'est pas modélisée.</p>
      </div>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Important :</strong> « Préparé pour déclaration » signifie uniquement qu'un snapshot interne a passé les contrôles de complétude du produit. Le JSON téléchargé n'est pas un format officiel de la Commission et n'a pas été soumis.
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-semibold text-slate-900">Préparations enregistrées</h2><p className="text-xs text-slate-500">Les modifications de données source invalident automatiquement les anciens snapshots.</p></div><button className="btn-secondary" onClick={() => void load()}>Actualiser</button></div>
        {loading ? <div className="p-8 text-sm text-slate-500">Chargement…</div> : rows.length === 0 ? (
          <div className="p-8 text-center"><div className="text-3xl">🇪🇺</div><p className="mt-2 font-semibold text-slate-800">Aucune préparation</p><p className="mt-1 text-sm text-slate-500">Démarrez depuis un dossier DDR et créez un préremplissage interne.</p><Link href="/dds" className="btn-primary mt-4 inline-flex">Ouvrir les dossiers DDR</Link></div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map(({ riskCase, preparation }) => (
              <article key={preparation.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{riskCase.shipment_reference} · {riskCase.product_name}</h3><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${preparation.status === "prepared_for_declaration" ? "bg-emerald-100 text-emerald-800" : preparation.status === "stale" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{statusText(preparation.status)}</span></div>
                  <div className="mt-1 text-xs text-slate-500">Dossier {riskCase.case_reference} · préparation #{preparation.sequence_number} · {new Date(preparation.created_at).toLocaleString("fr-FR")}</div>
                  <div className="mt-2 text-[11px] text-slate-500">{riskCase.supplier_name} · code {riskCase.hs_code || "à renseigner"} · statut DDR {riskCase.status.replaceAll("_", " ")}</div>
                  {preparation.stale_reason && <p className="mt-2 text-xs text-amber-800">{preparation.stale_reason}</p>}
                  {preparation.missing_fields.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">{preparation.missing_fields.map((field, index) => <li key={`${index}-${field}`}>{field}</li>)}</ul>}
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Link href={`/dds?case=${encodeURIComponent(riskCase.id)}`} className="btn-secondary">Dossier DDR</Link>
                  <button className="btn-primary" disabled={!canExport || busy === preparation.id || preparation.status === "stale"} onClick={() => void onDownload(riskCase, preparation)} title={preparation.status === "stale" ? "Régénérez la préparation avant export" : !canExport ? "Export avec géodonnées réservé à admin/conformité" : undefined}>{busy === preparation.id ? "Préparation…" : "Télécharger JSON interne"}</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      <div className="text-xs leading-relaxed text-slate-500">Le préremplissage conserve les versions de référence pays et de catalogue produit. Les géodonnées détaillées ne sont ajoutées à l'export qu'aux rôles conformité/admin autorisés; protégez le fichier comme une donnée sensible.</div>
    </div>
  );
}
