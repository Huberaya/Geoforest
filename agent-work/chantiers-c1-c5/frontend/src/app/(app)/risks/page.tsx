"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import {
  type AssessmentRoute,
  type CompanySize,
  type EconomicRole,
  type RiskCase,
  type RiskCaseList,
  type RiskReferenceData,
  type Shipment,
  type ShipmentList,
  createRiskCase,
  getRiskReferences,
  listRiskCases,
  listShipments,
} from "@/lib/api";

const ROLE_LABELS: Record<EconomicRole, string> = {
  operator: "Opérateur",
  downstream_operator: "Opérateur en aval",
  trader: "Commerçant",
  producer: "Producteur / autre acteur",
  unknown: "À confirmer",
};
const SIZE_LABELS: Record<CompanySize, string> = {
  micro: "Micro",
  small: "Petite",
  medium: "Moyenne",
  large: "Grande",
  individual: "Personne physique",
  unknown: "À confirmer",
};
const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Brouillon", cls: "bg-slate-100 text-slate-700" },
  in_assessment: { label: "Évaluation en cours", cls: "bg-blue-100 text-blue-800" },
  mitigation_required: { label: "Atténuation requise", cls: "bg-amber-100 text-amber-800" },
  human_decision_recorded: { label: "Décision humaine enregistrée", cls: "bg-indigo-100 text-indigo-800" },
  preparation_incomplete: { label: "Préparation incomplète", cls: "bg-amber-100 text-amber-800" },
  prepared_for_declaration: { label: "Préparé pour déclaration", cls: "bg-emerald-100 text-emerald-800" },
  blocked: { label: "Bloqué / non négligeable", cls: "bg-red-100 text-red-800" },
};

function message(error: unknown) {
  return error instanceof Error ? error.message : "Une erreur est survenue.";
}

function riskLabel(level: string) {
  return ({ low: "Faible (benchmark pays)", standard: "Standard (benchmark pays)", high: "Élevé (benchmark pays)", unknown: "Pays à vérifier" } as Record<string, string>)[level] || level;
}

export default function RisksPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canManageCase = ["admin", "compliance", "procurement"].includes(user?.role || "");
  const [data, setData] = useState<RiskCaseList | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [references, setReferences] = useState<RiskReferenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [shipmentId, setShipmentId] = useState("");
  const [economicRole, setEconomicRole] = useState<EconomicRole>("unknown");
  const [companySize, setCompanySize] = useState<CompanySize>("unknown");
  const [roleNote, setRoleNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cases, shipmentResult, refs]: [RiskCaseList, ShipmentList, RiskReferenceData] = await Promise.all([
        listRiskCases({ limit: 200 }),
        listShipments({ limit: 200 }),
        getRiskReferences(),
      ]);
      setData(cases);
      setShipments(shipmentResult.items);
      setReferences(refs);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const existingShipmentIds = useMemo(() => new Set((data?.items || []).map((item) => item.shipment_id)), [data]);
  const availableShipments = shipments.filter((item) => !existingShipmentIds.has(item.id));
  const highOriginCount = (data?.items || []).filter((riskCase) => riskCase.origins.some((origin) => origin.benchmark_level === "high")).length;
  const unknownOriginCount = (data?.items || []).filter((riskCase) => riskCase.origins.some((origin) => origin.benchmark_level === "unknown")).length;

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shipmentId) {
      setError("Choisissez le lot à évaluer.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createRiskCase({
        shipment_id: shipmentId,
        economic_role: economicRole,
        company_size: companySize,
        role_confirmed: false,
        role_confirmation_note: roleNote.trim() || undefined,
        assessment_route: "full" as AssessmentRoute,
      });
      router.push(`/dds?case=${encodeURIComponent(created.id)}`);
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Cadrage et suivi des cas</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Risques EUDR</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Séparez le benchmark pays, les constats C5, le risque fournisseur interne et l'évaluation du lot. Aucun score automatique ne remplace l'analyse humaine.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((value) => !value)} disabled={!availableShipments.length || !canManageCase} title={!canManageCase ? "Création réservée à admin/conformité/achats" : !availableShipments.length ? "Aucun lot disponible" : undefined}>
          {showForm ? "× Annuler" : "+ Nouveau dossier"}
        </button>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
        <strong>Benchmark pays ≠ décision de diligence.</strong> Le niveau officiel 2025/1093 est un facteur de l'article 10; un pays à faible risque, une absence de signal C5 ou une certification ne prouve pas à lui seul un risque nul ou négligeable.
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {references && (
        <section className="grid gap-3 md:grid-cols-3">
          <Metric title="Dossiers suivis" value={data?.total ?? "—"} note="Un dossier par lot dans cette première version" />
          <Metric title="Origines à risque élevé" value={highOriginCount} note={`Source ${references.country_benchmark.source_celex}`} tone="rose" />
          <Metric title="Origines à vérifier" value={unknownOriginCount} note="Code pays non reconnu dans la référence chargée" tone="amber" />
        </section>
      )}

      {showForm && (
        <form onSubmit={onCreate} className="card space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Ouvrir un dossier depuis un lot</h2>
            <p className="mt-1 text-xs text-slate-500">Les parcelles existantes sont ajoutées comme origines non confirmées. Les allocations multi-origines restent à compléter manuellement.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="label">Lot *</span>
              <select className="input" value={shipmentId} onChange={(event) => setShipmentId(event.target.value)} required>
                <option value="">— Sélectionner —</option>
                {availableShipments.map((shipment) => (
                  <option key={shipment.id} value={shipment.id}>
                    {shipment.reference} · {shipment.product_name || "Produit"} · {shipment.supplier_name || "Fournisseur"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Rôle économique (à confirmer dans le dossier)</span>
              <select className="input" value={economicRole} onChange={(event) => setEconomicRole(event.target.value as EconomicRole)}>
                {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Taille de l'entreprise (à confirmer)</span>
              <select className="input" value={companySize} onChange={(event) => setCompanySize(event.target.value as CompanySize)}>
                {Object.entries(SIZE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Note de cadrage facultative</span>
              <input className="input" value={roleNote} onChange={(event) => setRoleNote(event.target.value)} maxLength={5000} placeholder="La confirmation formelle s'effectue dans le dossier DDR." />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Création…" : "Créer et ouvrir le dossier"}</button>
          </div>
        </form>
      )}

      <section className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-slate-900">Dossiers et niveaux pays</h2>
            <p className="text-xs text-slate-500">Benchmark versionné · {references?.country_benchmark.version || "chargement"}</p>
          </div>
          <Link href="/dds" className="text-xs font-semibold text-emerald-700 hover:underline">Ouvrir le module DDR →</Link>
        </div>
        {loading ? <div className="p-8 text-sm text-slate-500">Chargement des dossiers…</div> : !data?.items.length ? (
          <div className="p-8 text-center">
            <div className="text-3xl">◈</div>
            <p className="mt-2 font-semibold text-slate-800">Aucun dossier Risques/DDR</p>
            <p className="mt-1 text-sm text-slate-500">Créez un lot, puis ouvrez un dossier pour documenter ses origines et facteurs de risque.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Lot / produit</th>
                  <th className="px-4 py-3 text-left">Fournisseur</th>
                  <th className="px-4 py-3 text-left">Origines / benchmark</th>
                  <th className="px-4 py-3 text-left">Rôle / voie</th>
                  <th className="px-4 py-3 text-left">État</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((riskCase: RiskCase) => {
                  const status = STATUS[riskCase.status] || { label: riskCase.status, cls: "bg-slate-100 text-slate-700" };
                  return (
                    <tr key={riskCase.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs font-semibold text-slate-900">{riskCase.shipment_reference}</div>
                        <div className="mt-1 text-xs text-slate-600">{riskCase.product_name} · {riskCase.hs_code || "code à renseigner"}</div>
                        <div className="mt-1 text-[10px] text-slate-400">{riskCase.case_reference}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">{riskCase.supplier_name}</td>
                      <td className="px-4 py-3">
                        {riskCase.origins.length ? riskCase.origins.map((origin) => (
                          <div key={origin.id} className="mb-1 text-xs">
                            <span className="font-semibold">{origin.country_code || "Pays ?"}</span>
                            <span className="ml-1 text-slate-500">{riskLabel(origin.benchmark_level)}</span>
                            {!origin.origin_confirmed && <span className="ml-1 text-amber-700">· à confirmer</span>}
                          </div>
                        )) : <span className="text-xs text-amber-700">Aucune origine</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <div>{ROLE_LABELS[riskCase.economic_role]}</div>
                        <div className="mt-1">{riskCase.assessment_route === "article13_simplified" ? "Art. 13 · simplifiée" : "Évaluation complète"}</div>
                        <div className="mt-1">Champ produit : {riskCase.product_scope_status.replaceAll("_", " ")}</div>
                      </td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${status.cls}`}>{status.label}</span></td>
                      <td className="px-4 py-3 text-right"><Link className="text-xs font-semibold text-emerald-700 hover:underline" href={`/dds?case=${encodeURIComponent(riskCase.id)}`}>Ouvrir →</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {references && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Référence pays</div>
            <h3 className="mt-1 font-semibold text-slate-900">Règlement d'exécution (UE) 2025/1093</h3>
            <p className="mt-2 text-sm text-slate-600">{references.country_benchmark.low_risk_count} codes faible risque · {references.country_benchmark.standard_risk_count} standard · {references.country_benchmark.high_risk_count} élevé.</p>
            <a href={references.country_benchmark.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-semibold text-emerald-700 hover:underline">Ouvrir la source officielle ↗</a>
          </div>
          <div className="card">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Référence produit</div>
            <h3 className="mt-1 font-semibold text-slate-900">Annexe I · version {references.product_scope.version}</h3>
            <p className="mt-2 text-sm text-slate-600">{references.product_scope.entry_count} références de codes candidates; les positions « ex » et leurs conditions restent à vérifier par un humain.</p>
            <p className="mt-2 text-xs text-amber-800">{references.product_scope_note}</p>
            <a href={references.product_scope.amendment_source_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-semibold text-emerald-700 hover:underline">Règlement délégué 2026/2102 ↗</a>
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({ title, value, note, tone = "emerald" }: { title: string; value: string | number; note: string; tone?: "emerald" | "rose" | "amber" }) {
  const classes = tone === "rose" ? "text-rose-700 bg-rose-50" : tone === "amber" ? "text-amber-700 bg-amber-50" : "text-emerald-700 bg-emerald-50";
  return (
    <div className="card flex items-center justify-between gap-3">
      <div><div className="text-xs text-slate-500">{title}</div><div className="mt-1 text-xs text-slate-400">{note}</div></div>
      <div className={`rounded-xl px-3 py-2 text-xl font-bold ${classes}`}>{value}</div>
    </div>
  );
}
