"use client";

import { Badge, Card, EmptyState, ErrorState, LoadingState, Metric, PageHeader } from "@/components/PageShell";
import {
  ApiError,
  addDocumentVersion,
  createDocument,
  createDocumentWithFile,
  getDocumentDownloadUrl,
  listDocumentVersions,
  listDocuments,
  patchDocument,
  type DocumentVersion,
} from "@/lib/api";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  type ComplianceDocument,
  type DocumentCategory,
} from "@/lib/eudr/types";
import { useEffect, useState } from "react";

const TONES: Record<ComplianceDocument["status"], string> = {
  VALID: "green",
  EXPIRED: "red",
  TO_VERIFY: "amber",
  REJECTED: "red",
};

export default function DocumentsPage() {
  const [docs, setDocs] = useState<ComplianceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    category: "LAND_TENURE" as DocumentCategory,
    expiryDate: "",
    supplierId: "",
    notes: "",
  });
  // Pièce choisie dans le formulaire de création. `null` = déclaration sans
  // pièce, ce qui reste un état légal : la pièce arrive parfois plus tard.
  const [fichier, setFichier] = useState<File | null>(null);
  const [avertissements, setAvertissements] = useState<string[]>([]);
  const [versionsOuvertes, setVersionsOuvertes] = useState<string | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [depot, setDepot] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setDocs(await listDocuments(status ? { status } : {}));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Impossible de charger les documents.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Différé d'un micro-tâche : l'effet ne déclenche pas de rendu
    // en cascade (règle react-hooks/set-state-in-effect).
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
     
  }, [status]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const commun = {
        title: form.title,
        category: form.category,
        expiryDate: form.expiryDate || undefined,
        supplierId: form.supplierId || undefined,
        notes: form.notes || undefined,
      };
      const created = fichier
        ? await createDocumentWithFile(
            Object.fromEntries(
              Object.entries(commun).filter(([, v]) => v !== undefined),
            ) as Record<string, string>,
            fichier,
          )
        : await createDocument(commun);
      setNotice(typeof created.notice === "string" ? created.notice : null);
      setAvertissements(Array.isArray(created.warnings) ? created.warnings : []);
      setForm({ title: "", category: form.category, expiryDate: "", supplierId: "", notes: "" });
      setFichier(null);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enregistrement impossible : le document n'a pas été créé.");
    } finally {
      setSaving(false);
    }
  };

  const setDocStatus = async (doc: ComplianceDocument, next: ComplianceDocument["status"]) => {
    try {
      await patchDocument(doc.id, { status: next });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mise à jour impossible.");
    }
  };

  /**
   * Télécharge la pièce courante.
   *
   * ⚠️ L'URL est demandée **au moment du clic** et consommée aussitôt. Elle
   * expire en quelques minutes : la fabriquer au chargement de la page
   * produirait des liens morts, et la conserver dans l'état de l'écran
   * reviendrait à prolonger un droit d'accès au-delà de sa durée.
   */
  const telecharger = async (doc: ComplianceDocument) => {
    setError(null);
    try {
      const url = await getDocumentDownloadUrl(doc.id);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Téléchargement impossible.");
    }
  };

  const deposerVersion = async (doc: ComplianceDocument, file: File) => {
    setDepot(doc.id);
    setError(null);
    try {
      const res = await addDocumentVersion(doc.id, file);
      setAvertissements(Array.isArray(res.warnings) ? res.warnings : []);
      setNotice(`Version ${String(res.version ?? "?")} déposée. L'ancienne version est conservée.`);
      await load();
      if (versionsOuvertes === doc.id) await ouvrirVersions(doc);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Dépôt impossible.");
    } finally {
      setDepot(null);
    }
  };

  const ouvrirVersions = async (doc: ComplianceDocument) => {
    setError(null);
    try {
      const lignes = await listDocumentVersions(doc.id);
      setVersions(lignes);
      setVersionsOuvertes(versionsOuvertes === doc.id ? null : doc.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Historique indisponible.");
    }
  };

  const expiring = docs.filter((d) => d.daysUntilExpiry !== null && d.daysUntilExpiry <= 60).length;
  const expired = docs.filter((d) => d.daysUntilExpiry !== null && d.daysUntilExpiry < 0).length;
  const sansAnalyse = docs.filter((d) => d.hasFile && d.scanStatus === "NOT_SCANNED").length;

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Titres fonciers, permis, quitus et certifications — métadonnées et suivi d'expiration."
        actions={
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            {showForm ? "Annuler" : "+ Ajouter un document"}
          </button>
        }
      />

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3.5 text-[11px] leading-relaxed text-slate-500">
        Les pièces déposées sont <strong>réellement stockées</strong> : le produit calcule leur
        condensat SHA-256, lit leur type dans les octets (et non dans le nom du fichier) et conserve
        chaque version. Le téléchargement passe par une URL signée à durée limitée, valable pour
        votre organisation seulement.{" "}
        {sansAnalyse > 0 && (
          <span className="text-amber-700">
            {" "}
            ⚠️ {sansAnalyse} pièce(s) n&apos;ont pas été analysées faute de moteur antivirus
            configuré : leur innocuité est inconnue, elle ne doit pas être présentée comme acquise.
          </span>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Documents" value={docs.length} />
        <Metric label="À vérifier" value={docs.filter((d) => d.status === "TO_VERIFY").length} />
        <Metric label="Échus" value={expired} />
        <Metric label="Échéance ≤ 60 j" value={expiring} />
        <Metric label="Avec pièce" value={docs.filter((d) => d.hasFile === true).length} />
      </div>

      {showForm && (
        <Card className="mb-4 p-4">
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700">Intitulé *</label>
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Catégorie *</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as DocumentCategory })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
              >
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {DOCUMENT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Date d&apos;expiration</label>
              <input
                type="date"
                value={form.expiryDate}
                onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700">Notes</label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Pièce justificative (facultatif)
              </label>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.doc,.docx,.xls,.xlsx,.odt,.ods,.rtf,.txt,.csv"
                onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
              />
              <p className="mt-1 text-[10px] text-slate-400">
                {fichier
                  ? `${fichier.name} · ${(fichier.size / 1024).toFixed(0)} Kio`
                  : "Sans pièce, le document n'est qu'une déclaration : aucun fichier ne sera joint au dossier."}
              </p>
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {saving ? "Enregistrement…" : fichier ? "Déposer la pièce" : "Enregistrer sans pièce"}
              </button>
            </div>
          </form>
        </Card>
      )}

      {notice && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          ⚠️ {notice}
        </div>
      )}
      {avertissements.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="font-semibold">Signalements au dépôt :</div>
          <ul className="mt-1 list-disc pl-4">
            {avertissements.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setAvertissements([])}
            className="mt-2 text-[10px] underline"
          >
            Masquer
          </button>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      <Card>
        <div className="border-b border-slate-100 p-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
          >
            <option value="">Tous les statuts</option>
            <option value="VALID">Valide</option>
            <option value="TO_VERIFY">À vérifier</option>
            <option value="EXPIRED">Expiré</option>
            <option value="REJECTED">Rejeté</option>
          </select>
        </div>

        {loading ? (
          <LoadingState />
        ) : docs.length === 0 ? (
          <EmptyState
            title="Aucun document enregistré"
            message="Les pièces de légalité (titre foncier, permis de récolte, quitus fiscal, conformité sociale, certification) sont nécessaires à la constitution d'un dossier de diligence raisonnée."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2">Document</th>
                  <th className="px-4 py-2">Catégorie</th>
                  <th className="px-4 py-2">Échéance</th>
                  <th className="px-4 py-2">Statut</th>
                  <th className="px-4 py-2">Pièce</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {docs.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-800">{d.title}</div>
                      <div className="text-[10px] text-slate-400">
                        {d.supplierName ?? "—"}
                        {d.plotName ? ` · ${d.plotName}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {DOCUMENT_CATEGORY_LABELS[d.category] ?? d.category}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-700">
                      {d.expiryDate ?? "—"}
                      {d.daysUntilExpiry !== null && (
                        <span className={`ml-1 text-[10px] ${d.daysUntilExpiry < 0 ? "text-red-600" : d.daysUntilExpiry <= 60 ? "text-amber-700" : "text-slate-400"}`}>
                          ({d.daysUntilExpiry < 0 ? `échu depuis ${-d.daysUntilExpiry} j` : `${d.daysUntilExpiry} j`})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={TONES[d.status]}>{d.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      {d.hasFile ? (
                        <div className="text-[10px] leading-relaxed">
                          <div className="font-mono text-slate-700">{d.fileName ?? "pièce"}</div>
                          <div className="text-slate-400">
                            {typeof d.sizeBytes === "number"
                              ? `${(d.sizeBytes / 1024).toFixed(0)} Kio`
                              : "—"}
                            {" · "}
                            {d.mimeDetected ?? "type inconnu"}
                          </div>
                          {d.sha256 && (
                            <div className="text-slate-400" title={d.sha256}>
                              SHA-256 {d.sha256.slice(0, 12)}…
                              {d.mimeMismatch === true && (
                                <span className="ml-1 text-amber-700">type déclaré ≠ type réel</span>
                              )}
                            </div>
                          )}
                          <div
                            className={
                              d.scanStatus === "CLEAN"
                                ? "text-emerald-700"
                                : d.scanStatus === "INFECTED"
                                  ? "text-red-700"
                                  : "text-amber-700"
                            }
                          >
                            {d.scanStatus === "CLEAN"
                              ? "Analysé : sain"
                              : d.scanStatus === "INFECTED"
                                ? "Analysé : infecté"
                                : "Non analysé (aucun moteur configuré)"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400">
                          Aucune pièce — déclaration seule
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <select
                          value={d.status}
                          onChange={(e) => void setDocStatus(d, e.target.value as ComplianceDocument["status"])}
                          className="rounded border border-slate-200 px-2 py-1 text-[10px] outline-none focus:border-emerald-500"
                        >
                          <option value="TO_VERIFY">À vérifier</option>
                          <option value="VALID">Valide</option>
                          <option value="EXPIRED">Expiré</option>
                          <option value="REJECTED">Rejeté</option>
                        </select>
                        <div className="flex gap-1">
                          {d.hasFile && (
                            <button
                              type="button"
                              onClick={() => void telecharger(d)}
                              className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-50"
                            >
                              Télécharger
                            </button>
                          )}
                          <label className="cursor-pointer rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-50">
                            {depot === d.id ? "Dépôt…" : d.hasFile ? "Nouvelle version" : "Joindre"}
                            <input
                              type="file"
                              className="hidden"
                              disabled={depot === d.id}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = "";
                                if (f) void deposerVersion(d, f);
                              }}
                            />
                          </label>
                          {d.hasFile && (
                            <button
                              type="button"
                              onClick={() => void ouvrirVersions(d)}
                              className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-50"
                            >
                              {versionsOuvertes === d.id ? "Masquer" : "Historique"}
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {versionsOuvertes && versions.length > 0 && (
        <Card className="mt-4 p-4">
          <div className="mb-2 text-xs font-semibold text-slate-800">
            Historique des versions
            <span className="ml-2 font-normal text-[10px] text-slate-400">
              {versions.length} version(s) · la plus récente d&apos;abord
            </span>
          </div>
          <table className="w-full text-left text-[10px]">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1">Version</th>
                <th className="py-1">Fichier</th>
                <th className="py-1">SHA-256</th>
                <th className="py-1">Taille</th>
                <th className="py-1">Type réel</th>
                <th className="py-1">Analyse</th>
                <th className="py-1">Déposé le</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-slate-600">
              {versions.map((v) => (
                <tr key={v.version}>
                  <td className="py-1">v{v.version}</td>
                  <td className="py-1">{v.fileName}</td>
                  <td className="py-1" title={v.sha256}>
                    {v.sha256.slice(0, 16)}…
                  </td>
                  <td className="py-1">{(v.sizeBytes / 1024).toFixed(0)} Kio</td>
                  <td className="py-1">{v.mimeDetected}</td>
                  <td
                    className={
                      v.scanStatus === "CLEAN"
                        ? "py-1 text-emerald-700"
                        : v.scanStatus === "INFECTED"
                          ? "py-1 text-red-700"
                          : "py-1 text-amber-700"
                    }
                  >
                    {v.scanStatus === "CLEAN"
                      ? "sain"
                      : v.scanStatus === "INFECTED"
                        ? "infecté"
                        : "non analysé"}
                  </td>
                  <td className="py-1">
                    {v.createdAt ? new Date(v.createdAt).toLocaleString("fr-FR") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      </Card>
    </div>
  );
}
