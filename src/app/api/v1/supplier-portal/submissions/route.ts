import { lireCorpsJson } from "@/lib/api/body";
import { documents, plots, suppliers } from "@/db/schema";
import { isCommodity, type Commodity } from "@/lib/eudr/types";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";

export const dynamic = "force-dynamic";

/**
 * Dépôt d'un dossier par un producteur (portail fournisseur).
 *
 * ⚠️ P0-06 : cette route **enregistre un brouillon**. Elle ne transmet rien au
 * système d'information EUDR. La réponse porte donc explicitement
 * `transmission_status: "NOT_TRANSMITTED"`, et l'interface ne doit jamais
 * laisser croire à un dépôt effectif.
 */

interface SubmissionBody {
  companyName: string;
  country: string;
  eori: string | null;
  contactName: string | null;
  phone: string | null;
  commodity: Commodity;
  estimatedVolumeKg: number | null;
  plotName: string;
  plotCoordinates: string;
  plotAreaHa: number;
  documentTitle: string;
  documentExpiry: string | null;
}

const MAX = {
  name: 200,
  text: 300,
};

function badRequest(detail: string): NextResponse {
  return NextResponse.json({ detail }, { status: 422 });
}

function parseCoordinates(raw: string): { lat: number; lon: number } | null {
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function parseBody(body: Record<string, unknown>): SubmissionBody | NextResponse {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const companyName = str(body.companyName);
  if (companyName.length < 2) return badRequest("Raison sociale requise (≥ 2 caractères)");
  if (companyName.length > MAX.name) return badRequest("Raison sociale trop longue");

  const country = str(body.country).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return badRequest("Pays invalide (code ISO à 2 lettres)");

  const commodity = str(body.commodity);
  if (!isCommodity(commodity)) return badRequest("Matière première invalide");

  const plotName = str(body.plotName);
  if (plotName.length < 2) return badRequest("Nom de parcelle requis");

  const coords = parseCoordinates(str(body.plotCoordinates));
  if (!coords) return badRequest("Coordonnées invalides (format attendu : « latitude, longitude »)");

  const plotAreaHa = Number(body.plotAreaHa);
  if (!Number.isFinite(plotAreaHa) || plotAreaHa <= 0) return badRequest("Surface de parcelle invalide (> 0 attendu)");

  const documentTitle = str(body.documentTitle);
  if (documentTitle.length < 2) return badRequest("Intitulé du document requis");

  const estimatedVolumeRaw = body.estimatedVolumeKg;
  const estimatedVolumeKg =
    estimatedVolumeRaw === null || estimatedVolumeRaw === undefined || estimatedVolumeRaw === ""
      ? null
      : Number(estimatedVolumeRaw);
  if (estimatedVolumeKg !== null && (!Number.isFinite(estimatedVolumeKg) || estimatedVolumeKg < 0)) {
    return badRequest("Volume estimé invalide");
  }

  const expiry = str(body.documentExpiry);
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return badRequest("Date d'expiration invalide (AAAA-MM-JJ)");

  return {
    companyName,
    country,
    eori: str(body.eori).toUpperCase() || null,
    contactName: str(body.contactName).slice(0, MAX.text) || null,
    phone: str(body.phone).slice(0, 50) || null,
    commodity: commodity as Commodity,
    estimatedVolumeKg,
    plotName,
    plotCoordinates: `${coords.lat}, ${coords.lon}`,
    plotAreaHa,
    documentTitle,
    documentExpiry: expiry || null,
  };
}

export const POST = guard("supplier-portal:submit")(async (
  request: Request,
  _ctx,
  { tx, organizationId, session },
): Promise<Response> => {
  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as Record<string, unknown>;

  const parsed = parseBody(body);
  if (parsed instanceof NextResponse) return parsed;

  // Le producteur est rattaché à l'organisation de l'utilisateur connecté :
  // jamais à un identifiant fourni par le client (cf. P0-02).
  const existing = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.name, parsed.companyName)))
    .limit(1);

  let supplierId: string;
  if (existing.length > 0) {
    supplierId = existing[0].id;
    await tx
      .update(suppliers)
      .set({
        eori: parsed.eori,
        country: parsed.country,
        commodity: parsed.commodity,
        contactName: parsed.contactName,
        contactPhone: parsed.phone,
        updatedAt: new Date(),
      })
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, organizationId)));
  } else {
    const [created] = await tx
      .insert(suppliers)
      .values({
        organizationId,
        name: parsed.companyName,
        eori: parsed.eori,
        country: parsed.country,
        commodity: parsed.commodity,
        contactName: parsed.contactName,
        contactPhone: parsed.phone,
        status: "PENDING_INVITE",
      })
      .returning({ id: suppliers.id });
    supplierId = created.id;
  }

  const [lat, lon] = parsed.plotCoordinates.split(",").map((v) => Number(v.trim()));

  const [plot] = await tx
    .insert(plots)
    .values({
      organizationId,
      supplierId,
      name: parsed.plotName,
      commodity: parsed.commodity,
      countryCode: parsed.country,
      geometry: { type: "Point", coordinates: [lon, lat] },
      geometryType: "Point",
      areaHa: parsed.plotAreaHa,
      vertexCount: 1,
      centroidLon: lon,
      centroidLat: lat,
      status: "PENDING",
    })
    .returning({ id: plots.id });

  const [document] = await tx
    .insert(documents)
    .values({
      organizationId,
      supplierId,
      plotId: plot.id,
      title: parsed.documentTitle,
      category: "LAND_TENURE",
      fileName: "depot-portail",
      expiryDate: parsed.documentExpiry,
      status: "TO_VERIFY",
    })
    .returning({ id: documents.id });

  await tx
    .update(suppliers)
    .set({ plotsCount: sql`${suppliers.plotsCount} + 1`, updatedAt: new Date() })
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, organizationId)));

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "CREATE",
    entityType: "PLOT",
    entityId: plot.id,
    apres: plot as unknown as Record<string, unknown>,
    details: { origine: "portail producteur", fournisseur: parsed.companyName },
  });

  // P0-07 : si l'une des écritures ci-dessus échoue, la transaction est
  // annulée et l'erreur remonte. Aucun accusé n'est renvoyé sans persistance.
  return NextResponse.json(
    {
      submission_id: plot.id,
      draft_reference: `DDR-${new Date().getFullYear()}-${plot.id.slice(0, 8).toUpperCase()}`,
      transmission_status: "NOT_TRANSMITTED",
      transmission_notice:
        "Brouillon enregistré. Aucune déclaration n'a été déposée auprès du système " +
        "d'information EUDR : cette étape reste à réaliser par l'opérateur.",
      supplier_id: supplierId,
      plot_id: plot.id,
      document_id: document.id,
      created_at: new Date().toISOString(),
    },
    { status: 201 },
  );
});
