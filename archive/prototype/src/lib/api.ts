import type { AuditSummary, ParcelAuditRequest, ParcelAuditResponse, TracesExportRequest } from "@/lib/eudr/types";

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

export async function auditParcel(payload: ParcelAuditRequest): Promise<ParcelAuditResponse> {
  const response = await fetch(`${API_BASE}/api/v1/audit/parcel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
  const fallback = `DDS_${payload.audit_id.slice(0, 8)}.${payload.format ?? "xml"}`;
  return { blob: await response.blob(), filename: match?.[1] ?? fallback };
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
