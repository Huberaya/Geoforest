/** Contrats de données GeoForest Trace — miroir strict des schémas Pydantic du backend. */

export type RiskLevel = "LOW" | "STANDARD" | "HIGH" | "CRITICAL";
/**
 * Statut d'un audit de parcelle.
 *
 * `SIMULATED_NON_PROBATIVE` et `ANALYSIS_UNAVAILABLE` existent pour qu'une
 * analyse non fondée sur des données réelles ne puisse pas être confondue avec
 * un verdict de conformité (P0-04). Un audit dans l'un de ces deux états
 * n'emporte **aucune** présomption de conformité au sens du règlement (UE)
 * 2023/1115 et ne doit pas alimenter une déclaration de diligence raisonnée.
 */
export type AuditStatus =
  | "COMPLIANT"
  | "NON_COMPLIANT"
  | "INVALID_GEOMETRY"
  | "SIMULATED_NON_PROBATIVE"
  | "ANALYSIS_UNAVAILABLE";

/**
 * Provenance de l'analyse.
 * - `gfw-live`     : données réellement interrogées chez Global Forest Watch.
 * - `simulated`    : moteur déterministe de démonstration. Aucune valeur probante.
 * - `unavailable`  : aucune analyse n'a pu être obtenue. Aucun verdict émis.
 */
export type AnalysisSource = "gfw-live" | "simulated" | "unavailable";

/** Trace d'exécution d'une analyse probante, pour reproductibilité. */
export interface AnalysisEvidence {
  provider: string;
  /**
   * Vrai uniquement si le service interrogé est bien le service officiel de
   * Global Forest Watch.
   *
   * P1-16 — l'adresse du service est configurable. Attribuer le résultat à
   * « Global Forest Watch » quel que soit l'hôte réellement appelé revenait à
   * présenter la réponse d'un autre service — y compris d'un banc d'essai —
   * comme une analyse GFW. La traçabilité doit dire d'où vient la donnée.
   */
  is_official_source: boolean;
  dataset: string;
  dataset_version: string;
  endpoint: string;
  sql: string;
  geometry_type: string;
  retrieved_at: string;
}
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
/** Le système d'information EUDR tronque les coordonnées à 6 décimales. */
export const EUDR_IS_COORD_DECIMALS = 6;

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
  /**
   * GeoJSON déjà sérialisé, avec la précision du fichier d'origine. Présent
   * uniquement quand la géométrie provient d'un fichier déposé ou collé
   * (cf. `ParsedUpload.geojsonText`). Jamais transmis au serveur tel quel.
   */
  geojsonText?: string;
  commodity: Commodity;
  harvest_date: string;
  operator?: OperatorInfo | null;
  declared_area_ha?: number | null;
  parcel_reference?: string | null;
  /**
   * P1-16 — identité du producteur, distincte de l'opérateur.
   * `null` (ou absent) signifie « non déclaré » : un état valide, que rien ne
   * doit combler en copiant l'opérateur.
   */
  producer?: { name?: string; country?: string; same_as_operator?: boolean } | null;
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

import type { AnalyseProvenance } from "./satellite-checker";

export interface SatelliteCheckResult {
  /**
   * Verdict de conformité.
   * `null` dès que l'analyse n'est pas probante : l'absence de verdict est
   * une information, elle ne doit pas être comblée par une valeur par défaut.
   */
  compliant: boolean | null;
  loss_year: number | null;
  /** Score de confiance. `null` quand l'analyse n'est pas probante. */
  confidence_score: number | null;
  risk_level: RiskLevel;
  country_code: string;
  country_name: string;
  country_risk: RiskLevel;
  /** Provenance de l'analyse — jamais libre, toujours l'une des trois valeurs. */
  source: AnalysisSource;
  /** Vrai uniquement si le verdict repose sur des données réellement mesurées. */
  is_probative: boolean;
  /** P1-10 — méthode, version, paramètres et limites de l'analyse. */
  provenance: AnalyseProvenance;
  /** Trace d'exécution ; `null` si l'analyse n'est pas probante. */
  evidence: AnalysisEvidence | null;
  /** Mention à afficher à l'utilisateur ; `null` si l'analyse est probante. */
  disclaimer: string | null;
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
  /** Null quand l'analyse n'était pas probante (P0-04). */
  compliant: boolean | null;
  loss_year: number | null;
  risk_level: RiskLevel;
  country_code: string;
}

// ---------------------------------------------------------------- Export TRACES
/**
 * Formats de brouillon produits à partir d'un audit.
 * - `geojson` : fichier de géolocalisation au format attendu par le SI EUDR.
 * - `json` / `xml` : **format interne GeoForest**, à usage de brouillon.
 *   Les espaces de noms employés ne sont pas ceux de TRACES-NT : ce n'est pas
 *   un message de déclaration (cf. P0-06).
 */
export type TracesFormat = "xml" | "json" | "geojson";
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
/**
 * Détail d'un fournisseur.
 *
 * ⚠️ P0-09 : les parcelles et les documents proviennent de la base. Un
 * fournisseur réellement sans document renvoie des tableaux vides — jamais un
 * jeu de démonstration, jamais un statut « VALID » inventé.
 */
export interface SupplierDetail {
  id: string;
  name: string;
  eori: string | null;
  country: string;
  commodity: Commodity;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Complétude **calculée** — voir `src/lib/eudr/completeness.ts`. */
  completenessScore: number;
  riskLevel: RiskLevel;
  status: "ACTIVE" | "PENDING_INVITE" | "SUSPENDED";
  plotsCount: number;
  createdAt: string;
  /** Libellés des critères de complétude non satisfaits. */
  missingData: string[];
  plots: Array<{
    id: string;
    name: string;
    reference: string | null;
    areaHa: number;
    status: string;
    riskLevel: string;
    geometryType: string;
    countryCode: string;
  }>;
  documents: Array<{
    id: string;
    title: string;
    category: string;
    status: string;
    expiryDate: string | null;
  }>;
}

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
  supplierId: string | null;
  supplierName?: string | null;
  name: string;
  reference: string | null;
  commodity: Commodity;
  countryCode: string;
  geometry: SupportedGeometry;
  geometryType: string;
  areaHa: number;
  vertexCount: number;
  centroidLon: number;
  centroidLat: number;
  status: "COMPLIANT" | "NON_COMPLIANT" | "INVALID_GEOMETRY" | "PENDING";
  riskLevel: RiskLevel;
  lossYear: number | null;
  /** NULL tant qu'aucune analyse probante n'a été menée (P0-04). */
  confidenceScore: number | null;
  lastAuditAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- Documents
export const DOCUMENT_CATEGORIES = [
  "LAND_TENURE",
  "HARVEST_PERMIT",
  "TAX_CLEARANCE",
  "LABOR_COMPLIANCE",
  "CERTIFICATE_FSC_PEFC",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  LAND_TENURE: "Titre foncier",
  HARVEST_PERMIT: "Permis de récolte",
  TAX_CLEARANCE: "Quitus fiscal",
  LABOR_COMPLIANCE: "Conformité sociale",
  CERTIFICATE_FSC_PEFC: "Certification FSC / PEFC",
};

export interface ComplianceDocument {
  id: string;
  supplierId: string | null;
  supplierName?: string | null;
  plotId: string | null;
  plotName?: string | null;
  title: string;
  category: DocumentCategory;
  fileName: string | null;
  fileUrl: string | null;
  fileSize: number | null;
  expiryDate: string | null;
  status: "VALID" | "EXPIRED" | "TO_VERIFY" | "REJECTED";
  notes: string | null;
  createdAt: string;
  /** Jours restants avant expiration ; négatif si échu. NULL sans date. */
  daysUntilExpiry: number | null;

  // ---------------------------------------------------------------- P1-02
  /** Condensat SHA-256 de la pièce courante. NULL si aucune pièce déposée. */
  sha256?: string | null;
  /** Taille mesurée à la lecture, en octets. */
  sizeBytes?: number | null;
  /** Type lu dans les octets. */
  mimeDetected?: string | null;
  /** Type annoncé par le client, conservé pour pouvoir le confronter. */
  mimeDeclared?: string | null;
  /** Vrai si le type annoncé ne correspond pas aux octets. */
  mimeMismatch?: boolean;
  /** Numéro de la version courante. */
  version?: number;
  /**
   * Résultat de l'analyse antivirus. `NOT_SCANNED` signifie qu'aucun moteur
   * n'a été interrogé — ce n'est PAS une affirmation de salubrité.
   */
  scanStatus?: "CLEAN" | "INFECTED" | "NOT_SCANNED";
  scanDetail?: string | null;
  scanMoteur?: string | null;
  /** Vrai si une pièce est effectivement stockée et relisible. */
  hasFile?: boolean;
}

// ---------------------------------------------------------------- Diligence raisonnée
export const DDS_STATUSES = [
  "DRAFT",
  "MISSING_DATA",
  "IN_ANALYSIS",
  "UNDER_REVIEW",
  "RISK_IDENTIFIED",
  "ACTION_REQUIRED",
  "READY_FOR_DECLARATION",
  "DECLARED",
  "ARCHIVED",
] as const;
export type DdsStatus = (typeof DDS_STATUSES)[number];
export const DDS_STATUS_LABELS: Record<DdsStatus, string> = {
  DRAFT: "Brouillon",
  MISSING_DATA: "Données manquantes",
  IN_ANALYSIS: "Analyse en cours",
  UNDER_REVIEW: "En revue",
  RISK_IDENTIFIED: "Risque identifié",
  ACTION_REQUIRED: "Action requise",
  READY_FOR_DECLARATION: "Prêt à déclarer",
  DECLARED: "Déclaré",
  ARCHIVED: "Archivé",
};

export interface DiligenceStatement {
  id: string;
  reference: string;
  title: string;
  commodity: Commodity;
  supplierId: string | null;
  supplierName?: string | null;
  productId: string | null;
  productName?: string | null;
  status: DdsStatus;
  riskLevel: RiskLevel;
  completenessScore: number;
  plotsCount: number;
  totalAreaHa: number;
  netWeightKg: number;
  createdAt: string;
  updatedAt: string;
  /** P0-06 : généré ≠ transmis. Toujours NOT_TRANSMITTED à ce jour. */
  transmissionStatus: "NOT_TRANSMITTED" | "PENDING_ACK" | "ACKNOWLEDGED" | "REJECTED";
  tasksOpen: number;
}

export interface ComplianceTask {
  id: string;
  diligenceId: string | null;
  ddsReference?: string | null;
  title: string;
  description: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "TO_HANDLE" | "IN_PROGRESS" | "RESOLVED" | "VALIDATED";
  assignee: string | null;
  dueDate: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- Alertes
export interface Alert {
  id: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  kind: "DEFORESTATION" | "DOCUMENT_EXPIRY" | "MISSING_DATA" | "TASK_OVERDUE";
  title: string;
  description: string;
  entityType: string;
  entityId: string;
  href: string;
  dueDate: string | null;
}

// ---------------------------------------------------------------- Rapports
export interface ComplianceReport {
  organizationName: string;
  generatedAt: string;
  counts: {
    suppliers: number;
    plots: number;
    documents: number;
    statements: number;
    audits: number;
  };
  /** NULL : non calculable — aucune analyse probante disponible (P0-04). */
  auditedPlots: number;
  probativeAudits: number;
  compliantAudits: number | null;
  nonCompliantAudits: number | null;
  documentsByStatus: Record<string, number>;
  statementsByStatus: Record<string, number>;
  areaHa: number;
  /** Rappel quand un indicateur n'est pas calculable, au lieu d'une valeur fausse. */
  notice: string | null;
}

// ---------------------------------------------------------------- Journal
export interface AuditLogEntry {
  id: string;
  userEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

// --------------------------------------------- Réponses composées (P0-08)
export interface PlotDetail extends Plot {
  audits: Array<{
    id: string;
    status: string;
    compliant: boolean | null;
    lossYear: number | null;
    riskLevel: string;
    analysisSource: string | null;
    analysisProbative: boolean | null;
    createdAt: string;
  }>;
  /** plot_id : rattachement fiable · reference : analyses antérieures sans plot_id · aucune_reference : aucune analyse rattachée. */
  audits_linked_by: string;
}

export interface DdsDetail extends DiligenceStatement {
  transmission_notice: string;
  allowed_transitions: DdsStatus[];
  tasks: ComplianceTask[];
}

/**
 * Synthèse du tableau de bord.
 *
 * ⚠️ P0-09 : chaque indicateur est `number` **ou** `null`. `null` signifie
 * « non calculable » et l'écran doit afficher « — » avec la notice associée,
 * jamais une valeur d'illustration. Le tableau de bord affichait auparavant
 * 91,4 %, 38/42 parcelles, 1 248,5 ha, 14 fournisseurs et 5/8 dossiers de
 * façon permanente, quelle que soit la base de données.
 */
export interface DashboardSummary {
  organizationName: string | null;
  organizationCountry: string | null;
  generatedAt: string;
  complianceScore: number | null;
  complianceScoreBasis: {
    probativeAnalyses: number;
    decidedAnalyses: number;
    compliant: number;
    nonCompliant: number;
  };
  stats: {
    suppliers: {
      total: number;
      active: number;
      atRisk: number;
      withoutCountry: number;
      completeness: number | null;
    };
    plots: { total: number; compliant: number; nonCompliant: number; pending: number; totalAreaHa: number };
    analyses: { total: number; probative: number; compliant: number; nonCompliant: number };
    dds: { total: number; byStatus: Record<string, number>; inProgress: number; ready: number; declared: number };
    documents: { total: number; expiringSoon: number; expired: number; missing: number | null };
    alerts: { critical: number; high: number; medium: number; total: number };
  };
  urgentActions: Array<{
    id: string;
    kind: string;
    severity: string;
    title: string;
    description: string | null;
    dueDate: string | null;
    overdue: boolean;
    href: string;
  }>;
  recentActivities: Array<{
    id: string;
    timestamp: string;
    actor: string;
    action: string;
    entityType: string;
    entityId: string;
  }>;
  /** Raisons pour lesquelles certains indicateurs sont absents. */
  notices: string[];
  derived_from: string[];
}

export interface AlertsResponse {
  alerts: Alert[];
  counts: { critical: number; high: number; medium: number; total: number };
  derived_from: string[];
}

export interface AnalysesResponse {
  analyses: Array<Record<string, unknown>>;
  summary: {
    total: number;
    probative: number;
    compliant: number;
    non_compliant: number;
    unavailable: number;
    simulated: number;
  };
  notice: string | null;
}

export interface DeclarationsResponse {
  transmission_capability: { available: boolean; reason: string };
  declarations: Array<{
    id: string;
    reference: string;
    title: string;
    commodity: Commodity;
    supplierName: string | null;
    productName: string | null;
    status: DdsStatus;
    riskLevel: RiskLevel;
    completenessScore: number;
    netWeightKg: number;
    updatedAt: string;
    transmission_status: string;
  }>;
  ready: Array<{ id: string; reference: string }>;
  notice: string;
}

export interface SettingsResponse {
  organization: { id: string; name: string; slug: string; eori: string | null; createdAt: string };
  usage: { users: number; suppliers: number; plots: number };
  eudr_configuration: {
    satellite_analysis: { configured: boolean; provider: string; dataset: string; status: string; consequence: string };
    demo_mode: { enabled: boolean; consequence: string | null };
    eudr_is_transmission: { available: boolean; consequence: string };
    document_storage: { available: boolean; consequence: string };
  };
  viewer: { email: string; role: string };
}
