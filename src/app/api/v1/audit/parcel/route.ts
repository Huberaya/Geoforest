import { lireCorpsJson } from "@/lib/api/body";
import { parcelAudits } from "@/db/schema";
import { logAction } from "@/lib/api/audit-log";
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
import { guard } from "@/lib/auth/guard";

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

/**
 * P1-16 — identité du producteur.
 *
 * ⚠️ Pourquoi ce n'est pas une copie de l'opérateur avec une valeur par défaut.
 * L'opérateur et le producteur sont deux rôles distincts : l'opérateur est
 * celui qui met sur le marché, le producteur celui qui a produit la
 * marchandise. Ils coïncident souvent — une coopérative qui produit et importe
 * — mais cette coïncidence doit être **déclarée**, pas supposée. La supposer
 * faisait désigner par la déclaration un producteur qui n'en est pas un.
 *
 * L'absence est un état valide et représentable : elle est enregistrée telle
 * quelle, et c'est à l'export de la signaler.
 */
function parseProducteur(raw: unknown): { producer: { name: string | null; country: string | null } } | { error: string } {
  if (raw === null || raw === undefined) return { producer: { name: null, country: null } };
  if (typeof raw !== "object") return { error: "producer doit être un objet" };
  const o = raw as Record<string, unknown>;
  if (o.same_as_operator === true || o.sameAsOperator === true) {
    // Renseigné plus bas, une fois l'opérateur connu.
    return { producer: { name: null, country: null } };
  }
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (name.length < 2 || name.length > 200) return { error: "producer.name : 2 à 200 caractères requis" };
  const rawCountry = typeof o.country === "string" ? o.country.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(rawCountry)) return { error: "producer.country : code pays ISO à 2 lettres requis" };
  return { producer: { name, country: rawCountry } };
}

/**
 * ⚠️ Le résumé est la phrase la plus lue du produit — celle qu'on recopie dans
 *   un courriel. Elle ne doit jamais affirmer une conformité qui n'a pas été
 *   établie. Sans analyse probante, il n'y a **aucun verdict**, et surtout pas
 *   un verdict favorable : c'est le défaut trouvé lors de la revue GO/NO-GO du
 *   04/10/2026 — le bandeau disait « ANALYSE INDISPONIBLE » pendant que le
 *   résumé affirmait « CONFORME EUDR ». Les formulations sont alignées sur
 *   celles de `GET /api/v1/audits/{id}`, qui n'avaient pas le défaut.
 */
function summaryText(status: AuditStatus, validation: GeometryValidationResult, satellite: SatelliteCheckResult | null): string {
  if (status === "INVALID_GEOMETRY") {
    return `Dossier rejeté : ${validation.errors[0]?.message ?? "géométrie invalide"}`;
  }
  const area = validation.area_ha.toFixed(2);
  if (status === "ANALYSIS_UNAVAILABLE") {
    return `Aucun verdict : l'analyse satellite n'a pas abouti. Ce dossier n'emporte aucune présomption de conformité (parcelle de ${area} ha).`;
  }
  if (status === "SIMULATED_NON_PROBATIVE") {
    return `Résultat simulé, non probant : aucune donnée satellite n'a été consultée. Ce dossier ne peut pas servir de preuve de conformité (parcelle de ${area} ha).`;
  }
  if (status === "NON_COMPLIANT" && satellite) {
    return `NON CONFORME EUDR : déforestation détectée en ${satellite.loss_year} (après le 31/12/2020) sur une parcelle de ${area} ha.`;
  }
  // ⚠️ On n'arrive ici que si l'analyse est probante : le statut COMPLIANT
  //   n'est posé que dans ce cas. Toute autre situation est traitée plus haut.
  return `CONFORME EUDR : aucune déforestation post-2020 détectée (parcelle de ${area} ha, risque ${satellite?.risk_level}, confiance ${Math.round((satellite?.confidence_score ?? 0) * 100)} %).`;
}

export const POST = guard("analysis:run")(async (request: Request, _ctx, { tx, organizationId, session }): Promise<NextResponse> => {
  // Le texte brut est conservé : la précision des coordonnées doit être mesurée
  // sur les littéraux du fichier, pas sur les valeurs parsées (cf. P0-05).
  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const rawText = lecture.texte;
  const body = lecture.value as Record<string, unknown>;

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
  const parsedProducer = parseProducteur(body.producer);
  if ("error" in parsedProducer) return badRequest(parsedProducer.error);
  const producer =
    (body.producer as Record<string, unknown> | null | undefined)?.same_as_operator === true
      ? { name: operator.name, country: operator.country }
      : parsedProducer.producer;
  const parcelReference = typeof body.parcel_reference === "string" ? body.parcel_reference.slice(0, 100) : null;

  const validation = validateGeometry(geojson as GeoJsonInput, {
    declaredAreaHa: declaredArea,
    rawText,
  });
  const hsCode = COMMODITY_HS_CODES[body.commodity];

  let satellite: SatelliteCheckResult | null = null;
  let status: AuditStatus = "INVALID_GEOMETRY";
  if (validation.valid && validation.normalized_geometry) {
    // Aucun argument ne provient des propriétés du fichier : le verdict ne peut
    // pas être influencé par le déposant (cf. P0-03).
    satellite = await checkDeforestationRisk(validation.normalized_geometry, harvestDate);
    // Aucun verdict n'est inventé : si l'analyse n'est pas probante, le statut
    // le dit. `satellite.compliant === null` ne devient jamais « NON_COMPLIANT ».
    status =
      satellite.compliant === null
        ? satellite.source === "simulated"
          ? "SIMULATED_NON_PROBATIVE"
          : "ANALYSIS_UNAVAILABLE"
        : satellite.compliant
          ? "COMPLIANT"
          : "NON_COMPLIANT";
  }

  let rowId = crypto.randomUUID();
  let createdAt = new Date();

  try {
    const [row] = await tx
      .insert(parcelAudits)
      .values({
        organizationId,
        operatorName: operator.name,
        operatorEori: operator.eori,
        operatorCountry: operator.country ?? "FR",
        operatorAddress: operator.address ?? null,
        // Nullables : un producteur inconnu reste inconnu, il n'est pas
        // remplacé par l'opérateur.
        producerName: producer.name,
        producerCountry: producer.country,
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
        // ⚠️ `null ?? false` vaut `false` : écrire cette ligne ainsi
        // transformait « aucun verdict » en « NON CONFORME » persisté.
        compliant: satellite?.compliant ?? null,
        lossYear: satellite?.loss_year ?? null,
        confidenceScore: satellite?.confidence_score ?? null,
        analysisSource: satellite?.source ?? "unavailable",
        analysisProbative: satellite?.is_probative ?? false,
        analysisEvidence: satellite?.evidence ?? null,
        // ------------------------------------------------------------ P1-10
        // ⚠️ La provenance est persistée avec le verdict, pas à côté. Un
        //   résultat sans sa méthode n'est pas opposable : dans trois ans,
        //   « conforme » sans « par quelle méthode, quelle version, quels
        //   paramètres, sous quelles limites » ne vaudra rien devant un
        //   contrôle. Les limites sont enregistrées au même titre que le
        //   résultat — un audit qui ne dit pas ce qu'il n'a pas mesuré se fait
        //   passer pour plus complet qu'il n'est.
        analysisMethod: satellite?.provenance.method ?? "aucune",
        analysisVersion: satellite?.provenance.version ?? null,
        analysisParams: satellite?.provenance.params ?? {},
        analysisLimits: satellite?.provenance.limits ?? [
          "Aucune analyse n'a été menée : la provenance n'a pas été établie.",
        ],
        riskLevel: satellite?.risk_level ?? "HIGH",
        status,
        validation,
        satellite,
      })
      .returning({ id: parcelAudits.id, createdAt: parcelAudits.createdAt });

    if (row) {
      rowId = row.id;
      createdAt = row.createdAt;
    }
  } catch (err) {
    // P0-07 : un audit qui n'est pas enregistré ne peut pas être rendu comme
    // s'il l'était. La provenance de l'analyse (P0-04) n'a de valeur que si la
    // trace est conservée : sans persistance, il n'y a pas de dossier.
    console.error("Persistance de l'audit impossible :", err);
    return NextResponse.json(
      {
        detail:
          "Audit non enregistré : la base de données est indisponible ou le schéma n'est pas à jour. " +
          "Aucun dossier n'a été créé et le verdict affiché n'a pas été conservé.",
      },
      { status: 503 },
    );
  }

  const response: ParcelAuditResponse = {
    audit_id: rowId,
    created_at: createdAt.toISOString(),
    status,
    commodity: body.commodity,
    hs_code: hsCode,
    harvest_date: harvestDate,
    validation,
    satellite,
    eudr_cutoff_date: EUDR_CUTOFF_DATE,
    summary: summaryText(status, validation, satellite),
  };
  // ⚠️ P1-10 — une analyse non journalisée est une analyse qui n'a pas
  //   d'auteur : impossible de dire qui l'a demandée, ni quand. C'était l'une
  //   des lacunes mesurées en début de chantier.
  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "AUDIT",
    entityType: "AUDIT",
    entityId: rowId ?? "non_persisté",
    apres: {
      status,
      compliant: satellite?.compliant ?? null,
      source: satellite?.source ?? "unavailable",
      probante: satellite?.is_probative ?? false,
      methode: satellite?.provenance.method ?? "aucune",
      version: satellite?.provenance.version ?? null,
      limites: satellite?.provenance.limits?.length ?? 0,
      parcelReference,
      areaHa: validation.area_ha,
    },
    details: {
      // Ce qui distingue une preuve d'un jeu d'essai est consigné ici, dans
      // une table qu'on ne peut plus ni modifier ni effacer.
      probante: satellite?.is_probative ?? false,
      risque: satellite?.risk_level ?? "STANDARD",
    },
  });

  return NextResponse.json(response, { status: 201 });
});
