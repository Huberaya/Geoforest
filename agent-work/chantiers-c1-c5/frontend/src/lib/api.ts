"use client";

// Helpers API centralisés — GeoForest Trace
// Tous les appels passent par cette fonction pour garantir le préfixe backend,
// l'en-tête Authorization, et la gestion uniforme des erreurs (dont 401 → logout).
//
// CHANTIER 3 : enrichi avec les endpoints fournisseurs, produits, lots, commodités EUDR.

// En mode same-origin, Next.js rewrites /api/v1 vers FastAPI côté serveur : le navigateur
// n'essaie jamais d'appeler localhost (qui désignerait l'ordinateur de l'utilisateur).
const API_BASE: string = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

// --------------------------------------------------------------------------- Types

export interface ApiErrorInfo {
  detail: string | Array<{ loc: (string | number)[]; msg: string }>;
}

export class ApiError extends Error {
  status: number;
  info: ApiErrorInfo;
  constructor(status: number, info: ApiErrorInfo, message?: string) {
    super(message || (typeof info.detail === "string" ? info.detail : `Erreur HTTP ${status}`));
    this.status = status;
    this.info = info;
  }
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
  user: UserPublic;
}

export interface UserPublic {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone?: string | null;
  role: "admin" | "compliance" | "procurement" | "analyst" | "viewer" | "supplier";
  locale: string;
  organization_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

// Alias historique pour compatibilité avec le reste du code
export type UserMe = UserPublic;

export interface OrganizationPublic {
  id: string;
  name: string;
  legal_name: string | null;
  siret: string | null;
  eori: string | null;
  address: string | null;
  country: string;
  contact_email: string | null;
  plan: string;
  is_active: boolean;
  created_at: string;
}

export type OrganizationMe = OrganizationPublic;

// --------------------------------------------------------------------------- Fetch générique

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface FetchOptions {
  method?: Method;
  body?: unknown;
  auth?: boolean;
  query?: Record<string, string | number | boolean | null | undefined>;
}

function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("gft_access_token");
}

export async function apiFetch<T = unknown>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { method = "GET", body, auth = false, query } = opts;

  let url = path.startsWith("http")
    ? path
    : path.startsWith("/api/v1")
      ? `${API_BASE.replace(/\/api\/v1$/, "")}${path}`
      : `${API_BASE}${path}`;

  if (query) {
    const qs = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== "") qs.append(k, String(v));
    });
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = { Accept: "application/json" };
  // Le navigateur doit fixer lui-même le boundary multipart de FormData.
  if (!isFormData) headers["Content-Type"] = "application/json";
  if (auth) {
    const t = getAccessToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
    cache: "no-store",
  });

  if (res.status === 401 && auth) {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("gft_access_token");
      window.localStorage.removeItem("gft_refresh_token");
      // Ne pas forcer la navigation si on est déjà sur /auth/login pour éviter boucles
      if (!window.location.pathname.startsWith("/auth")) {
        window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname)}`;
      }
    }
    throw new ApiError(401, { detail: "Session expirée" });
  }

  if (!res.ok) {
    let info: ApiErrorInfo = { detail: res.statusText };
    try {
      info = (await res.json()) as ApiErrorInfo;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, info);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function fetchAuthorizedDownload(path: string, fallbackFilename = "document"):
  Promise<{ blob: Blob; filename: string }> {
  const url = path.startsWith("http")
    ? path
    : path.startsWith("/api/v1")
      ? `${API_BASE.replace(/\/api\/v1$/, "")}${path}`
      : `${API_BASE}${path}`;
  const token = getAccessToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("gft_access_token");
      window.localStorage.removeItem("gft_refresh_token");
      if (!window.location.pathname.startsWith("/auth")) {
        window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname)}`;
      }
    }
    throw new ApiError(401, { detail: "Session expirée" });
  }
  if (!res.ok) {
    let info: ApiErrorInfo = { detail: res.statusText };
    try { info = (await res.json()) as ApiErrorInfo; } catch { /* réponse non JSON */ }
    throw new ApiError(res.status, info);
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  let filename = fallbackFilename;
  try { if (encoded) filename = decodeURIComponent(encoded); else if (plain) filename = plain; } catch { /* garder le nom par défaut */ }
  return { blob: await res.blob(), filename };
}

export function triggerDownload(file: { blob: Blob; filename: string }): void {
  if (typeof document === "undefined") return;
  const objectUrl = URL.createObjectURL(file.blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = file.filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

// --------------------------------------------------------------------------- Auth

function storeTokens(tokens: Tokens): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("gft_access_token", tokens.access_token);
  window.localStorage.setItem("gft_refresh_token", tokens.refresh_token);
  window.localStorage.setItem("gft_user", JSON.stringify(tokens.user));
}

export interface RegisterPayload {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  organization_name: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export async function login(emailOrPayload: string | LoginPayload, pwd?: string): Promise<Tokens> {
  const payload: LoginPayload =
    typeof emailOrPayload === "string"
      ? { email: emailOrPayload, password: pwd || "" }
      : emailOrPayload;
  const tokens = await apiFetch<Tokens>("/auth/login", { method: "POST", body: payload });
  storeTokens(tokens);
  return tokens;
}

export async function register(emailOrPayload: string | RegisterPayload, pwd?: string, org?: string): Promise<Tokens> {
  const payload: RegisterPayload =
    typeof emailOrPayload === "string"
      ? { email: emailOrPayload, password: pwd || "", organization_name: org || "" }
      : emailOrPayload;
  const tokens = await apiFetch<Tokens>("/auth/register", { method: "POST", body: payload });
  storeTokens(tokens);
  return tokens;
}

export async function logout(): Promise<{ ok: true }> {
  const refresh_token =
    typeof window !== "undefined" ? window.localStorage.getItem("gft_refresh_token") : null;
  try {
    return await apiFetch("/auth/logout", { method: "POST", body: { refresh_token } });
  } finally {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("gft_access_token");
      window.localStorage.removeItem("gft_refresh_token");
    }
  }
}

// --------------------------------------------------------------------------- Utilisateurs & Profil

export async function me(): Promise<UserPublic> {
  return apiFetch<UserPublic>("/users/me", { auth: true });
}

export async function apiVersion(): Promise<{
  name: string;
  version: string;
  environment: string;
  eudr_cutoff_date: string;
  eudr_application_lme: string;
  eudr_application_sme: string;
}> {
  return apiFetch("/version");
}

export async function myOrganization(): Promise<OrganizationPublic> {
  return apiFetch<OrganizationPublic>("/organizations/me", { auth: true });
}

export async function myProfile(): Promise<UserPublic> {
  return apiFetch<UserPublic>("/users/me", { auth: true });
}

export interface ProfileUpdatePayload {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  locale?: string;
}

export async function updateMyProfile(p: ProfileUpdatePayload): Promise<UserPublic> {
  return apiFetch<UserPublic>("/users/me", { method: "PATCH", body: p, auth: true });
}

export interface PasswordChangePayload {
  current_password: string;
  new_password: string;
}

export async function changeMyPassword(p: PasswordChangePayload): Promise<{ message: string }> {
  return apiFetch("/users/me/password", { method: "POST", body: p, auth: true });
}

export interface OrgUser extends UserPublic {
  is_supplier_user?: boolean;
}

export async function listOrgUsers(): Promise<OrgUser[]> {
  return apiFetch<OrgUser[]>("/users/", { auth: true });
}

export interface InviteUserPayload {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role: UserPublic["role"];
}

export async function inviteUser(p: InviteUserPayload): Promise<OrgUser> {
  return apiFetch<OrgUser>("/users/invite", { method: "POST", body: p, auth: true });
}

export async function deactivateUser(userId: string): Promise<{ message: string; user_id: string }> {
  return apiFetch(`/users/${userId}`, { method: "DELETE", auth: true });
}

// --------------------------------------------------------------------------- Dashboard
export interface AlertItem {
  id: string;
  level: "critical" | "warning" | "info" | "success";
  category: string;
  title: string;
  message: string | null;
  link: string | null;
  context: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export interface OnboardingStep {
  key: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
  available: boolean;
  available_chantier?: number;
}

export interface DashboardOverview {
  generated_at: string;
  kpis: {
    compliance_pct: number | null;
    suppliers_count: number;
    products_count: number;
    shipments_count: number;
    plots_total: number;
    plots_action_required: number;
    plots_analyzed: number;
    dds_ready: number;
    dds_incomplete: number;
    dds_at_risk: number;
    documents_expiring_soon: number;
    documents_missing: number;
    users_count: number;
    unread_alerts: number;
    critical_alerts: number;
    warning_alerts: number;
    alerts_by_level: { critical: number; warning: number; info: number; success: number };
  };
  recent_alerts: AlertItem[];
  upcoming_deadlines: unknown[];
  onboarding: { steps: OnboardingStep[]; total: number; completed: number };
  labels: Record<string, string>;
}

export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  return apiFetch<DashboardOverview>("/dashboard/overview", { auth: true });
}

export type AlertCategory = "onboarding" | "plot" | "document" | "supplier" | "analysis" | "dds" | "compliance" | "system";

export interface AlertListResult {
  items: AlertItem[];
  total: number;
  unread_count: number;
  limit: number;
  offset: number;
}

export interface AlertListParams {
  is_read?: boolean;
  level?: AlertItem["level"];
  category?: AlertCategory;
  limit?: number;
  offset?: number;
}

function announceAlertChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("gft:alerts-updated"));
}

export async function fetchAlerts(params: AlertListParams = {}): Promise<AlertListResult> {
  return apiFetch<AlertListResult>("/alerts", { auth: true, query: { ...params } });
}

export async function fetchUnreadAlertCount(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>("/alerts/unread-count", { auth: true });
}

export async function markAlertRead(alertId: string): Promise<{ ok: true }> {
  const result = await apiFetch<{ ok: true }>(`/alerts/${alertId}/read`, { method: "POST", auth: true });
  announceAlertChange();
  return result;
}

export async function markAlertUnread(alertId: string): Promise<{ ok: true }> {
  const result = await apiFetch<{ ok: true }>(`/alerts/${alertId}/unread`, { method: "POST", auth: true });
  announceAlertChange();
  return result;
}

export async function markAllAlertsRead(): Promise<{ ok: true; updated_count: number }> {
  const result = await apiFetch<{ ok: true; updated_count: number }>("/alerts/read-all", { method: "POST", auth: true });
  announceAlertChange();
  return result;
}

// --------------------------------------------------------------------------- Chantier 3 : Commodités EUDR
export interface Commodity {
  code: string;
  hs: string;
  label: string;
  category: "agricultural" | "forest" | "animal" | "derived";
}
export interface CommoditiesList {
  items: Commodity[];
  note: string;
}
export async function listCommodities(): Promise<CommoditiesList> {
  return apiFetch<CommoditiesList>("/commodities", { auth: true });
}

// --------------------------------------------------------------------------- Chantier 3 : Fournisseurs
export type SupplierType = "producer" | "cooperative" | "trader" | "processor" | "other";
export type SupplierStatus = "pending" | "active" | "suspended" | "archived";
export type SupplierRiskRating = "unknown" | "low" | "medium" | "high";

export interface Supplier {
  id: string;
  name: string;
  legal_name: string | null;
  supplier_type: SupplierType;
  status: SupplierStatus;
  country: string;
  address: string | null;
  region: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  tax_id: string | null;
  registration_number: string | null;
  eori: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  risk_rating: SupplierRiskRating;
  notes: string | null;
  portal_enabled: boolean;
  shipments_count: number;
  created_at: string;
  updated_at: string;
}
export interface SupplierList {
  items: Supplier[];
  total: number;
  by_status: Record<string, number>;
  by_risk: Record<string, number>;
}
export interface SupplierCreate {
  name: string;
  legal_name?: string | null;
  supplier_type: SupplierType;
  country: string;
  address?: string | null;
  region?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  tax_id?: string | null;
  registration_number?: string | null;
  eori?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}

export async function listSuppliers(params?: {
  q?: string;
  status?: SupplierStatus;
  risk?: SupplierRiskRating;
  country?: string;
  limit?: number;
  offset?: number;
}): Promise<SupplierList> {
  return apiFetch<SupplierList>("/suppliers", { auth: true, query: params });
}
export async function getSupplier(id: string): Promise<Supplier> {
  return apiFetch<Supplier>(`/suppliers/${id}`, { auth: true });
}
export async function createSupplier(p: SupplierCreate): Promise<Supplier> {
  return apiFetch<Supplier>("/suppliers", { method: "POST", body: p, auth: true });
}
export interface SupplierInviteResult extends Supplier {
  invitation_id: string;
  invitation_expires_at: string;
  delivery_status: "email_sent" | "ready_to_share" | "email_failed";
  invitation_url: string | null;
}

export async function inviteSupplier(id: string): Promise<SupplierInviteResult> {
  return apiFetch<SupplierInviteResult>(`/suppliers/${id}/invite`, { method: "POST", auth: true });
}

export interface SupplierCompletenessItem {
  key: string;
  label: string;
  complete: boolean;
}

export interface SupplierPortalProfile {
  supplier_id: string;
  name: string;
  legal_name: string | null;
  supplier_type: SupplierType;
  status: SupplierStatus;
  country: string;
  address: string | null;
  region: string | null;
  phone: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  tax_id: string | null;
  registration_number: string | null;
  eori: string | null;
  risk_rating: SupplierRiskRating;
  risk_label: string;
  completeness_percent: number;
  completeness_completed: number;
  completeness_total: number;
  completeness_items: SupplierCompletenessItem[];
}

export type SupplierPortalProfileUpdate = Pick<
  SupplierPortalProfile,
  | "legal_name"
  | "address"
  | "region"
  | "phone"
  | "contact_name"
  | "contact_phone"
  | "tax_id"
  | "registration_number"
  | "eori"
>;

export async function requestSupplierMagicLink(email: string): Promise<{ message: string }> {
  return apiFetch("/supplier-portal/request-link", { method: "POST", body: { email } });
}

export async function acceptSupplierMagicLink(token: string): Promise<Tokens> {
  const tokens = await apiFetch<Tokens>("/supplier-portal/accept-link", {
    method: "POST",
    body: { token },
  });
  storeTokens(tokens);
  return tokens;
}

export async function getSupplierPortalProfile(): Promise<SupplierPortalProfile> {
  return apiFetch<SupplierPortalProfile>("/supplier-portal/me", { auth: true });
}

export async function updateSupplierPortalProfile(
  payload: SupplierPortalProfileUpdate,
): Promise<SupplierPortalProfile> {
  return apiFetch<SupplierPortalProfile>("/supplier-portal/me", {
    method: "PATCH",
    body: payload,
    auth: true,
  });
}

// --------------------------------------------------------------------------- Chantier 7 : coffre documentaire
export interface DocumentVersionPublic {
  id: string;
  version_number: number;
  original_filename: string;
  content_type: string;
  file_size_bytes: number;
  sha256: string;
  scan_status: "clean" | "infected" | "error";
  scanned_at: string;
  created_at: string;
}

export interface DocumentLinkPublic {
  target_type: "supplier" | "shipment" | "product" | "plot";
  target_id: string;
  display_label: string | null;
}

export interface DocumentPublic {
  id: string;
  title: string;
  category: string;
  description: string | null;
  issuer_name: string | null;
  reference_number: string | null;
  issued_at: string | null;
  expires_at: string | null;
  country_code: string | null;
  commodity_code: string | null;
  review_status: "to_review" | "reviewed" | "follow_up";
  review_note: string | null;
  supplier_visible: boolean;
  is_archived: boolean;
  current_version_number: number;
  latest_version: DocumentVersionPublic | null;
  versions_count: number;
  links: DocumentLinkPublic[];
  created_at: string;
  updated_at: string;
}

export interface DocumentListPublic {
  items: DocumentPublic[];
  total: number;
  limit: number;
  offset: number;
}

export interface DocumentChecklistPublic {
  id: string;
  title: string;
  category: string;
  scope_type: "organization" | "supplier" | "shipment" | "product" | "plot";
  scope_id: string | null;
  country_code: string | null;
  commodity_code: string | null;
  source_title: string | null;
  source_url: string | null;
  note: string | null;
  state: "received" | "missing" | "expired" | "expiring_soon";
  matched_document_ids: string[];
  created_at: string;
}

export interface DocumentDownloadLink {
  url: string;
  presigned: boolean;
  expires_in: number | null;
}

export interface DocumentChecklistCreate {
  title: string;
  category: string;
  scope_type: "organization" | "supplier" | "shipment" | "product" | "plot";
  scope_id?: string | null;
  country_code?: string | null;
  commodity_code?: string | null;
  source_title?: string | null;
  source_url?: string | null;
  note?: string | null;
}

export async function listDocuments(params?: {
  q?: string; category?: string; scope_type?: "supplier" | "shipment" | "product" | "plot"; scope_id?: string;
  include_archived?: boolean; limit?: number; offset?: number;
}): Promise<DocumentListPublic> {
  return apiFetch<DocumentListPublic>("/documents", { auth: true, query: params });
}

export async function createDocument(form: FormData): Promise<DocumentPublic> {
  return apiFetch<DocumentPublic>("/documents", { method: "POST", body: form, auth: true });
}

export async function addDocumentVersion(documentId: string, file: File): Promise<DocumentPublic> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<DocumentPublic>(`/documents/${documentId}/versions`, { method: "POST", body: form, auth: true });
}

export async function updateDocument(documentId: string, payload: Partial<Pick<DocumentPublic,
  "title" | "category" | "description" | "issuer_name" | "reference_number" | "issued_at" |
  "expires_at" | "country_code" | "commodity_code" | "supplier_visible"
>>): Promise<DocumentPublic> {
  return apiFetch<DocumentPublic>(`/documents/${documentId}`, { method: "PATCH", body: payload, auth: true });
}

export async function reviewDocument(documentId: string, review_status: DocumentPublic["review_status"], review_note?: string): Promise<DocumentPublic> {
  return apiFetch<DocumentPublic>(`/documents/${documentId}/review`, { method: "POST", body: { review_status, review_note }, auth: true });
}

export async function archiveDocument(documentId: string): Promise<DocumentPublic> {
  return apiFetch<DocumentPublic>(`/documents/${documentId}/archive`, { method: "POST", auth: true });
}

export async function documentDownloadLink(documentId: string, versionId?: string): Promise<DocumentDownloadLink> {
  return apiFetch<DocumentDownloadLink>(`/documents/${documentId}/download-url`, {
    method: "POST", auth: true, query: { version_id: versionId },
  });
}

export async function listDocumentChecklist(params?: {
  scope_type?: DocumentChecklistPublic["scope_type"]; scope_id?: string;
}): Promise<DocumentChecklistPublic[]> {
  return apiFetch<DocumentChecklistPublic[]>("/documents/checklist", { auth: true, query: params });
}

export async function createDocumentChecklist(payload: DocumentChecklistCreate): Promise<DocumentChecklistPublic> {
  return apiFetch<DocumentChecklistPublic>("/documents/checklist", { method: "POST", body: payload, auth: true });
}

export async function deactivateDocumentChecklist(itemId: string): Promise<void> {
  return apiFetch<void>(`/documents/checklist/${itemId}`, { method: "DELETE", auth: true });
}

export async function supplierDocumentList(): Promise<DocumentListPublic> {
  return apiFetch<DocumentListPublic>("/supplier-portal/documents", { auth: true });
}

export async function createSupplierDocument(form: FormData): Promise<DocumentPublic> {
  return apiFetch<DocumentPublic>("/supplier-portal/documents", { method: "POST", body: form, auth: true });
}

export async function supplierDocumentDownloadLink(documentId: string, versionId?: string): Promise<DocumentDownloadLink> {
  return apiFetch<DocumentDownloadLink>(`/supplier-portal/documents/${documentId}/download-url`, {
    method: "POST", auth: true, query: { version_id: versionId },
  });
}

export function clearStoredAuth(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("gft_access_token");
  window.localStorage.removeItem("gft_refresh_token");
  window.localStorage.removeItem("gft_user");
}

// --------------------------------------------------------------------------- Chantier 3 : Produits
export type ProductStatus = "active" | "archived";
export interface Product {
  id: string;
  name: string;
  commodity: string;
  commodity_label: string | null;
  hs_code: string | null;
  description: string | null;
  status: ProductStatus;
  shipments_count: number;
  created_at: string;
  updated_at: string;
}
export interface ProductList {
  items: Product[];
  total: number;
}
export interface ProductCreate {
  name: string;
  commodity: string;
  hs_code?: string | null;
  description?: string | null;
}
export async function listProducts(params?: {
  q?: string;
  commodity?: string;
  status?: ProductStatus;
  limit?: number;
  offset?: number;
}): Promise<ProductList> {
  return apiFetch<ProductList>("/products", { auth: true, query: params });
}
export async function createProduct(p: ProductCreate): Promise<Product> {
  return apiFetch<Product>("/products", { method: "POST", body: p, auth: true });
}

// --------------------------------------------------------------------------- Chantier 3 : Lots
export type ShipmentStatus =
  | "draft"
  | "awaiting_data"
  | "analyzed"
  | "ready"
  | "rejected";
export interface Shipment {
  id: string;
  reference: string;
  supplier_id: string;
  product_id: string;
  supplier_name: string | null;
  product_name: string | null;
  commodity: string | null;
  quantity: number | null;
  unit: string | null;
  country_of_production: string | null;
  harvest_date: string | null;
  received_date: string | null;
  status: ShipmentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export interface ShipmentList {
  items: Shipment[];
  total: number;
  by_status: Record<string, number>;
}
export interface ShipmentCreate {
  reference: string;
  supplier_id: string;
  product_id: string;
  quantity?: number | null;
  unit?: string | null;
  country_of_production?: string | null;
  harvest_date?: string | null;
  received_date?: string | null;
  notes?: string | null;
}
export async function listShipments(params?: {
  q?: string;
  status?: ShipmentStatus;
  supplier_id?: string;
  product_id?: string;
  limit?: number;
  offset?: number;
}): Promise<ShipmentList> {
  return apiFetch<ShipmentList>("/shipments", { auth: true, query: params });
}
export async function createShipment(p: ShipmentCreate): Promise<Shipment> {
  return apiFetch<Shipment>("/shipments", { method: "POST", body: p, auth: true });
}

// --------------------------------------------------------------------------- Chantier 4 : Parcelles / audit trail
export type PlotSource = "manual" | "geojson" | "kml" | "csv" | "gps" | "supplier";
export type PlotStatus = "draft" | "validating" | "valid" | "invalid" | "analyzed" | "rejected";
export interface ValidationIssue {
  code: string;
  message: string;
}
export interface Plot {
  id: string;
  shipment_id: string;
  name: string | null;
  internal_ref: string | null;
  notes: string | null;
  source: PlotSource;
  geometry: Record<string, unknown> | null;
  geometry_type: string | null;
  area_ha: number | null;
  declared_area_ha: number | null;
  vertex_count: number | null;
  centroid: [number, number] | null;
  bbox: [number, number, number, number] | null;
  min_decimals_found: number | null;
  precision_ok: boolean | null;
  eudr_geometry_rule: "POINT_ALLOWED" | "POLYGON_REQUIRED" | null;
  harvest_year: number | null;
  acquired_at: string | null;
  gps_accuracy_m: number | null;
  status: PlotStatus;
  validation_errors: ValidationIssue[];
  validation_warnings: ValidationIssue[];
  created_at: string;
  updated_at: string;
  shipment_reference: string | null;
  supplier_name: string | null;
  product_name: string | null;
  geo_data_redacted?: boolean;
}
export interface PlotList {
  items: Plot[];
  total: number;
  total_area_ha: number;
  by_status: Record<string, number>;
  invalid_count: number;
  awaiting_validation_count: number;
}
export interface PlotCreate {
  shipment_id: string;
  name?: string | null;
  internal_ref?: string | null;
  notes?: string | null;
  source: PlotSource;
  geojson: Record<string, unknown>;
  declared_area_ha?: number | null;
  harvest_year?: number | null;
  acquired_at?: string | null;
  gps_accuracy_m?: number | null;
}
export interface PlotUpdate {
  name?: string | null;
  internal_ref?: string | null;
  notes?: string | null;
  source?: PlotSource | null;
  harvest_year?: number | null;
  declared_area_ha?: number | null;
  acquired_at?: string | null;
  gps_accuracy_m?: number | null;
  geojson?: Record<string, unknown> | null;
}
export interface PlotValidationResult {
  plot_id: string;
  valid: boolean;
  area_ha: number;
  vertex_count: number;
  geometry_type: string | null;
  min_decimals_found: number | null;
  precision_ok: boolean;
  eudr_geometry_rule: "POINT_ALLOWED" | "POLYGON_REQUIRED" | null;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}
export async function listPlots(params?: {
  shipment_id?: string;
  status?: PlotStatus;
  valid_only?: boolean;
  invalid_only?: boolean;
  limit?: number;
  offset?: number;
}): Promise<PlotList> {
  return apiFetch<PlotList>("/plots", { auth: true, query: params });
}
export async function getPlot(id: string): Promise<Plot> {
  return apiFetch<Plot>(`/plots/${id}`, { auth: true });
}
export async function createPlot(payload: PlotCreate): Promise<Plot> {
  return apiFetch<Plot>("/plots", { method: "POST", body: payload, auth: true });
}
export async function updatePlot(id: string, payload: PlotUpdate): Promise<Plot> {
  return apiFetch<Plot>(`/plots/${id}`, { method: "PATCH", body: payload, auth: true });
}
export async function validatePlot(id: string): Promise<PlotValidationResult> {
  return apiFetch<PlotValidationResult>(`/plots/${id}/validate`, { method: "POST", auth: true });
}
export async function deletePlot(id: string): Promise<void> {
  return apiFetch<void>(`/plots/${id}`, { method: "DELETE", auth: true });
}

// --------------------------------------------------------------------------- Chantier 5 : dépistage de perte de couvert arboré
export type DeforestationScreeningStatus =
  | "signal_post_2020"
  | "no_signal_observed"
  | "non_evaluable"
  | "source_unavailable";

export interface DeforestationCandidate {
  id: string;
  shipment_id: string;
  shipment_reference: string | null;
  supplier_name: string | null;
  product_name: string | null;
  name: string | null;
  internal_ref: string | null;
  geometry_type: string | null;
  area_ha: number | null;
  status: string;
  can_screen: boolean;
  screening_reason: string | null;
}

export interface DeforestationCandidateList {
  items: DeforestationCandidate[];
  total: number;
  limit: number;
  offset: number;
}

export interface AnnualLoss {
  year: number;
  area_ha_10pct: number;
  area_ha_30pct: number;
}

export interface DeforestationScreening {
  screening_id: string;
  plot_id: string;
  status: DeforestationScreeningStatus;
  review_required: boolean;
  source: string;
  dataset: string;
  dataset_version: string;
  api_spec_version: string;
  algorithm_version: string;
  cutoff_date: string;
  data_first_year: number;
  data_last_year: number;
  spatial_resolution_m: number;
  canopy_thresholds_pct: number[];
  plot_area_ha: number | null;
  geometry_sha256: string | null;
  loss_by_year: AnnualLoss[];
  pre_cutoff_loss_ha_10pct: number | null;
  post_cutoff_loss_ha_10pct: number | null;
  pre_cutoff_loss_ha_30pct: number | null;
  post_cutoff_loss_ha_30pct: number | null;
  post_cutoff_share_pct_10pct: number | null;
  first_post_cutoff_year_10pct: number | null;
  boundary_year_uncertainty: boolean;
  caveats: string[];
  message: string;
  error_code: string | null;
  analyzed_at: string;
}

export interface DeforestationScreeningHistory {
  items: DeforestationScreening[];
  total: number;
  limit: number;
  offset: number;
}

export async function listDeforestationCandidates(params?: {
  limit?: number;
  offset?: number;
}): Promise<DeforestationCandidateList> {
  return apiFetch<DeforestationCandidateList>("/deforestation-screenings/candidates", {
    auth: true,
    query: params,
  });
}

export async function runDeforestationScreening(plotId: string): Promise<DeforestationScreening> {
  return apiFetch<DeforestationScreening>(`/plots/${plotId}/deforestation-screenings`, {
    method: "POST",
    auth: true,
  });
}

export async function listDeforestationScreenings(
  plotId: string,
  params?: { limit?: number; offset?: number },
): Promise<DeforestationScreeningHistory> {
  return apiFetch<DeforestationScreeningHistory>(`/plots/${plotId}/deforestation-screenings`, {
    auth: true,
    query: params,
  });
}

export interface AuditEvent {
  id: string;
  organization_id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  object_type: string;
  object_id: string;
  occurred_at: string;
  ip_address: string | null;
  user_agent: string | null;
  previous_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}
export interface AuditEventList {
  items: AuditEvent[];
  total: number;
}
export async function listAuditEvents(params?: {
  object_type?: string;
  object_id?: string;
  action?: string;
  actor_user_id?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditEventList> {
  return apiFetch<AuditEventList>("/audit-log", { auth: true, query: params });
}

export type ReportDatasetKey = "suppliers" | "products" | "shipments" | "plots" | "documents" | "ddr";
export interface ReportDatasetSummary {
  key: ReportDatasetKey;
  label: string;
  total: number;
  status_counts: Record<string, number>;
  archived?: number;
  preparations_total?: number;
  preparation_status_counts?: Record<string, number>;
}
export interface ReportOverview {
  generated_at: string;
  datasets: ReportDatasetSummary[];
  notice: string;
}
export async function fetchReportOverview(): Promise<ReportOverview> {
  return apiFetch<ReportOverview>("/reports/overview", { auth: true });
}
export async function downloadOperationalReport(dataset: ReportDatasetKey): Promise<void> {
  const file = await fetchAuthorizedDownload(`/reports/export/${dataset}`, `rapport-${dataset}.csv`);
  triggerDownload(file);
}

// --------------------------------------------------------------------------- Alias historiques (utilisés par AuthContext et autres composants du chantier 1)
export async function fetchMe(): Promise<UserMe> {
  return me();
}
export async function fetchMyOrganization(): Promise<OrganizationMe> {
  return myOrganization();
}
export function getStoredUser(): UserMe | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("gft_user");
    return raw ? (JSON.parse(raw) as UserMe) : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------- Chantier Risques & DDR
export type EconomicRole = "operator" | "downstream_operator" | "trader" | "producer" | "unknown";
export type CompanySize = "micro" | "small" | "medium" | "large" | "individual" | "unknown";
export type AssessmentRoute = "full" | "article13_simplified" | "unknown";
export type ProductScopeStatus = "unknown" | "manual_review" | "confirmed_in_scope" | "not_in_scope";
export type RiskLevel = "low" | "standard" | "high" | "unknown";
export type EvidenceType = "deforestation_free" | "legality" | "origin" | "supply_chain" | "risk_context" | "mitigation" | "other";
export type FindingStatus = "not_assessed" | "not_relevant" | "no_concern_identified" | "concern_identified" | "inconclusive";
export type MitigationStatus = "planned" | "in_progress" | "completed" | "ineffective" | "cancelled";
export type RiskDecisionOutcome = "no_or_negligible" | "non_negligible";

export interface RiskCaseOrigin {
  id: string;
  supplier_id: string | null;
  plot_id: string | null;
  plot_reference: string | null;
  source_label: string | null;
  country_code: string | null;
  subdivision: string | null;
  location_description: string | null;
  production_period_start: string | null;
  production_period_end: string | null;
  quantity: number | null;
  unit: string | null;
  origin_confirmed: boolean;
  benchmark_level: RiskLevel;
  benchmark_version: string;
  benchmark_reason: string;
  notes: string | null;
}

export interface RiskEvidence {
  id: string;
  evidence_type: EvidenceType;
  title: string;
  summary: string;
  origin_id: string | null;
  document_version_id: string | null;
  document_id: string | null;
  document_version_number: number | null;
  document_sha256: string | null;
  source_url: string | null;
  source_reference: string | null;
  review_status: "to_review" | "reviewed" | "follow_up";
  review_note: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface RiskFinding {
  id: string;
  criterion: string;
  label: string;
  assessment_status: FindingStatus;
  rationale: string | null;
  source_note: string | null;
  evidence_ids: string[];
  assessed_by_user_id: string | null;
  assessed_at: string | null;
}

export interface RiskMitigationAction {
  id: string;
  title: string;
  description: string;
  responsible_name: string | null;
  due_date: string | null;
  status: MitigationStatus;
  effectiveness_assessed: boolean;
  effectiveness_note: string | null;
  evidence_id: string | null;
  finding_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RiskDecision {
  id: string;
  decision_number: number;
  outcome: RiskDecisionOutcome;
  rationale: string;
  conditions_or_follow_up: string | null;
  reference_version: string;
  actor_user_id: string | null;
  created_at: string;
}

export interface DeclarationPreparation {
  id: string;
  sequence_number: number;
  status: "incomplete" | "prepared_for_declaration" | "stale";
  internal_format_version: string;
  snapshot: Record<string, unknown>;
  missing_fields: string[];
  stale_reason: string | null;
  created_by_user_id: string | null;
  created_at: string;
}

export interface RiskCase {
  id: string;
  case_reference: string;
  shipment_id: string;
  shipment_reference: string;
  product_id: string;
  product_name: string;
  commodity: string;
  hs_code: string | null;
  supplier_id: string;
  supplier_name: string;
  quantity: number | null;
  unit: string | null;
  country_of_production: string | null;
  economic_role: EconomicRole;
  company_size: CompanySize;
  role_confirmed: boolean;
  role_confirmation_note: string | null;
  assessment_route: AssessmentRoute;
  article13_complexity_assessed: boolean;
  article13_mixing_assessed: boolean;
  article13_assessment_note: string | null;
  product_scope_status: ProductScopeStatus;
  product_scope_note: string | null;
  status: string;
  decision_state: "none" | "current" | "stale";
  decision_outcome: RiskDecisionOutcome | null;
  decision_rationale: string | null;
  decision_at: string | null;
  regulatory_reference_version: string;
  origins: RiskCaseOrigin[];
  evidence_items: RiskEvidence[];
  findings: RiskFinding[];
  mitigation_actions: RiskMitigationAction[];
  decisions: RiskDecision[];
  declaration_preparations: DeclarationPreparation[];
  created_at: string;
  updated_at: string;
}

export interface RiskCaseList {
  items: RiskCase[];
  total: number;
  by_status: Record<string, number>;
}

export interface RiskCaseCreate {
  shipment_id: string;
  economic_role?: EconomicRole;
  company_size?: CompanySize;
  role_confirmed?: boolean;
  role_confirmation_note?: string | null;
  assessment_route?: AssessmentRoute;
  article13_complexity_assessed?: boolean;
  article13_mixing_assessed?: boolean;
  article13_assessment_note?: string | null;
  product_scope_status?: ProductScopeStatus;
  product_scope_note?: string | null;
}

export interface RiskCasePatch {
  economic_role?: EconomicRole;
  company_size?: CompanySize;
  role_confirmed?: boolean;
  role_confirmation_note?: string | null;
  assessment_route?: AssessmentRoute;
  article13_complexity_assessed?: boolean;
  article13_mixing_assessed?: boolean;
  article13_assessment_note?: string | null;
  product_scope_status?: ProductScopeStatus;
  product_scope_note?: string | null;
}

export interface RiskOriginPayload {
  supplier_id?: string | null;
  plot_id?: string | null;
  source_label?: string | null;
  country_code?: string | null;
  subdivision?: string | null;
  location_description?: string | null;
  production_period_start?: string | null;
  production_period_end?: string | null;
  quantity?: number | null;
  unit?: string | null;
  origin_confirmed?: boolean;
  notes?: string | null;
}

export interface RiskEvidencePayload {
  evidence_type: EvidenceType;
  title: string;
  summary: string;
  origin_id?: string | null;
  document_version_id?: string | null;
  source_url?: string | null;
  source_reference?: string | null;
}

export interface RiskReferenceData {
  country_benchmark: {
    version: string;
    source_celex: string;
    source_url: string;
    low_risk_count: number;
    standard_risk_count: number;
    high_risk_count: number;
    low_risk_codes: string[];
    standard_risk_codes: string[];
    high_risk_codes: string[];
  };
  product_scope: {
    version: string;
    base_source_celex: string;
    base_source_url: string;
    amendment_source_celex: string;
    amendment_source_url: string;
    entry_count: number;
    application_large_operators_from: string;
    application_micro_small_operators_from: string;
    scheduled_product_additions_from: string;
    note: string;
  };
  product_scope_entries: Array<{
    commodity: string;
    code: string;
    code_system: string;
    is_ex: boolean;
    description: string;
    applies_from: string | null;
    source_celex: string;
    review_required: boolean;
  }>;
  product_scope_note: string;
  country_lookup_note: string;
  risk_criteria: Array<{ code: string; label: string }>;
  due_diligence_route_note: string;
  declaration_note: string;
}

export async function listRiskCases(params?: { status?: string; shipment_id?: string; limit?: number; offset?: number }): Promise<RiskCaseList> {
  return apiFetch<RiskCaseList>("/risk-cases", { auth: true, query: params });
}
export async function getRiskReferences(): Promise<RiskReferenceData> {
  return apiFetch<RiskReferenceData>("/risks/reference", { auth: true });
}
export async function createRiskCase(payload: RiskCaseCreate): Promise<RiskCase> {
  return apiFetch<RiskCase>("/risk-cases", { method: "POST", body: payload, auth: true });
}
export async function updateRiskCase(caseId: string, payload: RiskCasePatch): Promise<RiskCase> {
  return apiFetch<RiskCase>(`/risk-cases/${caseId}`, { method: "PATCH", body: payload, auth: true });
}
export async function addRiskOrigin(caseId: string, payload: RiskOriginPayload): Promise<RiskCase> {
  return apiFetch<RiskCase>(`/risk-cases/${caseId}/origins`, { method: "POST", body: payload, auth: true });
}
export async function updateRiskOrigin(caseId: string, originId: string, payload: RiskOriginPayload): Promise<RiskCase> {
  return apiFetch<RiskCase>(`/risk-cases/${caseId}/origins/${originId}`, { method: "PATCH", body: payload, auth: true });
}
export async function addRiskEvidence(caseId: string, payload: RiskEvidencePayload): Promise<RiskCase> {
  return apiFetch<RiskCase>(`/risk-cases/${caseId}/evidence`, { method: "POST", body: payload, auth: true });
}
export async function reviewRiskEvidence(caseId: string, evidenceId: string, payload: { review_status: "to_review" | "reviewed" | "follow_up"; review_note?: string | null }): Promise<RiskCase> {
  return apiFetch<RiskCase>(`/risk-cases/${caseId}/evidence/${evidenceId}`, { method: "PATCH", body: payload, auth: true });
}
export async function updateRiskFinding(caseId: string, criterion: string, payload: { assessment_status: FindingStatus; rationale?: string | null; source_note?: string | null; evidence_ids?: string[] }): Promise<RiskCase> {
  return apiFetch<RiskCase>(`/risk-cases/${caseId}/findings/${criterion}`, { method: "PATCH", body: payload, auth: true });
}
export async function addRiskMitigation(caseId: string, payload: { title: string; description: string; responsible_name?: string | null; due_date?: string | null; evidence_id?: string | null; finding_id?: string | null }): Promise<RiskCase> {
  return apiFetch<RiskCase>(`/risk-cases/${caseId}/mitigations`, { method: "POST", body: payload, auth: true });
}
export async function updateRiskMitigation(caseId: string, actionId: string, payload: { title?: string; description?: string; responsible_name?: string | null; due_date?: string | null; status?: MitigationStatus; effectiveness_assessed?: boolean; effectiveness_note?: string | null; evidence_id?: string | null; finding_id?: string | null }): Promise<RiskCase> {
  return apiFetch<RiskCase>(`/risk-cases/${caseId}/mitigations/${actionId}`, { method: "PATCH", body: payload, auth: true });
}
export async function recordRiskDecision(caseId: string, payload: { outcome: RiskDecisionOutcome; rationale: string; conditions_or_follow_up?: string | null }): Promise<RiskCase> {
  return apiFetch<RiskCase>(`/risk-cases/${caseId}/decisions`, { method: "POST", body: payload, auth: true });
}
export async function prepareDeclaration(caseId: string): Promise<RiskCase> {
  return apiFetch<RiskCase>(`/risk-cases/${caseId}/declaration-preparations`, { method: "POST", body: { confirm_internal_prefill_only: true }, auth: true });
}
export async function downloadDeclarationPreparation(caseId: string, preparationId: string): Promise<{ blob: Blob; filename: string }> {
  return fetchAuthorizedDownload(`/risk-cases/${caseId}/declaration-preparations/${preparationId}/export`, `preparation-interne-${caseId}.json`);
}
