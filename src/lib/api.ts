import type {
  AuditLogEntry,
  AuditSummary,
  AlertsResponse,
  AnalysesResponse,
  ComplianceDocument,
  ComplianceReport,
  ComplianceTask,
  DashboardSummary,
  DeclarationsResponse,
  DdsDetail,
  DiligenceStatement,
  ParcelAuditRequest,
  ParcelAuditResponse,
  Plot,
  PlotDetail,
  SettingsResponse,
  TracesExportRequest,
} from "@/lib/eudr/types";

/**
 * Client HTTP du dashboard.
 * - Par défaut : routes Next.js intégrées (`/api/v1/...`, persistance PostgreSQL).
 * - Si `NEXT_PUBLIC_API_URL` est défini (ex: http://localhost:8000) : backend FastAPI.
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function extractError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: unknown };
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail
        .map((d) => (typeof d === "object" && d && "msg" in d ? String((d as { msg: unknown }).msg) : JSON.stringify(d)))
        .join(" ; ");
    }
  } catch {
    /* corps non JSON */
  }
  return `Erreur HTTP ${response.status}`;
}

/**
 * Sérialise la requête d'audit.
 *
 * P1-16 — `JSON.stringify` efface les zéros terminaux des coordonnées
 * (`5.300000` → `5.3`). Le serveur mesurant la précision sur les littéraux
 * reçus, un fichier correctement géolocalisé était refusé dès qu'il passait par
 * le dépôt du navigateur. Quand le client dispose du GeoJSON **tel qu'écrit
 * dans le fichier**, c'est lui qui est envoyé ; sinon on retombe sur la
 * sérialisation usuelle et le serveur juge sur ce qu'il reçoit.
 */
/** Exposée pour les vérifications : le banc P1-16 l'exerce telle quelle. */
export function serialiserRequete(payload: ParcelAuditRequest): string {
  // `geojson` est écarté avec `geojsonText` : le laisser dans `reste`
  // produirait un corps à deux clés « geojson », dont la seconde — dégradée
  // par `JSON.stringify` — écraserait la première à l'analyse côté serveur.
  const { geojsonText, geojson, ...reste } = payload;
  if (!geojsonText) return JSON.stringify(reste);
  const autres = JSON.stringify(reste);
  // `autres` commence par "{" : on greffe la géométrie devant le reste, sans
  // passer par une sérialisation qui détruirait la précision.
  return autres.length > 2 ? `{"geojson":${geojsonText},${autres.slice(1)}` : `{"geojson":${geojsonText}}`;
}

export async function auditParcel(payload: ParcelAuditRequest): Promise<ParcelAuditResponse> {
  const response = await fetch(`${API_BASE}/api/v1/audit/parcel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: serialiserRequete(payload),
  });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as ParcelAuditResponse;
}

export async function listAudits(limit = 20): Promise<AuditSummary[]> {
  const response = await fetch(`${API_BASE}/api/v1/audits?limit=${limit}`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as AuditSummary[];
}

export async function getAudit(auditId: string): Promise<ParcelAuditResponse> {
  const response = await fetch(`${API_BASE}/api/v1/audits/${encodeURIComponent(auditId)}`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as ParcelAuditResponse;
}

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

export async function exportTraces(payload: TracesExportRequest): Promise<DownloadedFile> {
  const response = await fetch(`${API_BASE}/api/v1/export/traces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const fallback = `BROUILLON_DDS_${payload.audit_id.slice(0, 8)}.${payload.format ?? "xml"}`;
  return { blob: await response.blob(), filename: match?.[1] ?? fallback };
}

/**
 * Réponse d'un dépôt de dossier producteur (portail fournisseur).
 *
 * ⚠️ P0-06 : `transmission_status` vaut toujours `NOT_TRANSMITTED` tant qu'aucun
 * appel au SI EUDR n'a renvoyé d'accusé. L'interface doit afficher cet état.
 */
export interface SupplierSubmission {
  submission_id: string;
  draft_reference: string;
  transmission_status: "NOT_TRANSMITTED";
  transmission_notice: string;
  supplier_id: string;
  plot_id: string;
  document_id: string;
  created_at: string;
}

export interface SupplierSubmissionPayload {
  companyName: string;
  country: string;
  eori: string;
  contactName: string;
  phone: string;
  commodity: string;
  estimatedVolumeKg: number;
  plotName: string;
  plotCoordinates: string;
  plotAreaHa: number;
  documentTitle: string;
  documentExpiry: string;
}

export async function submitSupplierDossier(
  payload: SupplierSubmissionPayload,
): Promise<SupplierSubmission> {
  const response = await fetch(`${API_BASE}/api/v1/supplier-portal/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as SupplierSubmission;
}

export function triggerDownload(file: DownloadedFile): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------- P0-08 — écrans du parcours

export async function listPlots(params: Record<string, string> = {}): Promise<Plot[]> {
  const qs = new URLSearchParams(params).toString();
  const response = await fetch(`${API_BASE}/api/v1/plots${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as Plot[];
}

export async function getPlot(id: string): Promise<PlotDetail> {
  const response = await fetch(`${API_BASE}/api/v1/plots/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as PlotDetail;
}

/**
 * ⚠️ `geometry_text` transporte la géométrie **telle que saisie** : la faire
 * passer par un objet JSON rétrécirait `-5.500000` en `-5.5` et ferait rejeter
 * une géométrie conforme (P0-05).
 */
export async function createPlot(payload: Record<string, unknown>): Promise<Plot> {
  const response = await fetch(`${API_BASE}/api/v1/plots`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as Plot;
}

export async function deletePlot(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/plots/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
}

export async function listDocuments(params: Record<string, string> = {}): Promise<ComplianceDocument[]> {
  const qs = new URLSearchParams(params).toString();
  const response = await fetch(`${API_BASE}/api/v1/documents${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as ComplianceDocument[];
}

export async function createDocument(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE}/api/v1/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Déclare un document **et** dépose sa pièce en une requête.
 *
 * ⚠️ `FormData` est construit à la main plutôt qu'à partir d'un `<form>` : le
 * navigateur déduit alors le type MIME de l'extension du nom de fichier, ce qui
 * est précisément l'affirmation que le serveur doit vérifier. Le type n'est
 * donc PAS forcé côté client — le produit veut voir ce que le client déclare
 * spontanément, pour pouvoir le confronter aux octets.
 */
export async function createDocumentWithFile(
  payload: Record<string, string>,
  file: File,
): Promise<Record<string, unknown> & { warnings?: string[] }> {
  const form = new FormData();
  for (const [cle, valeur] of Object.entries(payload)) {
    if (valeur) form.append(cle, valeur);
  }
  form.append("file", file, file.name);
  const response = await fetch(`${API_BASE}/api/v1/documents`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as Record<string, unknown> & { warnings?: string[] };
}

/** Dépose une nouvelle version de la pièce d'un document existant. */
export async function addDocumentVersion(
  id: string,
  file: File,
): Promise<Record<string, unknown> & { warnings?: string[] }> {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(`${API_BASE}/api/v1/documents/${encodeURIComponent(id)}/file`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as Record<string, unknown> & { warnings?: string[] };
}

export interface DocumentVersion {
  version: number;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  mimeDetected: string;
  mimeDeclared: string | null;
  scanStatus: string;
  scanMoteur: string | null;
  uploadedBy: string | null;
  createdAt: string | null;
}

export async function listDocumentVersions(id: string): Promise<DocumentVersion[]> {
  const response = await fetch(
    `${API_BASE}/api/v1/documents/${encodeURIComponent(id)}/versions`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  const body = (await response.json()) as { items?: DocumentVersion[] };
  return body.items ?? [];
}

/**
 * Obtient une URL de téléchargement à durée limitée.
 *
 * ⚠️ L'URL est fabriquée à la demande et consommée immédiatement : elle
 * n'est jamais mise en cache, ni conservée dans l'état de l'écran. Une URL de
 * téléchargement est un droit d'accès temporaire ; la laisser traîner dans le
 * DOM ou dans l'historique du navigateur reviendrait à le prolonger.
 */
export async function getDocumentDownloadUrl(id: string, version?: number): Promise<string> {
  const qs = version ? `?version=${version}` : "";
  const response = await fetch(
    `${API_BASE}/api/v1/documents/${encodeURIComponent(id)}/url${qs}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  const body = (await response.json()) as { url?: string };
  if (typeof body.url !== "string") throw new ApiError(500, "URL de téléchargement absente.");
  return body.url;
}

export async function patchDocument(id: string, payload: Record<string, unknown>): Promise<ComplianceDocument> {
  const response = await fetch(`${API_BASE}/api/v1/documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as ComplianceDocument;
}

export async function listStatements(params: Record<string, string> = {}): Promise<DiligenceStatement[]> {
  const qs = new URLSearchParams(params).toString();
  const response = await fetch(`${API_BASE}/api/v1/due-diligence${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as DiligenceStatement[];
}

export async function createStatement(payload: Record<string, unknown>): Promise<DiligenceStatement> {
  const response = await fetch(`${API_BASE}/api/v1/due-diligence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as DiligenceStatement;
}

export async function getStatement(id: string): Promise<DdsDetail> {
  const response = await fetch(`${API_BASE}/api/v1/due-diligence/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as DdsDetail;
}

export async function patchStatement(id: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE}/api/v1/due-diligence/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as Record<string, unknown>;
}

export async function listTasks(params: Record<string, string> = {}): Promise<ComplianceTask[]> {
  const qs = new URLSearchParams(params).toString();
  const response = await fetch(`${API_BASE}/api/v1/risks${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as ComplianceTask[];
}

export async function createTask(payload: Record<string, unknown>): Promise<ComplianceTask> {
  const response = await fetch(`${API_BASE}/api/v1/risks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as ComplianceTask;
}

export async function patchTask(id: string, payload: Record<string, unknown>): Promise<ComplianceTask> {
  const response = await fetch(`${API_BASE}/api/v1/risks`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...payload }),
  });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as ComplianceTask;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const response = await fetch(`${API_BASE}/api/v1/dashboard/summary`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as DashboardSummary;
}

export async function getAlerts(): Promise<AlertsResponse> {
  const response = await fetch(`${API_BASE}/api/v1/alerts`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as AlertsResponse;
}

export async function getAnalyses(): Promise<AnalysesResponse> {
  const response = await fetch(`${API_BASE}/api/v1/analyses`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as AnalysesResponse;
}

export async function getDeclarations(): Promise<DeclarationsResponse> {
  const response = await fetch(`${API_BASE}/api/v1/declarations`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as DeclarationsResponse;
}

export async function getReport(): Promise<ComplianceReport> {
  const response = await fetch(`${API_BASE}/api/v1/reports`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as ComplianceReport;
}

export async function getAuditLogs(): Promise<AuditLogEntry[]> {
  const response = await fetch(`${API_BASE}/api/v1/audit-logs`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as AuditLogEntry[];
}

export async function getSettings(): Promise<SettingsResponse> {
  const response = await fetch(`${API_BASE}/api/v1/settings`, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as SettingsResponse;
}

export async function patchSettings(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE}/api/v1/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new ApiError(response.status, await extractError(response));
  return (await response.json()) as Record<string, unknown>;
}
