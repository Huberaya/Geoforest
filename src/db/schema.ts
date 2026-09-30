import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * 1. Organisations (Tenants B2B)
 */
export const organizations = pgTable(
  "gf_organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    eori: text("eori"),
    country: text("country").notNull().default("FR"),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_gf_organizations_slug").on(table.slug)],
);

/**
 * 2. Utilisateurs & Rôles
 */
export const users = pgTable(
  "gf_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").notNull().default("compliance_officer"), // admin, compliance_officer, auditor, viewer
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_gf_users_org").on(table.organizationId)],
);

/**
 * 3. Fournisseurs (Suppliers)
 */
export const suppliers = pgTable(
  "gf_suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    eori: text("eori"),
    country: text("country").notNull().default("CI"),
    commodity: text("commodity").notNull(), // cocoa, coffee, palm_oil, rubber, soya, cattle, wood
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    completenessScore: integer("completeness_score").notNull().default(0), // 0 to 100%
    riskLevel: text("risk_level").notNull().default("STANDARD"), // LOW, STANDARD, HIGH, CRITICAL
    status: text("status").notNull().default("ACTIVE"), // ACTIVE, PENDING_INVITE, SUSPENDED
    plotsCount: integer("plots_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_gf_suppliers_org").on(table.organizationId)],
);

/**
 * 4. Produits / Matières premières
 */
export const products = pgTable(
  "gf_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku"),
    commodity: text("commodity").notNull(),
    hsCode: text("hs_code").notNull(),
    countryOfOrigin: text("country_of_origin").notNull().default("FR"),
    annualVolumeKg: doublePrecision("annual_volume_kg").default(0),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_gf_products_org").on(table.organizationId)],
);

/**
 * 5. Lots & Expéditions (Shipments)
 */
export const shipments = pgTable(
  "gf_shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    reference: text("reference").notNull(),
    netWeightKg: doublePrecision("net_weight_kg").notNull().default(0),
    harvestDate: text("harvest_date").notNull(),
    customsDeclarationRef: text("customs_declaration_ref"),
    status: text("status").notNull().default("IN_PREPARATION"), // IN_PREPARATION, AUDITED, READY, SHIPPED
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_gf_shipments_org").on(table.organizationId)],
);

/**
 * 6. Parcelles SIG & Données Géographiques
 */
export const plots = pgTable(
  "gf_plots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    reference: text("reference"),
    commodity: text("commodity").notNull(),
    countryCode: text("country_code").notNull().default("XX"),
    geometry: jsonb("geometry").notNull(),
    geometryType: text("geometry_type").notNull(),
    areaHa: doublePrecision("area_ha").notNull().default(0),
    vertexCount: integer("vertex_count").notNull().default(0),
    centroidLon: doublePrecision("centroid_lon").notNull().default(0),
    centroidLat: doublePrecision("centroid_lat").notNull().default(0),
    status: text("status").notNull().default("PENDING"), // COMPLIANT, NON_COMPLIANT, INVALID_GEOMETRY, PENDING
    riskLevel: text("risk_level").notNull().default("STANDARD"),
    lossYear: integer("loss_year"),
    confidenceScore: doublePrecision("confidence_score").default(0),
    lastAuditAt: timestamp("last_audit_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_gf_plots_org").on(table.organizationId)],
);

/**
 * 7. Coffre Documentaire Légalité & Certificats
 */
export const documents = pgTable(
  "gf_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    plotId: uuid("plot_id").references(() => plots.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    category: text("category").notNull(), // LAND_TENURE, HARVEST_PERMIT, TAX_CLEARANCE, LABOR_COMPLIANCE, CERTIFICATE_FSC_PEFC
    fileName: text("file_name").notNull(),
    fileUrl: text("file_url"),
    fileSize: integer("file_size").default(0),
    expiryDate: text("expiry_date"),
    status: text("status").notNull().default("TO_VERIFY"), // VALID, EXPIRED, TO_VERIFY, REJECTED
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_gf_documents_org").on(table.organizationId)],
);

/**
 * 8. Dossiers de Diligence Raisonnée (DDR / Due Diligence Statements)
 */
export const dueDiligenceStatements = pgTable(
  "gf_due_diligence_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    title: text("title").notNull(),
    commodity: text("commodity").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    status: text("status").notNull().default("DRAFT"),
    // DRAFT, MISSING_DATA, IN_ANALYSIS, UNDER_REVIEW, RISK_IDENTIFIED, ACTION_REQUIRED, READY_FOR_DECLARATION, DECLARED, ARCHIVED
    riskLevel: text("risk_level").notNull().default("STANDARD"),
    completenessScore: integer("completeness_score").notNull().default(0),
    plotsCount: integer("plots_count").notNull().default(0),
    totalAreaHa: doublePrecision("total_area_ha").notNull().default(0),
    netWeightKg: doublePrecision("net_weight_kg").notNull().default(0),
    tracesPayloadJson: jsonb("traces_payload_json"),
    tracesReference: text("traces_reference"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_gf_dds_org").on(table.organizationId)],
);

/**
 * 9. Risques & Tâches d'Atténuation (Compliance Tasks)
 */
export const complianceTasks = pgTable(
  "gf_compliance_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    diligenceId: uuid("diligence_id").references(() => dueDiligenceStatements.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    severity: text("severity").notNull().default("MEDIUM"), // LOW, MEDIUM, HIGH, CRITICAL
    status: text("status").notNull().default("TO_HANDLE"), // TO_HANDLE, IN_PROGRESS, RESOLVED, VALIDATED
    assignee: text("assignee"),
    dueDate: text("due_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_gf_tasks_org").on(table.organizationId)],
);

/**
 * 10. Piste d'Audit Immuable (Audit Log)
 */
export const auditLogs = pgTable(
  "gf_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    userEmail: text("user_email").notNull().default("system"),
    action: text("action").notNull(), // CREATE, UPDATE, AUDIT, EXPORT, TRANSMIT, VALIDATE
    entityType: text("entity_type").notNull(), // SUPPLIER, PLOT, DOCUMENT, DDS, SHIPMENT
    entityId: text("entity_id").notNull(),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_gf_audit_logs_org").on(table.organizationId), index("idx_gf_audit_logs_created_at").on(table.createdAt)],
);

/**
 * 11. Table des audits unitaires de parcelles (compatibilité moteur SIG & TRACES)
 */
export const parcelAudits = pgTable(
  "parcel_audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    operatorName: text("operator_name").notNull(),
    operatorEori: text("operator_eori").notNull(),
    operatorCountry: text("operator_country").notNull().default("FR"),
    operatorAddress: text("operator_address"),
    commodity: text("commodity").notNull(),
    hsCode: text("hs_code").notNull(),
    harvestDate: text("harvest_date").notNull(),
    parcelReference: text("parcel_reference"),
    geometry: jsonb("geometry").notNull(),
    geometryType: text("geometry_type").notNull(),
    areaHa: doublePrecision("area_ha").notNull().default(0),
    vertexCount: integer("vertex_count").notNull().default(0),
    centroidLon: doublePrecision("centroid_lon").notNull().default(0),
    centroidLat: doublePrecision("centroid_lat").notNull().default(0),
    countryCode: text("country_code").notNull().default("XX"),
    countryRisk: text("country_risk").notNull().default("STANDARD"),
    compliant: boolean("compliant").notNull().default(false),
    lossYear: integer("loss_year"),
    confidenceScore: doublePrecision("confidence_score").notNull().default(0),
    riskLevel: text("risk_level").notNull().default("STANDARD"),
    status: text("status").notNull(),
    validation: jsonb("validation").notNull(),
    satellite: jsonb("satellite"),
    tracesReference: text("traces_reference"),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
  },
  (table) => [index("idx_parcel_audits_created_at").on(table.createdAt)],
);

export type ParcelAuditRow = typeof parcelAudits.$inferSelect;
export type NewParcelAuditRow = typeof parcelAudits.$inferInsert;
export type OrganizationRow = typeof organizations.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SupplierRow = typeof suppliers.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type ShipmentRow = typeof shipments.$inferSelect;
export type PlotRow = typeof plots.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type DueDiligenceRow = typeof dueDiligenceStatements.$inferSelect;
export type ComplianceTaskRow = typeof complianceTasks.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;

