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
 * Table des audits de parcelles EUDR (miroir PostgreSQL du backend FastAPI).
 */
export const parcelAudits = pgTable(
  "parcel_audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
