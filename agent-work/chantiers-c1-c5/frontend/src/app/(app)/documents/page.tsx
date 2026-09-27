"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  type DocumentChecklistPublic,
  type DocumentPublic,
  type DocumentChecklistCreate,
  type Plot,
  type Product,
  type Shipment,
  type Supplier,
  addDocumentVersion,
  archiveDocument,
  createDocument,
  createDocumentChecklist,
  deactivateDocumentChecklist,
  documentDownloadLink,
  fetchAuthorizedDownload,
  listDocumentChecklist,
  listDocuments,
  listPlots,
  listProducts,
  listShipments,
  listSuppliers,
  reviewDocument,
  updateDocument,
} from "@/lib/api";

const CATEGORIES = [
  ["land_rights", "Droits fonciers / usage des terres"],
  ["permit", "Permis et autorisations"],
  ["environment", "Environnement / gestion forestière"],
  ["contract", "Contrat ou accord"],
  ["social", "Éléments sociaux / droits de tiers"],
  ["audit_certification", "Audit / vérification tierce"],
  ["other", "Autre preuve"],
] as const;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Une erreur est survenue.";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("fr-FR");
}

function formatSize(value: number | undefined) {
  if (!value) return "—";
  return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} Ko` : `${(value / (1024 * 1024)).toFixed(1)} Mio`;
}

function statusLabel(status: DocumentPublic["review_status"]) {
  if (status === "reviewed") return "Revu";
  if (status === "follow_up") return "À suivre";
  return "À examiner";
}

function checklistLabel(state: DocumentChecklistPublic["state"]) {
  return {
    received: "Pièce reçue",
    missing: "Manquante",
    expired: "Expirée",
    expiring_soon: "Expire sous 30 jours",
  }[state];
}

function triggerDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename || "document";
  anchor.rel = "noreferrer";
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentPublic[]>([]);
  const [checklist, setChecklist] = useState<DocumentChecklistPublic[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [plots, setPlots] = useState<Plot[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showChecklistForm, setShowChecklistForm] = useState(false);
  const [checkTitle, setCheckTitle] = useState("");
  const [checkCategory, setCheckCategory] = useState("other");
  const [checkScopeType, setCheckScopeType] = useState<DocumentChecklistCreate["scope_type"]>("organization");
  const [checkScopeId, setCheckScopeId] = useState("");
  const [checkNote, setCheckNote] = useState("");
  const [checkSource, setCheckSource] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [docResult, checks, supplierResult, shipmentResult, productResult, plotResult] = await Promise.all([
        listDocuments({ q: search || undefined, category: categoryFilter || undefined, limit: 100 }),
        listDocumentChecklist(),
        listSuppliers({ limit: 100 }),
        listShipments({ limit: 100 }),
        listProducts({ limit: 100 }),
        listPlots({ limit: 100 }),
      ]);
      setDocuments(docResult.items);
      setChecklist(checks);
      setSuppliers(supplierResult.items);
      setShipments(shipmentResult.items);
      setProducts(productResult.items);
      setPlots(plotResult.items);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter]);

  useEffect(() => { void load(); }, [load]);

  const activeDocuments = useMemo(() => documents.filter((doc) => !doc.is_archived), [documents]);
  const needingReview = activeDocuments.filter((doc) => doc.review_status !== "reviewed").length;
  const expiringCount = checklist.filter((item) => item.state === "expiring_soon").length;
  const missingCount = checklist.filter((item) => item.state === "missing" || item.state === "expired").length;

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!data.get("file")) {
      setError("Sélectionnez un fichier à déposer.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await createDocument(data);
      form.reset();
      ["supplier_id", "shipment_id", "product_id", "plot_id"].forEach((key) => form.querySelectorAll(`input[name="${key}"]`).forEach((input) => input.remove()));
      setShowUpload(false);
      setNotice("Document déposé après validation du fichier et contrôle antivirus.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onChecklistCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: DocumentChecklistCreate = {
      title: checkTitle.trim(),
      category: checkCategory,
      scope_type: checkScopeType,
      scope_id: checkScopeType === "organization" ? null : checkScopeId || null,
      note: checkNote.trim() || null,
      source_url: checkSource.trim() || null,
      source_title: checkSource.trim() ? "Source de référence" : null,
    };
    setSaving(true);
    setError(null);
    try {
      await createDocumentChecklist(payload);
      setCheckTitle("");
      setCheckScopeType("organization");
      setCheckScopeId("");
      setCheckNote("");
      setCheckSource("");
      setShowChecklistForm(false);
      setNotice("Élément de checklist ajouté à la configuration de votre organisation.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDownload(doc: DocumentPublic) {
    setDownloadingId(doc.id);
    setError(null);
    try {
      const link = await documentDownloadLink(doc.id, doc.latest_version?.id);
      if (link.presigned) {
        window.location.assign(link.url);
      } else {
        const result = await fetchAuthorizedDownload(link.url, doc.latest_version?.original_filename || "document");
        triggerDownload(result.blob, result.filename);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDownloadingId(null);
    }
  }

  async function onAddVersion(docId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      await addDocumentVersion(docId, file);
      setNotice("Nouvelle version ajoutée; le statut de revue est repassé à « à examiner ».");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onReview(doc: DocumentPublic, status: DocumentPublic["review_status"]) {
    setSaving(true);
    setError(null);
    try {
      await reviewDocument(doc.id, status);
      setNotice(status === "reviewed" ? "Revue humaine enregistrée." : "Document marqué « à suivre ». ");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onVisibility(doc: DocumentPublic) {
    setSaving(true);
    setError(null);
    try {
      await updateDocument(doc.id, { supplier_visible: !doc.supplier_visible });
      setNotice(doc.supplier_visible ? "Document masqué au portail fournisseur." : "Document rendu visible au portail fournisseur.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onArchive(doc: DocumentPublic) {
    if (!window.confirm(`Archiver « ${doc.title} » ? Les versions resteront conservées et l'action sera auditée.`)) return;
    setSaving(true);
    setError(null);
    try {
      await archiveDocument(doc.id);
      setNotice("Document archivé; aucune version binaire n'a été supprimée.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDeactivateChecklist(item: DocumentChecklistPublic) {
    if (!window.confirm(`Désactiver l'élément « ${item.title} » ?`)) return;
    setSaving(true);
    setError(null);
    try {
      await deactivateDocumentChecklist(item.id);
      setNotice("Élément de checklist désactivé.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function targetLabel(type: string, id: string) {
    if (type === "supplier") return suppliers.find((item) => item.id === id)?.name || `Fournisseur ${id.slice(0, 8)}`;
    if (type === "shipment") return shipments.find((item) => item.id === id)?.reference || `Lot ${id.slice(0, 8)}`;
    if (type === "product") return products.find((item) => item.id === id)?.name || `Produit ${id.slice(0, 8)}`;
    const plot = plots.find((item) => item.id === id);
    return plot?.name || plot?.internal_ref || `Parcelle ${id.slice(0, 8)}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Chantier 7 · coffre documentaire</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Documents de légalité</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Pièces privées, versions immuables, suivi d'expiration et revue humaine — sans verdict juridique automatique.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowUpload((value) => !value)}>
          {showUpload ? "Fermer le dépôt" : "+ Déposer un document"}
        </button>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
        <strong>Suivi documentaire uniquement.</strong> Les catégories et checklists sont indicatives, propres à votre organisation et non exhaustives. Le statut « Revu » signifie qu'une personne a enregistré une revue; il ne certifie ni la légalité ni la conformité EUDR.
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card"><div className="text-xs font-medium text-slate-500">Documents actifs</div><div className="mt-2 text-2xl font-bold text-slate-900">{activeDocuments.length}</div></div>
        <div className="card"><div className="text-xs font-medium text-slate-500">À examiner / suivre</div><div className="mt-2 text-2xl font-bold text-amber-700">{needingReview}</div></div>
        <div className="card"><div className="text-xs font-medium text-slate-500">Checklist bientôt échue · manquante/expirée</div><div className="mt-2 text-2xl font-bold text-slate-900">{expiringCount} · {missingCount}</div></div>
      </div>

      {showUpload && (
        <form className="card space-y-5 border-emerald-200" onSubmit={onUpload}>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Nouveau document</h2>
            <p className="mt-1 text-xs text-slate-500">Formats autorisés : PDF, JPG/JPEG, PNG ou DOCX · 20 Mio maximum · ClamAV obligatoire.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="doc-title">Titre *</label>
              <input className="input" id="doc-title" name="title" required maxLength={200} placeholder="Ex. Autorisation d'exploitation 2026" />
            </div>
            <div>
              <label className="label" htmlFor="doc-category">Catégorie indicative *</label>
              <select className="input" id="doc-category" name="category" required defaultValue="other">
                {CATEGORIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="doc-file">Fichier *</label>
              <input className="input" id="doc-file" name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
            </div>
            <div>
              <label className="label" htmlFor="doc-target">Associer à une ressource (facultatif)</label>
              <select className="input" id="doc-target" name="" defaultValue="" onChange={(event) => {
                const form = event.currentTarget.form;
                if (!form) return;
                ["supplier_id", "shipment_id", "product_id", "plot_id"].forEach((key) => form.querySelector<HTMLInputElement>(`input[name="${key}"]`)?.remove());
                const [type, id] = event.target.value.split(":");
                if (type && id) {
                  const hidden = window.document.createElement("input"); hidden.type = "hidden"; hidden.name = `${type}_id`; hidden.value = id; form.appendChild(hidden);
                }
              }}>
                <option value="">Document général à l'organisation</option>
                {suppliers.length > 0 && <optgroup label="Fournisseurs">{suppliers.map((item) => <option key={item.id} value={`supplier:${item.id}`}>{item.name}</option>)}</optgroup>}
                {shipments.length > 0 && <optgroup label="Lots">{shipments.map((item) => <option key={item.id} value={`shipment:${item.id}`}>{item.reference} · {item.supplier_name || "Fournisseur"}</option>)}</optgroup>}
                {products.length > 0 && <optgroup label="Produits">{products.map((item) => <option key={item.id} value={`product:${item.id}`}>{item.name} · {item.commodity_label || item.commodity}</option>)}</optgroup>}
                {plots.length > 0 && <optgroup label="Parcelles">{plots.map((item) => <option key={item.id} value={`plot:${item.id}`}>{item.name || item.internal_ref || item.id.slice(0, 8)} · {item.shipment_reference || "Lot"}</option>)}</optgroup>}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="doc-issuer">Émetteur</label>
              <input className="input" id="doc-issuer" name="issuer_name" maxLength={200} placeholder="Autorité, organisme, titulaire…" />
            </div>
            <div>
              <label className="label" htmlFor="doc-ref">Référence</label>
              <input className="input" id="doc-ref" name="reference_number" maxLength={120} placeholder="Numéro de document" />
            </div>
            <div>
              <label className="label" htmlFor="doc-issued">Date d'émission</label>
              <input className="input" id="doc-issued" name="issued_at" type="date" />
            </div>
            <div>
              <label className="label" htmlFor="doc-expires">Date d'expiration</label>
              <input className="input" id="doc-expires" name="expires_at" type="date" />
            </div>
            <div className="md:col-span-2">
              <label className="label" htmlFor="doc-description">Note interne</label>
              <textarea className="input min-h-20 resize-y" id="doc-description" name="description" maxLength={4000} placeholder="Contexte utile pour la revue humaine" />
            </div>
            <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700 md:col-span-2">
              <input type="checkbox" name="supplier_visible" value="true" className="h-4 w-4 accent-emerald-700" />
              Rendre le document visible au compte fournisseur lié (si le document est associé à son profil)
            </label>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn btn-secondary" onClick={() => setShowUpload(false)}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Contrôle et dépôt…" : "Contrôler et déposer"}</button>
          </div>
        </form>
      )}

      <section className="card space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Documents</h2>
            <p className="text-xs text-slate-500">Accès isolé par organisation · téléchargements privés et audités</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input className="input min-w-52" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un titre…" aria-label="Rechercher un document" />
            <select className="input min-w-48" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filtrer par catégorie">
              <option value="">Toutes catégories</option>
              {CATEGORIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </div>
        </div>

        {loading ? <div className="py-12 text-center text-sm text-slate-500">Chargement du coffre documentaire…</div> : activeDocuments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center">
            <div className="text-3xl">📁</div>
            <h3 className="mt-3 font-semibold text-slate-900">Aucun document correspondant</h3>
            <p className="mt-1 text-sm text-slate-500">Déposez une pièce pour commencer à constituer le coffre du tenant.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeDocuments.map((doc) => (
              <article key={doc.id} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{doc.title}</h3>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${doc.review_status === "reviewed" ? "bg-emerald-50 text-emerald-800" : doc.review_status === "follow_up" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{statusLabel(doc.review_status)}</span>
                      {doc.supplier_visible && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-800">Visible fournisseur</span>}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{CATEGORIES.find(([code]) => code === doc.category)?.[1] || doc.category} · v{doc.current_version_number} · {doc.latest_version?.original_filename || "Fichier"} · {formatSize(doc.latest_version?.file_size_bytes)}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                      {doc.issuer_name && <span>Émetteur : {doc.issuer_name}</span>}
                      {doc.reference_number && <span>Réf. : {doc.reference_number}</span>}
                      {doc.expires_at && <span>Expire le {formatDate(doc.expires_at)}</span>}
                      {doc.links.map((link) => <span key={`${link.target_type}:${link.target_id}`} className="rounded bg-slate-100 px-2 py-0.5">{link.target_type === "supplier" ? "Fournisseur" : link.target_type === "shipment" ? "Lot" : link.target_type === "product" ? "Produit" : "Parcelle"} · {targetLabel(link.target_type, link.target_id)}</span>)}
                    </div>
                    {doc.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{doc.description}</p>}
                    {doc.review_note && <p className="mt-2 text-xs text-amber-800">Note de revue : {doc.review_note}</p>}
                    <p className="mt-2 text-[11px] text-slate-400">SHA-256 {doc.latest_version?.sha256 || "—"} · antivirus {doc.latest_version?.scan_status === "clean" ? "propre" : "non vérifié"} · {doc.versions_count} version(s)</p>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:max-w-64 lg:justify-end">
                    <button className="btn btn-secondary px-3 py-2 text-xs" onClick={() => onDownload(doc)} disabled={saving || downloadingId === doc.id}>{downloadingId === doc.id ? "Préparation…" : "Télécharger"}</button>
                    <label className="btn btn-secondary cursor-pointer px-3 py-2 text-xs" title="Ajouter une nouvelle version immuable">
                      Nouvelle version
                      <input type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png,.docx" onChange={(event) => void onAddVersion(doc.id, event)} />
                    </label>
                    {doc.review_status !== "reviewed" && <button className="btn btn-secondary px-3 py-2 text-xs" onClick={() => void onReview(doc, "reviewed")} disabled={saving}>Marquer revu</button>}
                    {doc.review_status !== "follow_up" && <button className="btn btn-secondary px-3 py-2 text-xs" onClick={() => void onReview(doc, "follow_up")} disabled={saving}>À suivre</button>}
                    {doc.links.some((link) => link.target_type === "supplier") && <button className="btn btn-secondary px-3 py-2 text-xs" onClick={() => void onVisibility(doc)} disabled={saving}>{doc.supplier_visible ? "Masquer au fournisseur" : "Partager au fournisseur"}</button>}
                    <button className="btn btn-secondary px-3 py-2 text-xs text-red-700" onClick={() => void onArchive(doc)} disabled={saving}>Archiver</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Checklist documentaire configurée</h2>
            <p className="mt-1 text-xs text-slate-500">Pas de liste universelle : les éléments, leurs références et leur périmètre sont paramétrés par votre organisation.</p>
          </div>
          <button className="btn btn-secondary" onClick={() => setShowChecklistForm((value) => !value)}>{showChecklistForm ? "Fermer" : "+ Ajouter un élément"}</button>
        </div>
        {showChecklistForm && (
          <form className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2" onSubmit={onChecklistCreate}>
            <div>
              <label className="label" htmlFor="check-title">Élément attendu par votre organisation *</label>
              <input id="check-title" className="input" required maxLength={200} value={checkTitle} onChange={(event) => setCheckTitle(event.target.value)} placeholder="Ex. Pièce justificative à fournir" />
            </div>
            <div>
              <label className="label" htmlFor="check-category">Catégorie</label>
              <select id="check-category" className="input" value={checkCategory} onChange={(event) => setCheckCategory(event.target.value)}>{CATEGORIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select>
            </div>
            <div>
              <label className="label" htmlFor="check-scope-type">Périmètre de suivi</label>
              <select id="check-scope-type" className="input" value={checkScopeType} onChange={(event) => { setCheckScopeType(event.target.value as DocumentChecklistCreate["scope_type"]); setCheckScopeId(""); }}>
                <option value="organization">Organisation entière</option>
                <option value="supplier">Un fournisseur</option>
                <option value="shipment">Un lot</option>
                <option value="product">Un produit</option>
                <option value="plot">Une parcelle</option>
              </select>
            </div>
            {checkScopeType !== "organization" && (
              <div>
                <label className="label" htmlFor="check-scope-id">Ressource cible *</label>
                <select id="check-scope-id" className="input" required value={checkScopeId} onChange={(event) => setCheckScopeId(event.target.value)}>
                  <option value="">Sélectionner une ressource</option>
                  {checkScopeType === "supplier" && suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  {checkScopeType === "shipment" && shipments.map((item) => <option key={item.id} value={item.id}>{item.reference} · {item.supplier_name || "Fournisseur"}</option>)}
                  {checkScopeType === "product" && products.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.commodity_label || item.commodity}</option>)}
                  {checkScopeType === "plot" && plots.map((item) => <option key={item.id} value={item.id}>{item.name || item.internal_ref || item.id.slice(0, 8)} · {item.shipment_reference || "Lot"}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="check-source">URL de référence (HTTPS uniquement)</label>
              <input id="check-source" className="input" type="url" value={checkSource} onChange={(event) => setCheckSource(event.target.value)} placeholder="https://…" />
            </div>
            <div>
              <label className="label" htmlFor="check-note">Note interne</label>
              <input id="check-note" className="input" value={checkNote} onChange={(event) => setCheckNote(event.target.value)} placeholder="Portée / instruction de suivi" />
            </div>
            <div className="md:col-span-2 flex justify-end">
              <button type="submit" className="btn btn-primary" disabled={saving || !checkTitle.trim() || (checkScopeType !== "organization" && !checkScopeId)}>{saving ? "Enregistrement…" : "Ajouter à la checklist"}</button>
            </div>
          </form>
        )}
        {checklist.length === 0 ? <div className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">Aucun élément configuré. La checklist n'est pas préremplie comme une obligation juridique exhaustive.</div> : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {checklist.map((item) => (
              <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{item.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.state === "received" ? "bg-emerald-50 text-emerald-800" : item.state === "expiring_soon" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"}`}>{checklistLabel(item.state)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Catégorie : {item.category} · Périmètre : {item.scope_type === "organization" ? "Organisation" : targetLabel(item.scope_type, item.scope_id || "")}{item.country_code ? ` · ${item.country_code}` : ""}{item.commodity_code ? ` · ${item.commodity_code}` : ""}</p>
                  {item.note && <p className="mt-1 text-sm text-slate-600">{item.note}</p>}
                  {item.source_url && <a className="mt-1 inline-block text-xs font-medium text-emerald-700 hover:underline" href={item.source_url} target="_blank" rel="noreferrer">Source de référence ↗</a>}
                </div>
                <button className="text-xs font-medium text-slate-500 hover:text-red-700" onClick={() => void onDeactivateChecklist(item)} disabled={saving}>Désactiver</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
