/** Contrats de données GeoForest Trace — miroir strict des schémas Pydantic du backend & PostgreSQL. */

export type RiskLevel = "LOW" | "STANDARD" | "HIGH" | "CRITICAL";
export type AuditStatus = "COMPLIANT" | "NON_COMPLIANT" | "INVALID_GEOMETRY" | "WARNING";
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

// ---------------------------------------------------------------- Fournisseurs
export interface Supplier {
  id: string;
  name: string;
  eori: string | null;
  country: string;
  commodity: Commodity;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  completenessScore: number;
  riskLevel: RiskLevel;
  status: "ACTIVE" | "PENDING_INVITE" | "SUSPENDED";
  plotsCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------- Produits
export interface Product {
  id: string;
  name: string;
  sku: string | null;
  commodity: Commodity;
  hsCode: string;
  countryOfOrigin: string;
  annualVolumeKg: number;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
}

// ---------------------------------------------------------------- Lots & Expéditions
export interface Shipment {
  id: string;
  reference: string;
  supplierId: string | null;
  supplierName?: string;
  productId: string | null;
  productName?: string;
  commodity?: Commodity;
  netWeightKg: number;
  harvestDate: string;
  customsDeclarationRef: string | null;
  status: "IN_PREPARATION" | "AUDITED" | "READY" | "SHIPPED";
  plotsCount?: number;
  createdAt: string;
}

// ---------------------------------------------------------------- Parcelles
export interface Plot {
  id: string;
  name: string;
  reference: string | null;
  supplierId: string | null;
  supplierName?: string;
  commodity: Commodity;
  countryCode: string;
  geometry: SupportedGeometry | GeoJsonInput;
  geometryType: string;
  areaHa: number;
  vertexCount: number;
  centroidLon: number;
  centroidLat: number;
  status: AuditStatus | "PENDING";
  riskLevel: RiskLevel;
  lossYear: number | null;
  confidenceScore: number;
  lastAuditAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- Moteur Géospatial (Chantier 4)
export interface SatelliteSource {
  id: string;
  name: string;
  provider: string;
  resolution: string;
  cadence: string;
  status: "OPERATIONAL" | "DEGRADED" | "MAINTENANCE";
  description: string;
}

export interface HansenLayerResult {
  source: string;
  resolution_m: number;
  canopy_threshold_pct: number;
  loss_year: number | null;
  loss_area_ha: number;
  loss_detected_post_2020: boolean;
  tree_cover_2000_pct: number;
}

export interface Sentinel2LayerResult {
  source: string;
  resolution_m: number;
  baseline_ndvi_2020: number;
  current_ndvi: number;
  delta_ndvi: number;
  vegetation_loss_detected: boolean;
  cloud_cover_pct: number;
  observation_period: string;
}

export interface EsaWorldCoverLayerResult {
  source: string;
  resolution_m: number;
  tree_cover_pct: number;
  cropland_pct: number;
  shrubland_pct: number;
  other_pct: number;
  dominant_land_cover: string;
}

export interface BufferEncroachmentResult {
  buffer_distance_m: number;
  encroachment_detected: boolean;
  buffer_loss_area_ha: number;
  buffer_alerts_count: number;
  buffer_risk_level: RiskLevel;
}

export interface GeospatialLayers {
  hansen: HansenLayerResult;
  sentinel2: Sentinel2LayerResult;
  esa_worldcover: EsaWorldCoverLayerResult;
  buffer_encroachment: BufferEncroachmentResult;
}

export interface SatelliteAnalysis {
  analysis_id: string;
  created_at: string;
  plot_id?: string;
  plot_name: string;
  commodity: Commodity;
  status: AuditStatus;
  risk_level: RiskLevel;
  compliant: boolean;
  confidence_score: number;
  eudr_cutoff_date: string;
  area_ha: number;
  centroid: [number, number];
  country_code: string;
  country_name: string;
  country_risk: RiskLevel;
  layers: GeospatialLayers;
  summary: string;
  methodology: string;
  legal_disclaimer: string;
}

// ---------------------------------------------------------------- Coffre Documentaire (Chantier 5)
export type DocumentCategory =
  | "LAND_TENURE"
  | "HARVEST_PERMIT"
  | "TAX_LABOR_COMPLIANCE"
  | "FPIC_INDIGENOUS_RIGHTS"
  | "PHYTOSANITARY_CUSTOMS"
  | "CERTIFICATION_AUDIT";

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  LAND_TENURE: "Titre foncier / Droit d'usage",
  HARVEST_PERMIT: "Permis de récolte / d'abattage",
  TAX_LABOR_COMPLIANCE: "Fiscalité & Droit du travail",
  FPIC_INDIGENOUS_RIGHTS: "Droits coutumiers & FPIC",
  PHYTOSANITARY_CUSTOMS: "Certificat phytosanitaire & Douane",
  CERTIFICATION_AUDIT: "Certificat tiers (FSC / PEFC / RSPO)",
};

export type DocumentStatus = "VALID" | "EXPIRING_SOON" | "EXPIRED" | "TO_VERIFY" | "REJECTED";

export interface DocumentRecord {
  id: string;
  title: string;
  category: DocumentCategory;
  supplierId?: string | null;
  supplierName?: string;
  plotId?: string | null;
  plotName?: string;
  fileName: string;
  fileSize: number;
  fileUrl?: string;
  expiryDate?: string | null;
  status: DocumentStatus;
  issuingAuthority?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- Moteur d'Évaluation des Risques (Chantier 5)
export type RiskMitigationStatus = "TO_TREAT" | "IN_PROGRESS" | "RESOLVED" | "VALIDATED";

export interface RiskItem {
  id: string;
  reference: string;
  title: string;
  commodity: Commodity;
  supplierId?: string | null;
  supplierName: string;
  overallScore: number;
  riskLevel: RiskLevel;
  status: RiskMitigationStatus;
  countryRisk: RiskLevel;
  deforestationRisk: RiskLevel;
  legalityRisk: RiskLevel;
  supplyChainRisk: RiskLevel;
  reasons: string[];
  mitigationPlan: string;
  assignedTo?: string;
  deadline?: string;
  validatedAt?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- Dossiers de Diligence Raisonnée (Chantier 6)
export type DdrStatus =
  | "DRAFT"
  | "MISSING_DATA"
  | "IN_ANALYSIS"
  | "UNDER_REVIEW"
  | "RISK_IDENTIFIED"
  | "ACTION_REQUIRED"
  | "READY_FOR_DECLARATION"
  | "DECLARED"
  | "ARCHIVED";

export const DDR_STATUS_LABELS: Record<DdrStatus, string> = {
  DRAFT: "Brouillon",
  MISSING_DATA: "Données manquantes",
  IN_ANALYSIS: "En cours d'analyse",
  UNDER_REVIEW: "À revoir",
  RISK_IDENTIFIED: "Risque identifié",
  ACTION_REQUIRED: "Actions requises",
  READY_FOR_DECLARATION: "Prêt pour déclaration",
  DECLARED: "Déclaré sur TRACES-NT",
  ARCHIVED: "Archivé",
};

export interface DueDiligenceStatementRecord {
  id: string;
  reference: string;
  title: string;
  commodity: Commodity;
  hsCode: string;
  supplierId?: string | null;
  supplierName?: string;
  productId?: string | null;
  productName?: string;
  status: DdrStatus;
  riskLevel: RiskLevel;
  completenessScore: number;
  plotsCount: number;
  totalAreaHa: number;
  netWeightKg: number;
  countryOfProduction: string;
  operatorInfo?: OperatorInfo;
  declarationSignedBy?: string | null;
  declarationSignedAt?: string | null;
  tracesReference?: string | null;
  tracesPayloadJson?: Record<string, unknown> | null;
  submittedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------- Déclarations TRACES-NT (Chantier 6)
export type DeclarationStatus =
  | "DRAFT"
  | "READY"
  | "EXPORTED"
  | "TRANSMITTED"
  | "ACCEPTED"
  | "REJECTED"
  | "TO_CORRECT";

export const DECLARATION_STATUS_LABELS: Record<DeclarationStatus, string> = {
  DRAFT: "Brouillon",
  READY: "Prêt pour export",
  EXPORTED: "Fichier exporté",
  TRANSMITTED: "Transmis au système officiel",
  ACCEPTED: "Accepté par les douanes UE",
  REJECTED: "Rejeté par TRACES-NT",
  TO_CORRECT: "À corriger",
};

export interface TracesDeclarationRecord {
  id: string;
  ddrId: string;
  ddrReference: string;
  reference: string;
  tracesReference?: string | null;
  operatorName: string;
  operatorEori: string;
  commodity: Commodity;
  hsCode: string;
  netWeightKg: number;
  activityType: ActivityType;
  status: DeclarationStatus;
  exportedAt?: string | null;
  submittedAt?: string | null;
  xmlPayload?: string;
  jsonPayload?: string;
  createdAt: string;
}

// ---------------------------------------------------------------- Alertes & Centre d'Action (Chantier 7)
export type AlertType =
  | "CRITICAL_DEFORESTATION"
  | "EXPIRING_DOCUMENT"
  | "MISSING_DATA"
  | "SUPPLIER_UNRESPONSIVE"
  | "NEW_SATELLITE_PASS";

export interface AlertRecord {
  id: string;
  type: AlertType;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  description: string;
  linkHref: string;
  linkLabel: string;
  status: "UNREAD" | "ACKNOWLEDGED" | "RESOLVED";
  createdAt: string;
}

// ---------------------------------------------------------------- Piste d'Audit Immuable (Chantier 7)
export interface AuditLogRecord {
  id: string;
  userEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  entityReference?: string | null;
  details?: Record<string, unknown> | string | null;
  oldValue?: string | null;
  newValue?: string | null;
  ipAddress?: string | null;
  createdAt: string;
}
