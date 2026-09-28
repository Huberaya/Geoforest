import { db } from "@/db";
import { parcelAudits } from "@/db/schema";
import { buildDdsPayload, buildReference, buildTracesXml, type TracesOptions } from "@/lib/eudr/traces-exporter";
import type { ActivityType, OperatorInfo } from "@/lib/eudr/types";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const EORI_PATTERN = /^[A-Z]{2}[A-Z0-9]{1,15}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVITIES: ActivityType[] = ["IMPORT", "EXPORT", "DOMESTIC"];

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ detail: "Corps JSON invalide" }, { status: 400 });
  }

  const auditId = typeof body.audit_id === "string" ? body.audit_id : "";
  if (!auditId) return NextResponse.json({ detail: "audit_id requis" }, { status: 422 });
  if (!UUID_PATTERN.test(auditId)) return NextResponse.json({ detail: "Audit introuvable" }, { status: 404 });

  const [row] = await db.select().from(parcelAudits).where(eq(parcelAudits.id, auditId)).limit(1);
  if (!row) return NextResponse.json({ detail: "Audit introuvable" }, { status: 404 });
  if (row.status === "INVALID_GEOMETRY") {
    return NextResponse.json(
      { detail: "Impossible d'exporter un dossier dont la géométrie est invalide : corrigez la parcelle puis relancez l'audit." },
      { status: 409 },
    );
  }

  let operator: OperatorInfo = {
    name: row.operatorName,
    eori: row.operatorEori,
    country: row.operatorCountry,
    address: row.operatorAddress ?? "",
    email: "",
  };
  if (body.operator && typeof body.operator === "object") {
    const o = body.operator as Record<string, unknown>;
    const eori = typeof o.eori === "string" ? o.eori.replace(/\s+/g, "").toUpperCase() : "";
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (name.length < 2 || !EORI_PATTERN.test(eori)) {
      return NextResponse.json({ detail: "Opérateur invalide (nom ≥ 2 caractères et EORI conforme requis)" }, { status: 422 });
    }
    operator = {
      name,
      eori,
      country: typeof o.country === "string" && o.country.length === 2 ? o.country.toUpperCase() : eori.slice(0, 2),
      address: typeof o.address === "string" ? o.address : "",
      email: typeof o.email === "string" ? o.email : "",
    };
  }

  const format = body.format === "json" ? "json" : "xml";
  const activityType = ACTIVITIES.includes(body.activity_type as ActivityType) ? (body.activity_type as ActivityType) : "IMPORT";
  const netWeightRaw = body.net_weight_kg;
  const netWeightKg = netWeightRaw === null || netWeightRaw === undefined || netWeightRaw === "" ? null : Number(netWeightRaw);
  if (netWeightKg !== null && (!Number.isFinite(netWeightKg) || netWeightKg < 0)) {
    return NextResponse.json({ detail: "net_weight_kg doit être ≥ 0" }, { status: 422 });
  }
  const internalReference = typeof body.internal_reference === "string" && body.internal_reference.trim() ? body.internal_reference.trim().slice(0, 50) : null;
  const countryOfActivity =
    typeof body.country_of_activity === "string" && body.country_of_activity.trim().length === 2 ? body.country_of_activity.trim().toUpperCase() : "FR";

  const options: TracesOptions = { activityType, netWeightKg, internalReference, countryOfActivity };
  const reference = internalReference ?? buildReference(row.id);

  await db
    .update(parcelAudits)
    .set({ tracesReference: reference, exportedAt: new Date() })
    .where(eq(parcelAudits.id, row.id));

  const filename = `DDS_${reference}`;
  if (format === "json") {
    return new Response(JSON.stringify(buildDdsPayload(row, operator, options), null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.json"`,
      },
    });
  }

  return new Response(buildTracesXml(row, operator, options), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.xml"`,
    },
  });
}
