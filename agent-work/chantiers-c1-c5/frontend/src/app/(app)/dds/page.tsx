"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import {
  ApiError,
  type DeclarationPreparation,
  type DocumentPublic,
  type FindingStatus,
  type MitigationStatus,
  type Plot,
  type RiskCase,
  type RiskCaseList,
  type RiskReferenceData,
  type RiskEvidence,
  type RiskEvidencePayload,
  type RiskFinding,
  type RiskMitigationAction,
  addRiskEvidence,
  addRiskMitigation,
  addRiskOrigin,
  downloadDeclarationPreparation,
  listDocuments,
  listPlots,
  listRiskCases,
  getRiskReferences,
  prepareDeclaration,
  recordRiskDecision,
  reviewRiskEvidence,
  updateRiskCase,
  updateRiskFinding,
  updateRiskMitigation,
  updateRiskOrigin,
} from "@/lib/api";

const FINDING_STATUSES: Array<{ value: FindingStatus; label: string }> = [
  { value: "not_assessed", label: "À évaluer" },
  { value: "not_relevant", label: "Non pertinent (justifier)" },
  { value: "no_concern_identified", label: "Aucun signal identifié" },
  { value: "concern_identified", label: "Signal identifié" },
  { value: "inconclusive", label: "Inconclusif" },
];
const ROLE_LABELS: Record<string, string> = {
  operator: "Opérateur", downstream_operator: "Opérateur en aval", trader: "Commerçant", producer: "Producteur / autre", unknown: "À confirmer",
};
const REVIEW_LABEL: Record<string, string> = { to_review: "À examiner", reviewed: "Revu par conformité", follow_up: "À suivre" };

function errorText(error: unknown) {
  if (error instanceof ApiError) {
    const detail = error.info.detail;
    return typeof detail === "string" ? detail : JSON.stringify(detail);
  }
  return error instanceof Error ? error.message : "Une erreur est survenue.";
}
function internalDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.rel = "noreferrer";
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function DdsPage() {
  const { user } = useAuth();
  const privileged = user?.role === "admin" || user?.role === "compliance";
  const canManageCase = ["admin", "compliance", "procurement"].includes(user?.role || "");
  const canWrite = ["admin", "compliance", "procurement", "analyst"].includes(user?.role || "");
  const [cases, setCases] = useState<RiskCase[]>([]);
  const [activeId, setActiveId] = useState("");
  const [plots, setPlots] = useState<Plot[]>([]);
  const [documents, setDocuments] = useState<DocumentPublic[]>([]);
  const [references, setReferences] = useState<RiskReferenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [originEditor, setOriginEditor] = useState<string | null>(null);
  const [findingDrafts, setFindingDrafts] = useState<Record<string, { status: FindingStatus; rationale: string; sourceNote: string }>>({});
  const [evidenceForm, setEvidenceForm] = useState<RiskEvidencePayload>({ evidence_type: "deforestation_free", title: "", summary: "" });
  const [mitigationDraft, setMitigationDraft] = useState({ title: "", description: "", finding_id: "" });
  const [decisionOutcome, setDecisionOutcome] = useState<"no_or_negligible" | "non_negligible">("no_or_negligible");
  const [decisionRationale, setDecisionRationale] = useState("");
  const [conditions, setConditions] = useState("");
  const [roleDraft, setRoleDraft] = useState({ economic_role: "unknown", company_size: "unknown", role_confirmed: false, role_confirmation_note: "", product_scope_status: "unknown", product_scope_note: "", assessment_route: "full", article13_complexity_assessed: false, article13_mixing_assessed: false, article13_assessment_note: "" });

  const activeCase = cases.find((item) => item.id === activeId) || null;
  const casePlots = useMemo(() => activeCase ? plots.filter((plot) => plot.shipment_id === activeCase.shipment_id) : [], [plots, activeCase]);
  const cleanDocVersions = useMemo(() => documents.filter((doc) => !doc.is_archived && doc.latest_version?.scan_status === "clean"), [documents]);
  const productScopeCandidates = useMemo(() => {
    if (!activeCase || !references) return [];
    const code = (activeCase.hs_code || "").replace(/\D/g, "");
    if (!code) return [];
    return references.product_scope_entries.filter((entry) => entry.commodity === activeCase.commodity &&
      (entry.code === code || code.startsWith(entry.code) || entry.code.startsWith(code)));
  }, [activeCase, references]);

  const load = useCallback(async (requestedId?: string) => {
    setLoading(true); setError(null);
    try {
      const [caseResult, plotResult, documentResult, referenceResult]: [RiskCaseList, Awaited<ReturnType<typeof listPlots>>, Awaited<ReturnType<typeof listDocuments>>, RiskReferenceData] = await Promise.all([
        listRiskCases({ limit: 200 }), listPlots({ limit: 500 }), listDocuments({ limit: 200 }), getRiskReferences(),
      ]);
      setCases(caseResult.items);
      setPlots(plotResult.items);
      setDocuments(documentResult.items);
      setReferences(referenceResult);
      const queryId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("case") || "" : "";
      const nextId = requestedId || queryId || caseResult.items[0]?.id || "";
      setActiveId(caseResult.items.some((item) => item.id === nextId) ? nextId : (caseResult.items[0]?.id || ""));
    } catch (err) { setError(errorText(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!activeCase) return;
    setRoleDraft({
      economic_role: activeCase.economic_role,
      company_size: activeCase.company_size,
      role_confirmed: activeCase.role_confirmed,
      role_confirmation_note: activeCase.role_confirmation_note || "",
      product_scope_status: activeCase.product_scope_status,
      product_scope_note: activeCase.product_scope_note || "",
      assessment_route: activeCase.assessment_route,
      article13_complexity_assessed: activeCase.article13_complexity_assessed,
      article13_mixing_assessed: activeCase.article13_mixing_assessed,
      article13_assessment_note: activeCase.article13_assessment_note || "",
    });
    setFindingDrafts(Object.fromEntries(activeCase.findings.map((finding) => [finding.criterion, {
      status: finding.assessment_status, rationale: finding.rationale || "", sourceNote: finding.source_note || "",
    }])));
  }, [activeCase]);

  function chooseCase(caseId: string) {
    setActiveId(caseId);
    if (caseId) window.history.replaceState(null, "", `/dds?case=${encodeURIComponent(caseId)}`);
    else window.history.replaceState(null, "", "/dds");
    setOriginEditor(null); setError(null); setNotice(null);
  }

  async function applyCase(updated: RiskCase, message?: string) {
    setCases((current) => current.map((item) => item.id === updated.id ? updated : item));
    setActiveId(updated.id);
    setNotice(message || "Modifications enregistrées et journalisées.");
  }

  async function saveRoleAndScope(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activeCase) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const updated = await updateRiskCase(activeCase.id, {
        economic_role: roleDraft.economic_role as RiskCase["economic_role"],
        company_size: roleDraft.company_size as RiskCase["company_size"],
        role_confirmed: roleDraft.role_confirmed,
        role_confirmation_note: roleDraft.role_confirmation_note || null,
        product_scope_status: roleDraft.product_scope_status as RiskCase["product_scope_status"],
        product_scope_note: roleDraft.product_scope_note || null,
        assessment_route: roleDraft.assessment_route as RiskCase["assessment_route"],
        article13_complexity_assessed: roleDraft.article13_complexity_assessed,
        article13_mixing_assessed: roleDraft.article13_mixing_assessed,
        article13_assessment_note: roleDraft.article13_assessment_note || null,
      });
      await applyCase(updated, "Rôle, périmètre et voie d'évaluation enregistrés. Toute décision précédente est invalidée si les données ont changé.");
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  async function saveOrigin(event: FormEvent<HTMLFormElement>, originId: string) {
    event.preventDefault(); if (!activeCase) return;
    const form = new FormData(event.currentTarget);
    const confirmed = form.get("origin_confirmed") === "on";
    setSaving(true); setError(null); setNotice(null);
    try {
      const updated = await updateRiskOrigin(activeCase.id, originId, {
        country_code: String(form.get("country_code") || "").toUpperCase() || null,
        subdivision: String(form.get("subdivision") || "") || null,
        plot_id: String(form.get("plot_id") || "") || null,
        location_description: String(form.get("location_description") || "") || null,
        production_period_start: String(form.get("period_start") || "") || null,
        production_period_end: String(form.get("period_end") || "") || null,
        quantity: String(form.get("quantity") || "") ? Number(form.get("quantity")) : null,
        unit: String(form.get("unit") || "") || null,
        origin_confirmed: confirmed,
        notes: String(form.get("notes") || "") || null,
      });
      setOriginEditor(null);
      await applyCase(updated, "Origine mise à jour; la décision et les préremplissages antérieurs sont marqués à revoir.");
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  async function addOrigin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activeCase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true); setError(null); setNotice(null);
    try {
      const updated = await addRiskOrigin(activeCase.id, {
        source_label: String(form.get("source_label") || "") || null,
        supplier_id: activeCase.supplier_id,
        country_code: String(form.get("country_code") || "").toUpperCase() || null,
        subdivision: String(form.get("subdivision") || "") || null,
        location_description: String(form.get("location_description") || "") || null,
        production_period_start: String(form.get("period_start") || "") || null,
        production_period_end: String(form.get("period_end") || "") || null,
        quantity: String(form.get("quantity") || "") ? Number(form.get("quantity")) : null,
        unit: String(form.get("unit") || "") || null,
        notes: String(form.get("notes") || "") || null,
      });
      formElement.reset();
      await applyCase(updated, "Origine ajoutée comme source distincte. Confirmez-la après vérification.");
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  async function addEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activeCase) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const updated = await addRiskEvidence(activeCase.id, evidenceForm);
      setEvidenceForm({ evidence_type: "deforestation_free", title: "", summary: "" });
      await applyCase(updated, "Source ajoutée; elle n'est pas encore revue.");
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  async function reviewEvidence(evidence: RiskEvidence, status: "reviewed" | "follow_up") {
    if (!activeCase) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const updated = await reviewRiskEvidence(activeCase.id, evidence.id, { review_status: status });
      await applyCase(updated, status === "reviewed" ? "Revue de la preuve enregistrée." : "Preuve marquée à suivre.");
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  async function saveFinding(finding: RiskFinding) {
    if (!activeCase) return;
    const draft = findingDrafts[finding.criterion];
    if (!draft) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const updated = await updateRiskFinding(activeCase.id, finding.criterion, {
        assessment_status: draft.status,
        rationale: draft.rationale || null,
        source_note: draft.sourceNote || null,
      });
      await applyCase(updated, `Constat « ${finding.criterion} » enregistré; aucun score global n'a été calculé.`);
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  async function submitMitigation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activeCase) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const updated = await addRiskMitigation(activeCase.id, {
        title: mitigationDraft.title, description: mitigationDraft.description,
        finding_id: mitigationDraft.finding_id || null,
      });
      setMitigationDraft({ title: "", description: "", finding_id: "" });
      await applyCase(updated, "Mesure d'atténuation créée.");
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  async function markMitigationComplete(action: RiskMitigationAction, effectiveness: string) {
    if (!activeCase) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const updated = await updateRiskMitigation(activeCase.id, action.id, {
        status: "completed" as MitigationStatus,
        effectiveness_assessed: true,
        effectiveness_note: effectiveness,
      });
      await applyCase(updated, "Mesure clôturée et efficacité documentée.");
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  async function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activeCase) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const updated = await recordRiskDecision(activeCase.id, {
        outcome: decisionOutcome, rationale: decisionRationale, conditions_or_follow_up: conditions || null,
      });
      setDecisionRationale(""); setConditions("");
      await applyCase(updated, "Décision humaine enregistrée et versionnée.");
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  async function createPreparation() {
    if (!activeCase) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const updated = await prepareDeclaration(activeCase.id);
      await applyCase(updated, updated.declaration_preparations.at(-1)?.status === "prepared_for_declaration" ? "Préparation interne créée. Aucune déclaration n'a été soumise." : "Préparation créée avec les éléments manquants listés ci-dessous.");
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  async function downloadPreparation(item: DeclarationPreparation) {
    if (!activeCase) return;
    setSaving(true); setError(null);
    try {
      const download = await downloadDeclarationPreparation(activeCase.id, item.id);
      internalDownload(download.blob, download.filename);
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  if (loading && !cases.length) return <div className="card text-sm text-slate-500">Chargement des dossiers de diligence…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Processus humain · Articles 9–13</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Diligence raisonnée</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Sources, facteurs, atténuation et décisions sont versionnés. Une absence de signal n'est pas une preuve de conformité.</p>
        </div>
        <Link href="/risks" className="btn-secondary">← Risques</Link>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</div>}

      {!cases.length ? (
        <div className="card text-center">
          <div className="text-3xl">📋</div>
          <h2 className="mt-2 font-semibold">Aucun dossier DDR</h2>
          <p className="mt-1 text-sm text-slate-500">Ouvrez un dossier depuis un lot dans le module Risques.</p>
          <Link href="/risks" className="btn-primary mt-4 inline-flex">Aller aux risques</Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <label className="min-w-[260px] flex-1"><span className="label">Dossier actif</span>
              <select className="input" value={activeCase?.id || activeId} onChange={(event) => chooseCase(event.target.value)}>
                {cases.map((item) => <option key={item.id} value={item.id}>{item.case_reference} · {item.shipment_reference} · {item.product_name}</option>)}
              </select>
            </label>
            {activeCase && <div className="flex flex-wrap gap-2 text-xs">
              <Pill>{activeCase.status.replaceAll("_", " ")}</Pill>
              <Pill tone={activeCase.decision_state === "current" ? "emerald" : activeCase.decision_state === "stale" ? "amber" : "slate"}>Décision: {activeCase.decision_state === "none" ? "aucune" : activeCase.decision_state === "current" ? "actuelle" : "à refaire"}</Pill>
            </div>}
          </div>

          {activeCase && (
            <>
              <section className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
                <div className="card space-y-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cadrage économique et produit</div>
                    <h2 className="mt-1 text-lg font-semibold text-slate-900">{activeCase.shipment_reference} · {activeCase.product_name}</h2>
                    <div className="mt-1 text-sm text-slate-500">{activeCase.supplier_name} · {activeCase.quantity ?? "Quantité ?"} {activeCase.unit || ""} · {activeCase.hs_code || "Code produit ?"}</div>
                  </div>
                  <form onSubmit={saveRoleAndScope} className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label><span className="label">Rôle économique</span><select className="input" value={roleDraft.economic_role} onChange={(e) => setRoleDraft({ ...roleDraft, economic_role: e.target.value })}>
                        {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select></label>
                      <label><span className="label">Taille</span><select className="input" value={roleDraft.company_size} onChange={(e) => setRoleDraft({ ...roleDraft, company_size: e.target.value })}>
                        {["unknown", "individual", "micro", "small", "medium", "large"].map((value) => <option key={value} value={value}>{value === "unknown" ? "À confirmer" : value}</option>)}
                      </select></label>
                      <label><span className="label">Champ produit Annex I</span><select className="input" value={roleDraft.product_scope_status} onChange={(e) => setRoleDraft({ ...roleDraft, product_scope_status: e.target.value })}>
                        <option value="unknown">À déterminer</option><option value="manual_review">Revue nécessaire</option><option value="confirmed_in_scope">Confirmé par un humain comme inclus</option><option value="not_in_scope">Confirmé par un humain comme hors champ</option>
                      </select></label>
                      <label><span className="label">Voie de diligence</span><select className="input" value={roleDraft.assessment_route} onChange={(e) => setRoleDraft({ ...roleDraft, assessment_route: e.target.value })}>
                        <option value="full">Évaluation complète</option><option value="article13_simplified">Simplifiée · article 13 (à justifier)</option><option value="unknown">À confirmer</option>
                      </select></label>
                    </div>
                    <label className="block"><span className="label">Justification du rôle et de la taille réglementaire</span><textarea className="input min-h-20" value={roleDraft.role_confirmation_note} onChange={(e) => setRoleDraft({ ...roleDraft, role_confirmation_note: e.target.value })} placeholder="Source de qualification du rôle et de la taille; ne pas reprendre le plan SaaS…" /></label>
                    <label className="block"><span className="label">Justification du périmètre produit</span><textarea className="input min-h-16" value={roleDraft.product_scope_note} onChange={(e) => setRoleDraft({ ...roleDraft, product_scope_note: e.target.value })} placeholder="Code CN complet, description et examen des qualificatifs « ex »…" /></label>
                    <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={roleDraft.role_confirmed} onChange={(e) => setRoleDraft({ ...roleDraft, role_confirmed: e.target.checked })} />J'atteste avoir vérifié le rôle économique (confirmation humaine)</label>
                    {roleDraft.assessment_route === "article13_simplified" && <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={roleDraft.article13_complexity_assessed} onChange={(e) => setRoleDraft({ ...roleDraft, article13_complexity_assessed: e.target.checked })} />Complexité de la chaîne examinée</label>
                      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={roleDraft.article13_mixing_assessed} onChange={(e) => setRoleDraft({ ...roleDraft, article13_mixing_assessed: e.target.checked })} />Mélange et contournement examinés</label>
                      <textarea className="input min-h-16" value={roleDraft.article13_assessment_note} onChange={(e) => setRoleDraft({ ...roleDraft, article13_assessment_note: e.target.value })} placeholder="Documentez les raisons de la route simplifiée…" />
                    </div>}
                    <div className="flex justify-end"><button className="btn-primary" disabled={!canManageCase || saving}>{saving ? "Enregistrement…" : "Enregistrer le cadrage"}</button></div>
                  </form>
                </div>
                <div className="card space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Références applicables à ce dossier</div>
                  <div className="rounded-lg bg-slate-50 p-3 text-sm"><div className="font-semibold">Benchmark pays</div><div className="mt-1 text-xs text-slate-600">{activeCase.regulatory_reference_version}</div></div>
                  <div className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">Le benchmark national ne tranche pas le risque produit/lot. Toute position « ex », espèce, sous-partie de pays, mélange ou chaîne complexe exige une appréciation documentée.</div>
                  <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">La route affichée ici est l'évaluation complète ou la diligence simplifiée de l'article 13. La déclaration simplifiée distincte de l'article 4 bis et son éligibilité ne sont pas modélisées.</div>
                  <div className="rounded-lg border border-emerald-100 p-3">
                    <div className="text-xs font-semibold text-slate-800">Candidats Annex I pour {activeCase.hs_code || "le code SH/CN manquant"}</div>
                    {productScopeCandidates.length ? <ul className="mt-2 space-y-2">{productScopeCandidates.map((entry, index) => <li key={`${entry.code}-${index}`} className="text-xs text-slate-600"><strong>{entry.is_ex ? "ex " : ""}{entry.code}</strong>{entry.applies_from ? ` · applicable à partir du ${entry.applies_from}` : ""} — {entry.description}</li>)}</ul> : <p className="mt-1 text-xs text-slate-500">Aucun candidat trouvé dans ce catalogue indicatif; cela ne permet pas de conclure que le produit est hors champ.</p>}
                    <p className="mt-2 text-[10px] text-amber-800">Correspondance indicative uniquement; vérifier la nomenclature complète, le qualificatif « ex » et le produit réel.</p>
                  </div>
                  <div className="text-xs text-slate-500">Dossier créé le {new Date(activeCase.created_at).toLocaleDateString("fr-FR")} · Référence {activeCase.case_reference}</div>
                </div>
              </section>

              <section className="card space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Origines, pays/parties de pays et allocations</div><h2 className="mt-1 font-semibold text-slate-900">Chaque origine séparément</h2><p className="mt-1 text-xs text-slate-500">Aucune géométrie n'est affichée ici. Les coordonnées précises ne sont incluses que dans un export interne réservé à la conformité.</p></div>
                  <Pill>{activeCase.origins.length} origine(s)</Pill>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {activeCase.origins.map((origin) => <div key={origin.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-slate-900">{origin.source_label || origin.plot_reference || "Source sans nom"}</div><div className="mt-1 text-xs text-slate-600">{origin.country_code || "Pays ?"}{origin.subdivision ? ` · ${origin.subdivision}` : ""} · risque pays: <strong>{origin.benchmark_level}</strong></div><div className="mt-1 text-[11px] text-slate-400">{origin.benchmark_reason} · {origin.benchmark_version}</div></div><button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setOriginEditor(originEditor === origin.id ? null : origin.id)} disabled={!canManageCase}>{originEditor === origin.id ? "Fermer" : "Modifier"}</button></div>
                    <div className="mt-3 flex flex-wrap gap-2"><Pill tone={origin.origin_confirmed ? "emerald" : "amber"}>{origin.origin_confirmed ? "Origine confirmée" : "À confirmer"}</Pill>{origin.plot_reference && <Pill>Parcelle · {origin.plot_reference}</Pill>}{origin.quantity != null && <Pill>{origin.quantity} {origin.unit || ""}</Pill>}</div>
                    {originEditor === origin.id && <form className="mt-4 space-y-3 border-t border-slate-100 pt-4" onSubmit={(event) => void saveOrigin(event, origin.id)}>
                      <div className="grid gap-2 md:grid-cols-2">
                        <label><span className="label">Pays ISO alpha-2</span><input className="input uppercase" name="country_code" defaultValue={origin.country_code || ""} maxLength={2} /></label>
                        <label><span className="label">Partie / région du pays</span><input className="input" name="subdivision" defaultValue={origin.subdivision || ""} /></label>
                        <label><span className="label">Parcelle / établissement</span><select className="input" name="plot_id" defaultValue={origin.plot_id || ""}><option value="">— Saisie de localisation —</option>{casePlots.map((plot) => <option key={plot.id} value={plot.id}>{plot.name || plot.internal_ref || plot.id.slice(0, 8)}</option>)}</select></label>
                        <label><span className="label">Localisation textuelle si pas de parcelle</span><input className="input" name="location_description" defaultValue={origin.location_description || ""} placeholder="Adresse ou description de l'établissement" /></label>
                        <label><span className="label">Début période de production</span><input className="input" type="date" name="period_start" defaultValue={origin.production_period_start || ""} /></label>
                        <label><span className="label">Fin période de production</span><input className="input" type="date" name="period_end" defaultValue={origin.production_period_end || ""} /></label>
                        <label><span className="label">Quantité attribuée (si connue)</span><input className="input" type="number" min="0.0001" step="0.0001" name="quantity" defaultValue={origin.quantity ?? ""} /></label>
                        <label><span className="label">Unité</span><input className="input" name="unit" defaultValue={origin.unit || activeCase.unit || "kg"} /></label>
                      </div>
                      <label className="block"><span className="label">Justification et source</span><textarea className="input min-h-16" name="notes" defaultValue={origin.notes || ""} placeholder="Source, recoupements, auteur de la confirmation…" /></label>
                      <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" name="origin_confirmed" defaultChecked={origin.origin_confirmed} />Je confirme l'origine après vérification</label>
                      <div className="flex justify-end"><button className="btn-primary" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer l'origine"}</button></div>
                    </form>}
                  </div>)}
                </div>
                <details className="rounded-lg border border-dashed border-slate-300 p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Ajouter une origine / un lot amont supplémentaire</summary>
                  <form onSubmit={(event) => void addOrigin(event)} className="mt-4 grid gap-3 md:grid-cols-2">
                    <label><span className="label">Libellé source</span><input className="input" name="source_label" placeholder="Producteur, exploitation, source amont" /></label>
                    <label><span className="label">Pays ISO alpha-2</span><input className="input uppercase" name="country_code" maxLength={2} /></label>
                    <label><span className="label">Région / partie de pays</span><input className="input" name="subdivision" /></label>
                    <label><span className="label">Localisation / établissement</span><input className="input" name="location_description" /></label>
                    <label><span className="label">Début période</span><input className="input" name="period_start" type="date" /></label>
                    <label><span className="label">Fin période</span><input className="input" name="period_end" type="date" /></label>
                    <label><span className="label">Quantité</span><input className="input" name="quantity" type="number" min="0.0001" step="0.0001" /></label>
                    <label><span className="label">Unité</span><input className="input" name="unit" defaultValue={activeCase.unit || "kg"} /></label>
                    <label className="md:col-span-2"><span className="label">Note / provenance</span><textarea className="input min-h-16" name="notes" /></label>
                    <div className="md:col-span-2 flex justify-end"><button className="btn-primary" disabled={!canManageCase || saving}>{saving ? "Ajout…" : "Ajouter l'origine"}</button></div>
                  </form>
                </details>
              </section>

              <section className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
                <div className="card space-y-4">
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Article 9 · informations et preuves</div><h2 className="mt-1 font-semibold text-slate-900">Sources documentaires</h2><p className="mt-1 text-xs text-slate-500">La mention « revue » est une revue interne, pas une certification. Les fichiers liés doivent provenir du coffre documentaire du tenant.</p></div>
                  <div className="space-y-2">
                    {activeCase.evidence_items.map((evidence) => <EvidenceCard key={evidence.id} evidence={evidence} canReview={privileged} onReview={(status) => void reviewEvidence(evidence, status)} />)}
                    {!activeCase.evidence_items.length && <p className="text-xs text-slate-500">Aucune source liée à ce dossier.</p>}
                  </div>
                  {canWrite && <form onSubmit={(event) => void addEvidence(event)} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="text-sm font-semibold">Ajouter une source ou pièce</h3>
                    <div className="grid gap-2 md:grid-cols-2">
                      <label><span className="label">Type</span><select className="input" value={evidenceForm.evidence_type} onChange={(e) => setEvidenceForm({ ...evidenceForm, evidence_type: e.target.value as RiskEvidencePayload["evidence_type"] })}><option value="deforestation_free">Déforestation libre</option><option value="legality">Légalité de production</option><option value="origin">Origine</option><option value="supply_chain">Chaîne d'approvisionnement</option><option value="risk_context">Contexte de risque</option><option value="mitigation">Atténuation</option><option value="other">Autre</option></select></label>
                      <label><span className="label">Fichier du coffre (optionnel)</span><select className="input" value={evidenceForm.document_version_id || ""} onChange={(e) => setEvidenceForm({ ...evidenceForm, document_version_id: e.target.value || null })}><option value="">— Source textuelle / lien externe —</option>{cleanDocVersions.map((doc) => <option key={doc.id} value={doc.latest_version!.id}>{doc.title} · v{doc.latest_version!.version_number}</option>)}</select></label>
                      <label className="md:col-span-2"><span className="label">Titre</span><input className="input" required minLength={3} value={evidenceForm.title} onChange={(e) => setEvidenceForm({ ...evidenceForm, title: e.target.value })} /></label>
                      <label className="md:col-span-2"><span className="label">Résumé / pertinence</span><textarea className="input min-h-20" required minLength={10} value={evidenceForm.summary} onChange={(e) => setEvidenceForm({ ...evidenceForm, summary: e.target.value })} /></label>
                      <label><span className="label">URL HTTPS</span><input className="input" type="url" value={evidenceForm.source_url || ""} onChange={(e) => setEvidenceForm({ ...evidenceForm, source_url: e.target.value || null })} /></label>
                      <label><span className="label">Référence</span><input className="input" value={evidenceForm.source_reference || ""} onChange={(e) => setEvidenceForm({ ...evidenceForm, source_reference: e.target.value || null })} /></label>
                    </div>
                    <div className="flex justify-end"><button className="btn-primary" disabled={saving}>{saving ? "Ajout…" : "Ajouter la source"}</button></div>
                  </form>}
                </div>

                <div className="card space-y-4">
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Articles 10–11 · constats et atténuation</div><h2 className="mt-1 font-semibold text-slate-900">Facteurs de risque documentés</h2><p className="mt-1 text-xs text-slate-500">Chaque critère est saisi séparément; aucune note globale ou décision automatique n'est produite.</p></div>
                  <div className="max-h-[620px] space-y-3 overflow-auto pr-1">
                    {activeCase.findings.map((finding) => {
                      const draft = findingDrafts[finding.criterion] || { status: finding.assessment_status, rationale: finding.rationale || "", sourceNote: finding.source_note || "" };
                      return <div key={finding.id} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2"><div className="text-xs font-semibold text-slate-800">{finding.criterion.replaceAll("_", " ")}</div><Pill tone={finding.assessment_status === "concern_identified" ? "rose" : finding.assessment_status === "not_assessed" || finding.assessment_status === "inconclusive" ? "amber" : "slate"}>{finding.assessment_status.replaceAll("_", " ")}</Pill></div>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{finding.label}</p>
                        <div className="mt-2 grid gap-2 md:grid-cols-[.8fr_1.2fr]">
                          <select className="input" value={draft.status} onChange={(e) => setFindingDrafts({ ...findingDrafts, [finding.criterion]: { ...draft, status: e.target.value as FindingStatus } })}>{FINDING_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select>
                          <textarea className="input min-h-16" value={draft.rationale} onChange={(e) => setFindingDrafts({ ...findingDrafts, [finding.criterion]: { ...draft, rationale: e.target.value } })} placeholder="Justification (requise si évalué)…" />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2"><input className="input min-w-[200px] flex-1" value={draft.sourceNote} onChange={(e) => setFindingDrafts({ ...findingDrafts, [finding.criterion]: { ...draft, sourceNote: e.target.value } })} placeholder="Référence de source / signal (si pertinent)" /><button className="btn-secondary !px-3 !py-2 text-xs" onClick={() => void saveFinding(finding)} disabled={!canWrite || saving}>Enregistrer</button></div>
                        {finding.evidence_ids.length > 0 && <div className="mt-2 text-[10px] text-emerald-700">{finding.evidence_ids.length} preuve(s) liée(s)</div>}
                      </div>;
                    })}
                  </div>
                </div>
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="card space-y-3">
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Article 11</div><h2 className="mt-1 font-semibold text-slate-900">Mesures d'atténuation</h2></div>
                  {activeCase.mitigation_actions.map((action) => <MitigationCard key={action.id} action={action} onComplete={(note) => void markMitigationComplete(action, note)} disabled={!canWrite || saving} />)}
                  {!activeCase.mitigation_actions.length && <p className="text-xs text-slate-500">Aucune mesure planifiée.</p>}
                  {canWrite && <form onSubmit={(event) => void submitMitigation(event)} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <label><span className="label">Constat lié</span><select className="input" value={mitigationDraft.finding_id} onChange={(e) => setMitigationDraft({ ...mitigationDraft, finding_id: e.target.value })}><option value="">— Choisir —</option>{activeCase.findings.map((finding) => <option key={finding.id} value={finding.id}>{finding.criterion.replaceAll("_", " ")}</option>)}</select></label>
                    <label><span className="label">Mesure proposée</span><input className="input" required minLength={3} value={mitigationDraft.title} onChange={(e) => setMitigationDraft({ ...mitigationDraft, title: e.target.value })} /></label>
                    <label><span className="label">Description et responsable / échéance</span><textarea className="input min-h-16" required minLength={10} value={mitigationDraft.description} onChange={(e) => setMitigationDraft({ ...mitigationDraft, description: e.target.value })} /></label>
                    <div className="flex justify-end"><button className="btn-primary" disabled={saving}>Planifier</button></div>
                  </form>}
                </div>

                <div className="card space-y-4">
                  <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Décision humaine · Article 12</div><h2 className="mt-1 font-semibold text-slate-900">Registre de décision</h2><p className="mt-1 text-xs text-slate-500">Seuls admin/conformité peuvent enregistrer une décision. Les changements de source la rendent obsolète.</p></div>
                  {activeCase.decisions.map((decision) => <div key={decision.id} className="rounded-lg border border-slate-200 p-3"><div className="flex justify-between gap-2"><strong className="text-sm">Décision #{decision.decision_number}</strong><Pill tone={decision.outcome === "no_or_negligible" ? "emerald" : "rose"}>{decision.outcome.replaceAll("_", " ")}</Pill></div><p className="mt-2 text-xs text-slate-600">{decision.rationale}</p><div className="mt-2 text-[10px] text-slate-400">{new Date(decision.created_at).toLocaleString("fr-FR")} · {decision.reference_version}</div></div>)}
                  {privileged ? <form onSubmit={(event) => void submitDecision(event)} className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                    <label><span className="label">Conclusion humaine</span><select className="input" value={decisionOutcome} onChange={(e) => setDecisionOutcome(e.target.value as typeof decisionOutcome)}><option value="no_or_negligible">Risque nul ou négligeable (après examen)</option><option value="non_negligible">Risque non négligeable / blocage</option></select></label>
                    <label><span className="label">Motivation complète (min. 25 caractères)</span><textarea className="input min-h-24" required minLength={25} value={decisionRationale} onChange={(e) => setDecisionRationale(e.target.value)} /></label>
                    <label><span className="label">Conditions / suivi</span><textarea className="input min-h-16" value={conditions} onChange={(e) => setConditions(e.target.value)} /></label>
                    <button className="btn-primary w-full" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer une nouvelle décision"}</button>
                  </form> : <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Rôle {user?.role || "inconnu"} : consultation uniquement pour la décision finale.</div>}
                </div>
              </section>

              <section className="card space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Annexes II/III · préparation assistée</div><h2 className="mt-1 font-semibold text-slate-900">Préparation interne, sans soumission</h2><p className="mt-1 max-w-3xl text-xs text-slate-600">Le JSON généré n'est pas un format officiel. Aucun connecteur EUDR-IS, envoi ni statut « déclaré » n'est implémenté.</p></div><button className="btn-primary" onClick={() => void createPreparation()} disabled={!canManageCase || saving}>{saving ? "Préparation…" : "Créer le préremplissage interne"}</button></div>
                {activeCase.declaration_preparations.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold text-slate-900">Préparation #{item.sequence_number} · {item.status === "prepared_for_declaration" ? "Préparé pour déclaration" : item.status === "stale" ? "À régénérer" : "Incomplète"}</div><div className="mt-1 text-xs text-slate-500">Format interne {item.internal_format_version} · {new Date(item.created_at).toLocaleString("fr-FR")}</div></div><button className="btn-secondary" onClick={() => void downloadPreparation(item)} disabled={saving || !privileged || item.status === "stale"} title={item.status === "stale" ? "Régénérez la préparation avant export" : undefined}>Télécharger le JSON interne</button></div>
                  {item.stale_reason && <div className="mt-2 text-xs text-amber-800">{item.stale_reason}</div>}
                  {item.missing_fields.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-900">{item.missing_fields.map((field, index) => <li key={`${index}-${field}`}>{field}</li>)}</ul>}
                </div>)}
                {!activeCase.declaration_preparations.length && <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-xs text-slate-500">Aucun préremplissage généré.</div>}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "emerald" | "amber" | "rose" }) {
  const cls = tone === "emerald" ? "bg-emerald-100 text-emerald-800" : tone === "amber" ? "bg-amber-100 text-amber-800" : tone === "rose" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${cls}`}>{children}</span>;
}

function EvidenceCard({ evidence, canReview, onReview }: { evidence: RiskEvidence; canReview: boolean; onReview: (status: "reviewed" | "follow_up") => void }) {
  return <div className="rounded-lg border border-slate-200 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-semibold text-slate-800">{evidence.title}</div><div className="mt-1 text-[10px] uppercase text-slate-400">{evidence.evidence_type.replaceAll("_", " ")}</div></div><Pill tone={evidence.review_status === "reviewed" ? "emerald" : evidence.review_status === "follow_up" ? "amber" : "slate"}>{REVIEW_LABEL[evidence.review_status]}</Pill></div>
    <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{evidence.summary}</p>
    <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">{evidence.document_id && <span>Document v{evidence.document_version_number} · SHA-256 {evidence.document_sha256?.slice(0, 12)}…</span>}{evidence.source_reference && <span>Réf. {evidence.source_reference}</span>}{evidence.source_url && <a className="text-emerald-700 underline" href={evidence.source_url} target="_blank" rel="noreferrer">Source ↗</a>}</div>
    {canReview && evidence.review_status !== "reviewed" && <div className="mt-3 flex gap-2"><button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => onReview("reviewed")}>Marquer revue</button><button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => onReview("follow_up")}>À suivre</button></div>}
  </div>;
}

function MitigationCard({ action, onComplete, disabled }: { action: RiskMitigationAction; onComplete: (note: string) => void; disabled: boolean }) {
  const [note, setNote] = useState(action.effectiveness_note || "");
  return <div className="rounded-lg border border-slate-200 p-3">
    <div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{action.title}</strong><Pill tone={action.status === "completed" ? "emerald" : action.status === "ineffective" ? "rose" : "amber"}>{action.status.replaceAll("_", " ")}</Pill></div>
    <p className="mt-2 text-xs text-slate-600">{action.description}</p>
    {action.finding_id && <div className="mt-1 text-[10px] text-slate-400">Liée à un critère de risque</div>}
    {action.status !== "completed" && <div className="mt-3 space-y-2"><textarea className="input min-h-16" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Évaluation de l'efficacité (min. 12 caractères)" /><button className="btn-secondary text-xs" disabled={disabled || note.trim().length < 12} onClick={() => onComplete(note)}>Clôturer et documenter l'efficacité</button></div>}
    {action.effectiveness_assessed && <div className="mt-2 text-xs text-emerald-800">Efficacité revue : {action.effectiveness_note}</div>}
  </div>;
}
