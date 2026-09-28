/** Contrats de données GeoForest Trace — miroir strict des schémas Pydantic du backend. */

export type RiskLevel = "LOW" | "STANDARD" | "HIGH";
export type AuditStatus = "COMPLIANT" | "NON_COMPLIANT" | "INVALID_GEOMETRY";
export type GeometryRule = "POINT_ALLOWED" | "POLYGON_REQUIRED";

export type Commodity = "coffee" | "cocoa" | "palm_oil" | "rubber" | "soya" | "cattle" | "wood";

export const COMMODITIES: ReadonlyArray<{ value: Commodity; label: string; hsCode: string }> = [
  { value: "coffee", label: "Café (Coffea spp.)", hsCode: "0901" },
  { value: "cocoa", label: "Cacao (Theobroma cacao)", hsCode: "1801" },
  { value: "palm_oil", label: "Huile de palme (Elaeis guineensis)", hsCode: "1511" },
  { value: "rubber", label: "Caoutchouc naturel (Hevea brasiliensis)", hsCode: "4001" },
  { value: "soya", label: "Soja (Glycine max)", hsCode: "1201" },
  { value: "cattle", label: "Bovins (Bos taurus)", hsCode: "0102" },
  { value: "wood", label: "Bois (bois bruts)", hsCode: "4403" },
];

export const COMMODITY_HS_CODES: Record<Commodity, string> = Object.fromEntries(
  COMMODITIES.map((c) => [c.value, c.hsCode]),
) as Record<Commodity, string>;

export const COMMODITY_LABELS: Record<Commodity, string> = Object.fromEntries(
  COMMODITIES.map((c) => [c.value, c.label]),
) as Record<Commodity, string>;

export const EUDR_CUTOFF_DATE = "2020-12-31";
export const EUDR_CUTOFF_YEAR = 2020;
export const EUDR_POLYGON_THRESHOLD_HA = 4;
export const EUDR_MIN_COORD_DECIMALS = 6;

export function isCommodity(value: unknown): value is Commodity {
  return typeof value === "string" && COMMODITIES.some((c) => c.value === value);
}

// ---------------------------------------------------------------- GeoJSON (sous-ensemble)
export type Position = number[];

export interface PointGeometry {
  type: "Point";
  coordinates: Position;
}
export interface MultiPointGeometry {
  type: "MultiPoint";
  coordinates: Position[];
}
export interface PolygonGeometry {
  type: "Polygon";
  coordinates: Position[][];
}
export interface MultiPolygonGeometry {
  type: "MultiPolygon";
  coordinates: Position[][][];
}
export type SupportedGeometry = PointGeometry | MultiPointGeometry | PolygonGeometry | MultiPolygonGeometry;

export interface GeoJsonFeature {
  type: "Feature";
  properties?: Record<string, unknown> | null;
  geometry: Record<string, unknown> | null;
}
export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}
export type GeoJsonInput = Record<string, unknown>;

// ---------------------------------------------------------------- Opérateur
export interface OperatorInfo {
  name: string;
  eori: string;
  address?: string | null;
  country?: string;
  email?: string | null;
}

// ---------------------------------------------------------------- Audit
export interface ParcelAuditRequest {
  geojson: GeoJsonInput;
  commodity: Commodity;
  harvest_date: string;
  operator?: OperatorInfo | null;
  declared_area_ha?: number | null;
  parcel_reference?: string | null;
}

export interface ValidationIssue {
  code: string;
  message: string;
}

export interface GeometryValidationResult {
  valid: boolean;
  geometry_type: string | null;
  area_ha: number;
  vertex_count: number;
  centroid: [number, number] | null;
  bbox: [number, number, number, number] | null;
  precision_ok: boolean;
  min_decimals_found: number | null;
  eudr_geometry_rule: GeometryRule;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  normalized_geometry: SupportedGeometry | null;
}

export interface SatelliteCheckResult {
  compliant: boolean;
  loss_year: number | null;
  confidence_score: number;
  risk_level: RiskLevel;
  country_code: string;
  country_name: string;
  country_risk: RiskLevel;
  source: string;
  loss_area_ha: number;
  tree_cover_2000_pct: number | null;
  details: string;
}

export interface ParcelAuditResponse {
  audit_id: string;
  created_at: string;
  status: AuditStatus;
  commodity: Commodity;
  hs_code: string;
  harvest_date: string;
  validation: GeometryValidationResult;
  satellite: SatelliteCheckResult | null;
  eudr_cutoff_date: string;
  summary: string;
}

export interface AuditSummary {
  audit_id: string;
  created_at: string;
  operator_name: string;
  commodity: string;
  hs_code: string;
  harvest_date: string;
  area_ha: number;
  geometry_type: string;
  status: AuditStatus;
  compliant: boolean;
  loss_year: number | null;
  risk_level: RiskLevel;
  country_code: string;
}

// ---------------------------------------------------------------- Export TRACES
export type TracesFormat = "xml" | "json";
export type ActivityType = "IMPORT" | "EXPORT" | "DOMESTIC";

export interface TracesExportRequest {
  audit_id: string;
  operator?: OperatorInfo | null;
  format?: TracesFormat;
  activity_type?: ActivityType;
  net_weight_kg?: number | null;
  internal_reference?: string | null;
  country_of_activity?: string;
}
