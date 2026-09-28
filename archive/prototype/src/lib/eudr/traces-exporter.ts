import type { ParcelAuditRow } from "@/db/schema";
import { randomUUID } from "node:crypto";
import {
  COMMODITY_HS_CODES,
  COMMODITY_LABELS,
  EUDR_CUTOFF_DATE,
  EUDR_POLYGON_THRESHOLD_HA,
  type ActivityType,
  type Commodity,
  type OperatorInfo,
} from "./types";

export const NS_SUBMISSION = "http://ec.europa.eu/tracesnt/certificate/eudr/submission/v1";
export const NS_MODEL = "http://ec.europa.eu/tracesnt/certificate/eudr/model/v1";
export const NS_GFT = "https://geoforest-trace.eu/schema/verification/v1";

export interface TracesOptions {
  activityType: ActivityType;
  netWeightKg: number | null;
  internalReference: string | null;
  countryOfActivity: string;
}

export function buildReference(auditId: string): string {
  return `GFT-${new Date().getUTCFullYear()}-${auditId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function featureCollection(row: ParcelAuditRow): Record<string, unknown> {
  if (row.geometry && typeof row.geometry === "object" && (row.geometry as Record<string, unknown>).type === "FeatureCollection") {
    return row.geometry as Record<string, unknown>;
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          ProducerName: row.operatorName,
          ProducerCountry: row.countryCode,
          ProductionPlace: row.parcelReference ?? row.id,
          Area: Number(row.areaHa.toFixed(4)),
          HarvestDate: row.harvestDate,
        },
        geometry: row.geometry,
      },
    ],
  };
}

export function buildDdsPayload(row: ParcelAuditRow, operator: OperatorInfo, options: TracesOptions): Record<string, unknown> {
  const reference = options.internalReference || buildReference(row.id);
  const fc = featureCollection(row);
  const geojsonB64 = Buffer.from(JSON.stringify(fc), "utf-8").toString("base64");
  const commodity = row.commodity as Commodity;
  const hsCode = row.hsCode || COMMODITY_HS_CODES[commodity] || "";
  const satellite = (row.satellite ?? {}) as { source?: string };

  return {
    schema: { submission: NS_SUBMISSION, model: NS_MODEL, verification: NS_GFT },
    generated_at: new Date().toISOString(),
    operator_type: "OPERATOR",
    operator: {
      reference_number: { type: "EORI", identifier: operator.eori },
      name: operator.name,
      country: operator.country ?? "FR",
      address: operator.address ?? "",
      email: operator.email ?? "",
    },
    statement: {
      internal_reference_number: reference,
      activity_type: options.activityType,
      country_of_activity: options.countryOfActivity,
      border_cross_country: options.countryOfActivity,
      comment: `Généré par GeoForest Trace — audit ${row.id}`,
      commodities: [
        {
          hs_heading: hsCode,
          description_of_goods: COMMODITY_LABELS[commodity] ?? row.commodity,
          goods_measure: { net_weight_kg: options.netWeightKg, supplementary_unit: null },
          producers: [
            {
              country: row.countryCode,
              name: row.operatorName,
              geometry_geojson_base64: geojsonB64,
              geometry_geojson: fc,
            },
          ],
        },
      ],
      geolocation_confidential: false,
    },
    verification: {
      provider: "GeoForest Trace",
      audit_id: row.id,
      audited_at: row.createdAt.toISOString(),
      status: row.compliant && row.status !== "INVALID_GEOMETRY" ? "VERIFIED_COMPLIANT" : "VERIFIED_NON_COMPLIANT",
      eudr_cutoff_date: EUDR_CUTOFF_DATE,
      harvest_date: row.harvestDate,
      geometry_type: row.geometryType,
      area_ha: Number(row.areaHa.toFixed(4)),
      geometry_rule: row.areaHa >= EUDR_POLYGON_THRESHOLD_HA ? "POLYGON_REQUIRED" : "POINT_ALLOWED",
      deforestation_detected_post_cutoff: !row.compliant,
      loss_year: row.lossYear,
      confidence_score: row.confidenceScore,
      risk_level: row.riskLevel,
      country_benchmark_risk: row.countryRisk,
      satellite_source: satellite.source ?? "",
      centroid: { lon: row.centroidLon, lat: row.centroidLat },
    },
  };
}

function el(ns: "eudr" | "model" | "gft", tag: string, content: string | number | boolean | null | undefined, attrs: Record<string, string> = {}): string {
  const attrText = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join("");
  const text = content === null || content === undefined ? "" : escapeXml(String(content));
  return `<${ns}:${tag}${attrText}>${text}</${ns}:${tag}>`;
}

function camel(key: string): string {
  return key
    .split("_")
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

export function buildTracesXml(row: ParcelAuditRow, operator: OperatorInfo, options: TracesOptions): string {
  const d = buildDdsPayload(row, operator, options) as {
    generated_at: string;
    operator_type: string;
    operator: { reference_number: { identifier: string }; name: string; country: string; address: string; email: string };
    statement: {
      internal_reference_number: string;
      activity_type: string;
      country_of_activity: string;
      border_cross_country: string;
      comment: string;
      commodities: Array<{
        hs_heading: string;
        description_of_goods: string;
        goods_measure: { net_weight_kg: number | null };
        producers: Array<{ country: string; name: string; geometry_geojson_base64: string }>;
      }>;
    };
    verification: Record<string, unknown> & { centroid: { lon: number; lat: number } };
  };

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<eudr:SubmitStatementRequest xmlns:eudr="${NS_SUBMISSION}" xmlns:model="${NS_MODEL}" xmlns:gft="${NS_GFT}" generatedAt="${d.generated_at}" messageId="${randomUUID()}">`,
  );
  lines.push(`  ${el("eudr", "operatorType", d.operator_type)}`);
  lines.push("  <eudr:statement>");
  lines.push(`    ${el("model", "internalReferenceNumber", d.statement.internal_reference_number)}`);
  lines.push(`    ${el("model", "activityType", d.statement.activity_type)}`);
  lines.push("    <model:operator>");
  lines.push("      <model:referenceNumber>");
  lines.push(`        ${el("model", "identifierType", "EORI")}`);
  lines.push(`        ${el("model", "identifierValue", d.operator.reference_number.identifier)}`);
  lines.push("      </model:referenceNumber>");
  lines.push("      <model:nameAndAddress>");
  lines.push(`        ${el("model", "name", d.operator.name)}`);
  lines.push(`        ${el("model", "country", d.operator.country)}`);
  lines.push(`        ${el("model", "address", d.operator.address)}`);
  lines.push("      </model:nameAndAddress>");
  if (d.operator.email) lines.push(`      ${el("model", "email", d.operator.email)}`);
  lines.push("    </model:operator>");
  lines.push(`    ${el("model", "countryOfActivity", d.statement.country_of_activity)}`);
  lines.push(`    ${el("model", "borderCrossCountry", d.statement.border_cross_country)}`);
  lines.push(`    ${el("model", "comment", d.statement.comment)}`);
  for (const c of d.statement.commodities) {
    lines.push("    <model:commodities>");
    lines.push("      <model:descriptors>");
    lines.push(`        ${el("model", "descriptionOfGoods", c.description_of_goods)}`);
    lines.push("        <model:goodsMeasure>");
    if (c.goods_measure.net_weight_kg !== null && c.goods_measure.net_weight_kg !== undefined) {
      lines.push(`          ${el("model", "netWeight", c.goods_measure.net_weight_kg.toFixed(3))}`);
    }
    lines.push("        </model:goodsMeasure>");
    lines.push("      </model:descriptors>");
    lines.push(`      ${el("model", "hsHeading", c.hs_heading)}`);
    for (const p of c.producers) {
      lines.push("      <model:producers>");
      lines.push(`        ${el("model", "country", p.country)}`);
      lines.push(`        ${el("model", "name", p.name)}`);
      lines.push(`        ${el("model", "geometryGeojson", p.geometry_geojson_base64)}`);
      lines.push("      </model:producers>");
    }
    lines.push("    </model:commodities>");
  }
  lines.push(`    ${el("model", "geoLocationConfidential", "false")}`);
  lines.push("  </eudr:statement>");

  lines.push(`  <gft:verification provider="GeoForest Trace">`);
  const keys = [
    "audit_id",
    "audited_at",
    "status",
    "eudr_cutoff_date",
    "harvest_date",
    "geometry_type",
    "area_ha",
    "geometry_rule",
    "deforestation_detected_post_cutoff",
    "loss_year",
    "confidence_score",
    "risk_level",
    "country_benchmark_risk",
    "satellite_source",
  ] as const;
  for (const key of keys) {
    const value = d.verification[key];
    const text = typeof value === "boolean" ? (value ? "true" : "false") : value === null || value === undefined ? "" : String(value);
    lines.push(`    ${el("gft", camel(key), text)}`);
  }
  lines.push(`    <gft:centroid lon="${d.verification.centroid.lon.toFixed(6)}" lat="${d.verification.centroid.lat.toFixed(6)}"/>`);
  lines.push(`    <gft:plotCoordinates crs="EPSG:4326" order="lon,lat">`);
  lines.push(`      ${el("gft", "geoJson", JSON.stringify(row.geometry))}`);
  lines.push("    </gft:plotCoordinates>");
  lines.push("  </gft:verification>");
  lines.push("</eudr:SubmitStatementRequest>");
  return lines.join("\n") + "\n";
}
