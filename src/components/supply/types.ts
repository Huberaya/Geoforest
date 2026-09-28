export type Supplier = {
  id: string;
  reference: string;
  name: string;
  country: string | null;
  address: string;
  email: string;
  legal_type: string;
  registration_id: string;
  notes: string;
  version: number;
  archived_at: string | null;
  missing_fields?: string[];
  lot_count?: number;
  collection_status?: string | null;
};
export type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  version: number;
};
export type Product = {
  id: string;
  reference: string;
  name: string;
  hs_code: string;
  description: string;
  commodities: string[];
  supplier_ids: string[];
  version: number;
  archived_at: string | null;
};
export type Lot = {
  id: string;
  reference: string;
  supplier_id: string;
  product_id: string;
  supplier_name?: string;
  product_name?: string;
  quantity: string;
  unit: string;
  origin_country: string | null;
  production_start: string | null;
  production_end: string | null;
  source_collection_id: string | null;
  notes: string;
  version: number;
  archived_at: string | null;
  missing_fields?: string[];
};
export type CompanyDraft = {
  name: string;
  country: string | null;
  address: string;
  email: string;
  contact_name: string;
  phone: string;
  legal_type: string;
};
export type DeclaredProduct = {
  name: string;
  commodity: string | null;
  quantity: string | null;
  unit: string;
  origin_country: string | null;
};
export type Payload = { company: CompanyDraft; products: DeclaredProduct[] };
export type Collection = {
  id: string;
  version: number;
  status: string;
  payload: Payload;
  submitted_at: string | null;
  review_note: string;
  completeness: { percent: number; missing: string[]; scope: string };
};
export type Invitation = {
  id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  url?: string;
};
export type SupplierDetail = Supplier & {
  contacts: Contact[];
  collections: Collection[];
  invitations: Invitation[];
  product_ids: string[];
};
export type Catalogue = {
  countries: { code: string; name: string }[];
  commodities: { code: string; label: string }[];
  units: string[];
};
export type Api = (
  path: string,
  method?: string,
  body?: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;
export const statusLabels: Record<string, string> = {
  DRAFT: "Collecte en cours",
  SUBMITTED: "À revoir",
  REVIEWED: "Collecte revue",
  CHANGES_REQUESTED: "Corrections demandées",
};
export function countryName(code: string | null) {
  return code
    ? new Intl.DisplayNames(["fr"], { type: "region" }).of(code) || code
    : "Non renseigné";
}
export function errorText(data: unknown): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data))
    return data
      .map((e) => {
        const v = e as { loc?: string[]; msg?: string };
        return `${v.loc?.filter((x) => x !== "body").join(".") || "Champ"} : ${v.msg || "invalide"}`;
      })
      .join(" · ");
  if (data && typeof data === "object") {
    const d = data as {
      message?: string;
      rows?: { line: number; fields: string[] }[];
      missing?: string[];
    };
    return (
      (d.message || "Opération impossible") +
      (d.rows?.length
        ? " — lignes " +
          d.rows
            .map((r) => r.line + " (" + r.fields.join(", ") + ")")
            .join("; ")
        : "") +
      (d.missing?.length ? " : " + d.missing.join(", ") : "")
    );
  }
  return "Le service est indisponible. Réessayez.";
}
