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
import { nomValide, paysValide } from "./identite-operateur";

/**
 * ⚠️ FORMAT INTERNE GEOFOREST — CE N'EST PAS UN MESSAGE TRACES-NT (P0-06).
 *
 * Les espaces de noms ci-dessous ont été définis par ce projet ; ils ne sont
 * publiés par aucune autorité. Le fichier produit est un **brouillon de DDS**
 * destiné à un usage interne ou à une reprise manuelle. Il ne constitue en
 * aucun cas une déclaration déposée auprès du système d'information EUDR.
 */
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
          ProducerName: (row as { producerName?: string | null }).producerName ?? "",
          ProducerCountry: paysValide((row as { producerCountry?: string | null }).producerCountry)
            ? ((row as { producerCountry?: string }).producerCountry as string).trim().toUpperCase()
            : "",
          ProductionPlace: row.parcelReference ?? row.id,
          Area: Number(row.areaHa.toFixed(4)),
          HarvestDate: row.harvestDate,
        },
        geometry: row.geometry,
      },
    ],
  };
}

/** Mention insérée dans chaque brouillon produit. */
export const DRAFT_NOTICE =
  "BROUILLON INTERNE GEOFOREST — ni déposé ni transmis au système d'information EUDR. " +
  "Format interne, non reconnu par TRACES-NT. Aucune valeur de déclaration.";

/**
 * Identité du producteur, telle qu'elle doit figurer dans la déclaration.
 *
 * P1-16 — avant, le nœud `producers` recevait `row.operatorName`. Le
 * producteur et l'opérateur sont deux rôles distincts ; les confondre fait
 * désigner par la déclaration une entité qui n'a pas produit la marchandise.
 *
 * ⚠️ Aucune valeur de repli n'est appliquée ici. Un producteur inconnu est
 * renvoyé comme `null` : c'est à l'appelant de décider — refuser l'export ou
 * le demander à l'opérateur. Substituer l'opérateur en silence est le défaut
 * que l'on corrige, on ne le réintroduit pas par une porte dérobée.
 */
/**
 * Méthode d'attribution du pays telle que consignée par le moteur au moment de
 * l'analyse. Aucune valeur n'est reconstituée : un audit antérieur à P2-16 ne
 * porte pas de `resolution_pays` et reste `legacy_unknown`.
 */
export function attributionPays(
  params: Record<string, unknown> | undefined | null,
): "natural-earth-50m" | "unavailable" | "legacy_unknown" {
  const methode = params?.resolution_pays;
  if (methode === "natural-earth-50m") return "natural-earth-50m";
  if (methode === "unavailable") return "unavailable";
  return "legacy_unknown";
}

export function producteurDe(row: ParcelAuditRow): { name: string; country: string } | null {
  const name = (row as { producerName?: string | null }).producerName;
  const country = (row as { producerCountry?: string | null }).producerCountry;
  // P0/P1-16 — jamais `XX`, jamais le pays de la parcelle : un producteur dont
  // le pays n'est pas valide n'est pas un producteur déclarable.
  if (!nomValide(name) || !paysValide(country)) return null;
  return { name: (name as string).trim(), country: (country as string).trim().toUpperCase() };
}

export function buildDdsPayload(row: ParcelAuditRow, operator: OperatorInfo, options: TracesOptions): Record<string, unknown> {
  const reference = options.internalReference || buildReference(row.id);
  const fc = featureCollection(row);
  const geojsonB64 = Buffer.from(JSON.stringify(fc), "utf-8").toString("base64");
  const commodity = row.commodity as Commodity;
  const hsCode = row.hsCode || COMMODITY_HS_CODES[commodity] || "";
  const satellite = (row.satellite ?? {}) as {
    source?: string;
    evidence?: Record<string, unknown> | null;
    provenance?: { method?: string; version?: string | null; params?: Record<string, unknown>; limits?: string[] } | null;
  };

  // Un producteur non déclaré produit un nœud vide et un avertissement
  // explicite : jamais le nom de l'opérateur à la place.
  const producteur = producteurDe(row);
  const producers = producteur
    ? [{ country: producteur.country, name: producteur.name }]
    : [{ country: "", name: "" }];
  const avertissements: string[] = producteur
    ? []
    : ["Producteur non déclaré : le nœud producers est vide. Une déclaration sans " +
       "producteur est incomplète et serait refusée par le SI EUDR."];

  return {
    schema: { submission: NS_SUBMISSION, model: NS_MODEL, verification: NS_GFT },
    notice: DRAFT_NOTICE,
    generated_at: new Date().toISOString(),
    operator_type: "OPERATOR",
    operator: {
      reference_number: { type: "EORI", identifier: operator.eori },
      name: operator.name,
      // Lot A — `operator.country ?? "FR"` déclarait « France » pour tout
      // opérateur silencieux, dans un document destiné au SI EUDR. Le pays
      // n'est jamais inventé : à défaut de déclaration, il est déduit du
      // préfixe de l'EORI, qui est un fait attaché à l'identifiant (et non une
      // valeur par défaut arbitraire).
      country: operator.country ?? operator.eori.slice(0, 2),
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
          producers: producers.map((p) => ({
            ...p,
            geometry_geojson_base64: geojsonB64,
            geometry_geojson: fc,
          })),
        },
      ],
      geolocation_confidential: false,
      producer_warnings: avertissements,
    },
    verification: {
      provider: "GeoForest Trace",
      audit_id: row.id,
      audited_at: row.createdAt.toISOString(),
      // ⚠️ `row.compliant` peut être NULL (aucun verdict). Le ternaire binaire
      //   transformait « aucun verdict » en « perte détectée » : une affirmation
      //   fausse, dans un document destiné à une déclaration.
      status:
        row.compliant === true
          ? "SATELLITE_NO_POST_CUTOFF_LOSS_DETECTED"
          : row.compliant === false
            ? "SATELLITE_POST_CUTOFF_LOSS_DETECTED_REVIEW_REQUIRED"
            : "NO_VERDICT",
      eudr_cutoff_date: EUDR_CUTOFF_DATE,
      harvest_date: row.harvestDate,
      geometry_type: row.geometryType,
      area_ha: Number(row.areaHa.toFixed(4)),
      geometry_rule: row.areaHa > EUDR_POLYGON_THRESHOLD_HA ? "POLYGON_REQUIRED" : "POINT_ALLOWED",
      tree_cover_loss_detected_post_cutoff: row.compliant === false,
      loss_year: row.lossYear,
      confidence_score: null,
      risk_level: row.compliant === false ? "HIGH" : "UNKNOWN",
      country_benchmark_risk: "UNKNOWN",
      // E / P2-16 — l'attribution du pays est lue dans la provenance de
      //     l'analyse telle qu'elle a été enregistrée : `natural-earth-50m`
      //     (frontières versionnées, data/frontieres/PROVENANCE.md) ou
      //     `unavailable`. Un dossier antérieur à l'intégration des frontières
      //     ne porte pas cette information et est publié comme `legacy_unknown`,
      //     jamais rétro-qualifié. L'attribution 1:50m n'est pas de précision
      //     cadastrale : elle reste déclarée non fiable pour une parcelle
      //     riveraine d'une frontière.
      country_code: row.countryCode,
      country_attribution: attributionPays(satellite.provenance?.params),
      country_attribution_reliable: false,
      country_attribution_warning:
        "Pays attribué par frontières Natural Earth 1:50m (généralisation régionale) : " +
        "à confirmer pour toute parcelle située à moins de quelques centaines de mètres " +
        "d'une frontière. « XX » signifie non déterminé, sans substitution.",
      satellite_source: satellite.source ?? "",
      satellite_evidence: satellite.evidence ?? null,
      satellite_provenance: satellite.provenance ?? null,
      satellite_evidence_hash: typeof satellite.evidence?.rows_sha256 === "string" ? satellite.evidence.rows_sha256 : null,
      satellite_provenance_method: satellite.provenance?.method ?? null,
      interpretation_limit: "La perte de couvert arboré ne détermine pas à elle seule la cause ou la qualification juridique de déforestation ; l'absence de perte détectée ne prouve pas à elle seule la conformité EUDR complète.",
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
  lines.push(`<!-- ${DRAFT_NOTICE} -->`);
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
    "tree_cover_loss_detected_post_cutoff",
    "loss_year",
    "confidence_score",
    "risk_level",
    "country_benchmark_risk",
    "country_code",
    "country_attribution",
    "satellite_source",
    "satellite_evidence_hash",
    "satellite_provenance_method",
    "interpretation_limit",
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
