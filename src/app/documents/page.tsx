"use client";

import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategory,
  type DocumentRecord,
  type DocumentStatus,
} from "@/lib/eudr/types";
import { useEffect, useState } from "react";

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"ALL" | "EXPIRED" | "TO_VERIFY">("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<DocumentCategory>("LAND_TENURE");
  const [supplierName, setSupplierName] = useState("");
  const [issuingAuthority, setIssuingAuthority] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/documents");
        if (res.ok) setDocuments(await res.json());
      } catch {
        /* fallback */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);

    try {
      const res = await fetch("/api/v1/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          category,
          supplierName: supplierName || "Fournisseur Partenaire",
          issuingAuthority,
          referenceNumber,
          expiryDate: expiryDate || null,
          notes,
          fileName: `${title.toLowerCase().replace(/[^a-z0-9]/g, "_")}.pdf`,
          fileSize: 1850000,
        }),
      });

      if (res.ok) {
        const created: DocumentRecord = await res.json();
        setDocuments((prev) => [created, ...prev]);
        setShowUploadModal(false);
        setTitle("");
        setIssuingAuthority("");
        setReferenceNumber("");
        setExpiryDate("");
      }
    } catch {
      alert("Erreur lors de l'enregistrement du document.");
    } finally {
      setUploading(false);
    }
  };

  const handleValidateDoc = async (id: string, newStatus: DocumentStatus) => {
    try {
      const res = await fetch(`/api/v1/documents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        setDocuments((prev) =>
          prev.map((d) => (d.id === id ? { ...d, status: newStatus } : d)),
        );
      }
    } catch {
      alert("Erreur lors de la mise à jour du document.");
    }
  };

  const filteredDocs = documents.filter((d) => {
    if (activeTab === "EXPIRED" && !(d.status === "EXPIRED" || d.status === "EXPIRING_SOON")) return false;
    if (activeTab === "TO_VERIFY" && d.status !== "TO_VERIFY") return false;
    if (categoryFilter !== "ALL" && d.category !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = d.title.toLowerCase().includes(q);
      const matchSupplier = d.supplierName?.toLowerCase().includes(q);
      const matchRef = d.referenceNumber?.toLowerCase().includes(q);
      if (!matchTitle && !matchSupplier && !matchRef) return false;
    }
    return true;
  });

  const totalDocs = documents.length;
  const validDocs = documents.filter((d) => d.status === "VALID").length;
  const expiredDocs = documents.filter((d) => d.status === "EXPIRED" || d.status === "EXPIRING_SOON").length;
  const toVerifyDocs = documents.filter((d) => d.status === "TO_VERIFY").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Coffre Documentaire & Preuves de Légalité EUDR</h1>
          <p className="text-xs text-slate-500">
            Gestion sécurisée des titres fonciers, permis d'abattage, conformité fiscale/sociale et consentements FPIC.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowUploadModal(true)}
          className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 flex items-center justify-center gap-2"
        >
          <span>📁</span>
          <span>Déposer un document</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Total Documents Vault</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{totalDocs}</div>
          <div className="text-[10px] text-slate-500">Preuves juridiques indexées</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Documents Valides</div>
          <div className="mt-2 text-2xl font-bold text-emerald-600">{validDocs}</div>
          <div className="text-[10px] text-emerald-600 font-semibold">Conformité légale attestée ✓</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Expirés / Échéance &lt; 30j</div>
          <div className="mt-2 text-2xl font-bold text-rose-600">{expiredDocs}</div>
          <div className="text-[10px] text-rose-600 font-semibold">Action de renouvellement requise</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">À Vérifier (Revue Humaine)</div>
          <div className="mt-2 text-2xl font-bold text-sky-600">{toVerifyDocs}</div>
          <div className="text-[10px] text-sky-600 font-semibold">En attente de contrôle compliance</div>
        </div>
      </div>

      {/* Navigation Tabs & Filters */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("ALL")}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === "ALL"
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              Tous les documents ({totalDocs})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("EXPIRED")}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === "EXPIRED"
                  ? "bg-rose-600 text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              Expirés & Échéances ({expiredDocs})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("TO_VERIFY")}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === "TO_VERIFY"
                  ? "bg-sky-600 text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              À vérifier ({toVerifyDocs})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Rechercher titre, fournisseur, réf..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs focus:border-emerald-500 focus:outline-none w-56 shadow-2xs"
            />

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">Toutes les catégories</option>
              {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Documents Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">Document / Fichier</th>
                  <th className="px-4 py-3">Catégorie</th>
                  <th className="px-4 py-3">Fournisseur / Parcelle</th>
                  <th className="px-4 py-3">Autorité Émettrice</th>
                  <th className="px-4 py-3">Validité</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      Chargement des documents...
                    </td>
                  </tr>
                ) : filteredDocs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      Aucun document trouvé pour cette sélection.
                    </td>
                  </tr>
                ) : (
                  filteredDocs.map((d) => {
                    const isValid = d.status === "VALID";
                    const isExpired = d.status === "EXPIRED";
                    const isExpiring = d.status === "EXPIRING_SOON";
                    const isToVerify = d.status === "TO_VERIFY";

                    return (
                      <tr key={d.id} className="hover:bg-slate-50/75 transition">
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          <div className="flex items-center gap-2">
                            <span>📄</span>
                            <div>
                              <div>{d.title}</div>
                              <div className="text-[10px] font-mono text-slate-400 font-normal">
                                {d.fileName} ({Math.round(d.fileSize / 1024)} ko)
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                            {DOCUMENT_CATEGORY_LABELS[d.category] || d.category}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{d.supplierName || "—"}</div>
                          {d.plotName && <div className="text-[10px] text-slate-500">📍 {d.plotName}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div>{d.issuingAuthority || "Non spécifié"}</div>
                          {d.referenceNumber && (
                            <div className="text-[10px] font-mono text-slate-400">Réf: {d.referenceNumber}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px]">
                          {d.expiryDate ? (
                            <span className={isExpired ? "text-rose-600 font-bold" : isExpiring ? "text-amber-600 font-bold" : "text-slate-600"}>
                              {new Date(d.expiryDate).toLocaleDateString("fr-FR")}
                            </span>
                          ) : (
                            <span className="text-slate-400">Permanente</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              isValid
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : isExpiring
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : isExpired
                                ? "bg-rose-50 text-rose-700 border border-rose-200"
                                : "bg-sky-50 text-sky-700 border border-sky-200"
                            }`}
                          >
                            <span>
                              {isValid
                                ? "✓ Valide"
                                : isExpiring
                                ? "⏳ Expire bientôt"
                                : isExpired
                                ? "✕ Expiré"
                                : "🔍 À vérifier"}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isToVerify && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleValidateDoc(d.id, "VALID")}
                                  className="rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                                >
                                  Valider ✓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleValidateDoc(d.id, "REJECTED")}
                                  className="rounded-lg bg-rose-50 border border-rose-200 px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
                                >
                                  Rejeter ✕
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => alert(`Visualisation sécurisée du fichier : ${d.fileName}`)}
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                            >
                              Ouvrir ↗
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Upload Document */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">Déposer un Document de Preuve EUDR</h3>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpload} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Titre du document</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Titre Foncier Rural n° 849"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Catégorie réglementaire</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as DocumentCategory)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                  >
                    {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Fournisseur associé</label>
                  <input
                    type="text"
                    placeholder="Nom du fournisseur"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                  >
                  </input>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Autorité émettrice</label>
                  <input
                    type="text"
                    placeholder="ex: Ministère des Forêts"
                    value={issuingAuthority}
                    onChange={(e) => setIssuingAuthority(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">N° de référence officiel</label>
                  <input
                    type="text"
                    placeholder="ex: PERMIS-2026-99"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Date d'expiration (laisser vide si permanente)</label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Commentaires / Notes d'audit</label>
                <textarea
                  rows={2}
                  placeholder="Observations sur l'authenticité ou le périmètre de la preuve..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
                >
                  {uploading ? "Enregistrement..." : "Enregistrer le document"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
