import { db } from "@/db";
import { parcelAudits } from "@/db/schema";
import { validateGeometry } from "@/lib/eudr/gis-validator";
import { checkDeforestationRisk } from "@/lib/eudr/satellite-checker";
import {
  COMMODITY_HS_CODES,
  EUDR_CUTOFF_DATE,
  isCommodity,
  type AuditStatus,
  type GeoJsonInput,
  type GeometryValidationResult,
  type OperatorInfo,
  type ParcelAuditResponse,
  type SatelliteCheckResult,
} from "@/lib/eudr/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const EORI_PATTERN = /^[A-Z]{2}[A-Z0-9]{1,15}$/;
const ANONYMOUS_OPERATOR: OperatorInfo = { name: "Opérateur non renseigné", eori: "XX0000000000000", country: "XX" };

function badRequest(detail: string, status = 422): NextResponse {
  return NextResponse.json({ detail }, { status });
}

function parseOperator(raw: unknown): { operator: OperatorInfo } | { error: string } {
  if (raw === null || raw === undefined) return { operator: ANONYMOUS_OPERATOR };
  if (typeof raw !== "object") return { error: "operator doit être un objet" };
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (name.length < 2 || name.length > 200) return { error: "operator.name : 2 à 200 caractères requis" };
  const eori = typeof o.eori === "string" ? o.eori.replace(/\s+/g, "").toUpperCase() : "";
  if (!EORI_PATTERN.test(eori)) {
    return { error: "EORI invalide : format attendu = code pays ISO (2 lettres) + 1 à 15 caractères alphanumériques" };
  }
  const country = typeof o.country === "string" && o.country.trim().length === 2 ? o.country.trim().toUpperCase() : eori.slice(0, 2);
  return {
    operator: {
      name,
      eori,
      country,
      address: typeof o.address === "string" ? o.address.trim().slice(0, 300) : null,
      email: typeof o.email === "string" ? o.email.trim().slice(0, 200) : null,
    },
  };
}

function summaryText(status: AuditStatus, validation: GeometryValidationResult, satellite: SatelliteCheckResult | null): string {
  if (status === "INVALID_GEOMETRY") {
    return `Dossier rejeté : ${validation.errors[0]?.message ?? "géométrie invalide"}`;
  }
  const area = validation.area_ha.toFixed(2);
  if (status === "NON_COMPLIANT" && satellite) {
    return `NON CONFORME EUDR : déforestation détectée en ${satellite.loss_year} (après le 31/12/2020) sur une parcelle de ${area} ha.`;
  }
  return `CONFORME EUDR : aucune déforestation post-2020 détectée (parcelle de ${area} ha, risque ${satellite?.risk_level}, confiance ${Math.round((satellite?.confidence_score ?? 0) * 100)} %).`;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest("Corps JSON invalide", 400);
  }

  const geojson = body.geojson;
  if (!geojson || typeof geojson !== "object") return badRequest("geojson requis (Geometry, Feature ou FeatureCollection)");
  if (!isCommodity(body.commodity)) return badRequest("commodity invalide (coffee, cocoa, palm_oil, rubber, soya, cattle, wood)");
  const harvestDate = typeof body.harvest_date === "string" ? body.harvest_date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(harvestDate) || Number.isNaN(Date.parse(harvestDate))) {
    return badRequest("harvest_date invalide (format ISO YYYY-MM-DD)");
  }
  if (harvestDate > new Date().toISOString().slice(0, 10)) return badRequest("La date de récolte ne peut pas être dans le futur");

  const declaredAreaRaw = body.declared_area_ha;
  const declaredArea =
    declaredAreaRaw === null || declaredAreaRaw === undefined || declaredAreaRaw === "" ? null : Number(declaredAreaRaw);
  if (declaredArea !== null && (!Number.isFinite(declaredArea) || declaredArea < 0)) return badRequest("declared_area_ha doit être ≥ 0");

  const parsedOperator = parseOperator(body.operator);
  if ("error" in parsedOperator) return badRequest(parsedOperator.error);
  const operator = parsedOperator.operator;
  const parcelReference = typeof body.parcel_reference === "string" ? body.parcel_reference.slice(0, 100) : null;

  const validation = validateGeometry(geojson as GeoJsonInput, declaredArea);
  const hsCode = COMMODITY_HS_CODES[body.commodity];

  let satellite: SatelliteCheckResult | null = null;
  let status: AuditStatus = "INVALID_GEOMETRY";
  if (validation.valid && validation.normalized_geometry) {
    satellite = await checkDeforestationRisk(validation.normalized_geometry, harvestDate, geojson as GeoJsonInput);
    status = satellite.compliant ? "COMPLIANT" : "NON_COMPLIANT";
  }

  const [row] = await db
    .insert(parcelAudits)
    .values({
      operatorName: operator.name,
      operatorEori: operator.eori,
      operatorCountry: operator.country ?? "FR",
      operatorAddress: operator.address ?? null,
      commodity: body.commodity,
      hsCode,
      harvestDate,
      parcelReference,
      geometry: validation.normalized_geometry ?? geojson,
      geometryType: validation.geometry_type ?? "Unknown",
      areaHa: validation.area_ha,
      vertexCount: validation.vertex_count,
      centroidLon: validation.centroid?.[0] ?? 0,
      centroidLat: validation.centroid?.[1] ?? 0,
      countryCode: satellite?.country_code ?? "XX",
      countryRisk: satellite?.country_risk ?? "STANDARD",
      compliant: satellite?.compliant ?? false,
      lossYear: satellite?.loss_year ?? null,
      confidenceScore: satellite?.confidence_score ?? 0,
      riskLevel: satellite?.risk_level ?? "HIGH",
      status,
      validation,
      satellite,
    })
    .returning({ id: parcelAudits.id, createdAt: parcelAudits.createdAt });

  const response: ParcelAuditResponse = {
    audit_id: row.id,
    created_at: row.createdAt.toISOString(),
    status,
    commodity: body.commodity,
    hs_code: hsCode,
    harvest_date: harvestDate,
    validation,
    satellite,
    eudr_cutoff_date: EUDR_CUTOFF_DATE,
    summary: summaryText(status, validation, satellite),
  };
  return NextResponse.json(response, { status: 201 });
}
