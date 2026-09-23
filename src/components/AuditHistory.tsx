"use client";

import { COMMODITY_LABELS, type AuditSummary, type Commodity } from "@/lib/eudr/types";

interface AuditHistoryProps {
  audits: AuditSummary[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (audit: AuditSummary) => void;
}

const STATUS_BADGE: Record<AuditSummary["status"], string> = {
  COMPLIANT: "bg-emerald-100 text-emerald-800",
  NON_COMPLIANT: "bg-red-100 text-red-800",
  INVALID_GEOMETRY: "bg-amber-100 text-amber-800",
};

const STATUS_LABEL: Record<AuditSummary["status"], string> = {
  COMPLIANT: "Conforme",
  NON_COMPLIANT: "Non conforme",
  INVALID_GEOMETRY: "Invalide",
};

export default function AuditHistory({ audits, loading, selectedId, onSelect }: AuditHistoryProps) {
  const compliant = audits.filter((a) => a.status === "COMPLIANT").length;
  const nonCompliant = audits.filter((a) => a.status === "NON_COMPLIANT").length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Historique des audits</h2>
          <p className="text-xs text-slate-500">Dossiers persistés — cliquez pour recharger une parcelle sur la carte</p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">{compliant} conforme{compliant > 1 ? "s" : ""}</span>
          <span className="rounded-full bg-red-50 px-2.5 py-1 font-semibold text-red-700">{nonCompliant} non conforme{nonCompliant > 1 ? "s" : ""}</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">{audits.length} total</span>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2.5 font-semibold">Date</th>
              <th className="px-3 py-2.5 font-semibold">Opérateur</th>
              <th className="px-3 py-2.5 font-semibold">Produit</th>
              <th className="px-3 py-2.5 font-semibold">Pays</th>
              <th className="px-3 py-2.5 text-right font-semibold">Surface</th>
              <th className="px-3 py-2.5 font-semibold">Perte</th>
              <th className="px-3 py-2.5 font-semibold">Risque</th>
              <th className="px-5 py-2.5 font-semibold">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && audits.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-6 text-center text-slate-400">Chargement…</td>
              </tr>
            )}
            {!loading && audits.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-6 text-center text-slate-400">Aucun audit pour l&apos;instant — lancez votre première analyse.</td>
              </tr>
            )}
            {audits.map((a) => (
              <tr key={a.audit_id} onClick={() => onSelect(a)} className={`cursor-pointer transition hover:bg-emerald-50/60 ${selectedId === a.audit_id ? "bg-emerald-50" : ""}`}>
                <td className="whitespace-nowrap px-5 py-2.5 text-slate-600">{new Date(a.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
                <td className="max-w-[160px] truncate px-3 py-2.5 font-medium text-slate-800">{a.operator_name}</td>
                <td className="px-3 py-2.5 text-slate-600">
                  {COMMODITY_LABELS[a.commodity as Commodity]?.split(" (")[0] ?? a.commodity} <span className="font-mono text-slate-400">{a.hs_code}</span>
                </td>
                <td className="px-3 py-2.5 font-mono text-slate-600">{a.country_code}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{a.geometry_type.includes("Point") ? "pt" : `${a.area_ha.toFixed(2)} ha`}</td>
                <td className="px-3 py-2.5 text-slate-600">{a.loss_year ?? "—"}</td>
                <td className="px-3 py-2.5 text-slate-600">{a.risk_level}</td>
                <td className="px-5 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
