import { lireCorpsJson } from "@/lib/api/body";
import { parcelAudits } from "@/db/schema";
import { logAction } from "@/lib/api/audit-log";
import { buildDdsPayload, buildReference, buildTracesXml, producteurDe, type TracesOptions } from "@/lib/eudr/traces-exporter";
import {
  classerIdentite,
  identiteComplete,
  identiteDeclaree,
  nomValide,
  paysValide,
  type IdentiteOperateur,
} from "@/lib/eudr/identite-operateur";
import { buildEudrIsGeoJson } from "@/lib/eudr/eudr-is-geojson";
import type { ActivityType, TracesFormat } from "@/lib/eudr/types";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVITIES: ActivityType[] = ["IMPORT", "EXPORT", "DOMESTIC"];

/**
 * Refus d'un export dont l'identité opérateur n'est pas exploitable.
 * Code stable `OPERATOR_IDENTITY_MISSING` (HTTP 422), attendu par les tests et
 * par l'interface : un export incomplet n'est jamais produit « au mieux ».
 */
function refusIdentite(detail: string, details: unknown): NextResponse {
  return NextResponse.json(
    { detail, error: { code: "OPERATOR_IDENTITY_MISSING", message: detail, details } },
    { status: 422 },
  );
}

export const POST = guard("export:run")(async (request: Request, _ctx, { tx, organizationId, session }): Promise<Response> => {
  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as Record<string, unknown>;

  const auditId = typeof body.audit_id === "string" ? body.audit_id : "";
  if (!auditId) return NextResponse.json({ detail: "audit_id requis" }, { status: 422 });
  if (!UUID_PATTERN.test(auditId)) return NextResponse.json({ detail: "Audit introuvable" }, { status: 404 });

  // P0-07 : plus de `catch` silencieux. Un incident de base est déclaré, il ne
  // se déguise pas en « audit introuvable ».
  const [row] = await tx
    .select()
    .from(parcelAudits)
    .where(and(eq(parcelAudits.id, auditId), eq(parcelAudits.organizationId, organizationId)))
    .limit(1);
  if (!row) return NextResponse.json({ detail: "Audit introuvable" }, { status: 404 });
  if (row.status === "INVALID_GEOMETRY") {
    return NextResponse.json(
      { detail: "Impossible d'exporter un dossier dont la géométrie est invalide : corrigez la parcelle puis relancez l'audit." },
      { status: 409 },
    );
  }
  // ------------------------------------------------------------------ P0
  // Identité de l'opérateur — contrôlée AVANT toute autre condition d'export.
  //
  // ⚠️ L'ordre est délibéré : un audit ancien sans identité doit répondre
  //   422 `OPERATOR_IDENTITY_MISSING`, même si son analyse est simulée. Sinon
  //   le refus « analyse non probante » masquerait le défaut d'identité et
  //   laisserait croire qu'il suffit de configurer GFW pour exporter.
  let operator: IdentiteOperateur | null = null;
  if (body.operator !== null && body.operator !== undefined) {
    if (typeof body.operator !== "object" || Array.isArray(body.operator)) {
      return refusIdentite("operator doit être un objet.", { champs: ["operator"] });
    }
    const declare = body.operator as Record<string, unknown>;
    operator = identiteDeclaree(declare);
    if (!operator) {
      const classement = classerIdentite({
        name: typeof declare.name === "string" ? declare.name : null,
        eori: typeof declare.eori === "string" ? declare.eori : null,
        country: typeof declare.country === "string" ? declare.country : null,
      });
      return refusIdentite(
        "Identité opérateur incomplète ou fictive : aucun export ne peut être produit. " +
          "Fournissez un nom réel, un EORI valide et un pays ISO à deux lettres.",
        {
          manquants: classement.manquants,
          invalides: classement.invalides,
          motifs: classement.motifs,
        },
      );
    }
  } else {
    operator = identiteComplete({
      name: row.operatorName,
      eori: row.operatorEori,
      country: row.operatorCountry,
    });
    if (!operator) {
      const classement = classerIdentite({
        name: row.operatorName,
        eori: row.operatorEori,
        country: row.operatorCountry,
      });
      return refusIdentite(
        "Identité opérateur absente de ce dossier : aucun export ne peut être produit. " +
          "Renseignez `operator` (nom, EORI, pays) puis relancez l'export. " +
          "Aucune identité fictive n'est substituée.",
        {
          manquants: classement.manquants,
          invalides: classement.invalides,
          motifs: classement.motifs,
        },
      );
    }
  }

  // P0-04 : une analyse simulée ou indisponible ne peut pas alimenter une
  // déclaration de diligence raisonnée. Le contrôle est fait ici, côté serveur :
  // l'interface n'est pas une barrière.
  if (!row.analysisProbative) {
    return NextResponse.json(
      {
        detail:
          row.analysisSource === "simulated"
            ? "Export refusé : l'analyse de cette parcelle est une simulation de démonstration, sans valeur probante. Configurez un accès aux données Global Forest Watch puis relancez l'audit."
            : "Export refusé : aucune analyse satellite n'a pu être obtenue pour cette parcelle. Aucune déclaration ne peut être établie sans données réelles.",
        analysis_source: row.analysisSource,
        is_probative: false,
      },
      { status: 409 },
    );
  }

  const format: TracesFormat =
    body.format === "geojson" ? "geojson" : body.format === "json" ? "json" : "xml";
  const activityType = ACTIVITIES.includes(body.activity_type as ActivityType) ? (body.activity_type as ActivityType) : "IMPORT";
  const netWeightRaw = body.net_weight_kg;
  const netWeightKg = netWeightRaw === null || netWeightRaw === undefined || netWeightRaw === "" ? null : Number(netWeightRaw);
  if (netWeightKg !== null && (!Number.isFinite(netWeightKg) || netWeightKg < 0)) {
    return NextResponse.json({ detail: "net_weight_kg doit être ≥ 0" }, { status: 422 });
  }
  const internalReference = typeof body.internal_reference === "string" && body.internal_reference.trim() ? body.internal_reference.trim().slice(0, 50) : null;

  // P0 — plus de pays d'activité par défaut (« FR »), et plus de déduction
  // silencieuse depuis le pays de l'opérateur : le pays d'activité est un fait
  // déclaratif, il doit être fourni. Une valeur absente n'est pas remplacée.
  const paysDemande =
    typeof body.country_of_activity === "string" ? body.country_of_activity.trim().toUpperCase() : "";
  if (!paysDemande) {
    return NextResponse.json(
      {
        detail:
          "country_of_activity requis : pays d'activité au format ISO à deux lettres. " +
          "Aucun pays n'est déduit de l'opérateur ni d'une valeur par défaut.",
        error: { code: "COUNTRY_OF_ACTIVITY_MISSING" },
      },
      { status: 422 },
    );
  }
  if (!paysValide(paysDemande)) {
    return NextResponse.json(
      {
        detail:
          "country_of_activity doit être un code pays ISO à deux lettres, distinct de XX.",
        error: { code: "COUNTRY_OF_ACTIVITY_INVALID" },
      },
      { status: 422 },
    );
  }
  const countryOfActivity = paysDemande;

  const options: TracesOptions = { activityType, netWeightKg, internalReference, countryOfActivity };
  const reference = internalReference ?? buildReference(row.id);

  // P1-16 — le producteur est une donnée de la déclaration, pas une copie de
  // l'opérateur. Il peut être fourni ici lorsqu'il ne l'a pas été à l'audit :
  // le renseigner au moment de l'export évite de refaire une analyse satellite
  // pour une information déclarative. En revanche, s'il manque toujours,
  // l'export est REFUSÉ : une déclaration qui nommerait l'opérateur à la place
  // du producteur désignerait une entité qui n'a pas produit la marchandise.
  let producerName: string | null = row.producerName ?? null;
  let producerCountry: string | null = row.producerCountry ?? null;
  const brutProducer = body.producer;
  if (producerName === null && brutProducer && typeof brutProducer === "object") {
    const p = brutProducer as Record<string, unknown>;
    if (p.same_as_operator === true) {
      producerName = operator.name;
      producerCountry = operator.country;
    } else {
      const nom = typeof p.name === "string" ? p.name.trim() : "";
      const pays = typeof p.country === "string" ? p.country.trim().toUpperCase() : "";
      if (!nomValide(nom)) {
        return NextResponse.json({ detail: "producer.name : nom réel de 2 à 200 caractères requis" }, { status: 422 });
      }
      if (!paysValide(pays)) {
        return NextResponse.json(
          {
            detail: "producer.country : code pays ISO à 2 lettres requis (XX interdit).",
            error: { code: "PRODUCER_IDENTITY_INCOMPLETE" },
          },
          { status: 422 },
        );
      }
      producerName = nom;
      producerCountry = pays;
    }
  }
  if (producerName === null) {
    return NextResponse.json(
      {
        detail:
          "Producteur non déclaré : aucun export ne peut être produit. " +
          "Renseignez le producteur (`producer`, ou `producer.same_as_operator: true` " +
          "s'il est identique à l'opérateur) puis relancez l'export.",
        producer_required: true,
      },
      { status: 409 },
    );
  }
  if (!producerCountry || !paysValide(producerCountry)) {
    return NextResponse.json(
      {
        detail:
          "Identité du producteur incomplète : le pays du producteur doit être un code ISO " +
          "à deux lettres (XX interdit). Aucun pays n'est déduit de la parcelle.",
        error: { code: "PRODUCER_IDENTITY_INCOMPLETE" },
      },
      { status: 422 },
    );
  }
  if (row.producerName === null) {
    // Déclaré à l'export : on l'attache à l'audit pour que la traçabilité soit
    // complète et que les exports suivants n'aient pas à le redemander.
    await tx
      .update(parcelAudits)
      .set({ producerName, producerCountry })
      .where(and(eq(parcelAudits.id, row.id), eq(parcelAudits.organizationId, organizationId)));
    row.producerName = producerName;
    row.producerCountry = producerCountry;
  }
  const producteur = producteurDe(row);

  await tx
    .update(parcelAudits)
    .set({
      draftReference: reference,
      draftGeneratedAt: new Date(),
      // P0-06 : générer un fichier n'est pas transmettre une déclaration.
      // Ce champ ne peut valoir autre chose que NOT_TRANSMITTED tant qu'aucun
      // appel authentifié au SI EUDR n'a renvoyé un accusé.
      transmissionStatus: "NOT_TRANSMITTED",
    })
    .where(and(eq(parcelAudits.id, row.id), eq(parcelAudits.organizationId, organizationId)));

  // ------------------------------------------------------------------ P1-10
  // ⚠️ Un export est un acte opposable : il engage l'opérateur, et sa
  //   traçabilité est exigée par le règlement. Le consigner ici le rend
  //   postérieur à la persistance (P0-07) : si l'écriture échoue, aucune trace
  //   d'export n'est produite — plutôt que l'inverse.
  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "EXPORT",
    entityType: "AUDIT",
    entityId: row.id,
    apres: {
      reference,
      format: row.draftReference === reference ? "regeneré" : "nouveau",
      transmissionStatus: "NOT_TRANSMITTED",
    },
    details: {
      // P0-06 — le mot est dans le journal, pas seulement dans le nom du
      // fichier : « exporté » ne veut jamais dire « transmis ».
      nature: "brouillon_non_transmis",
      probante: row.analysisProbative,
      methode: row.analysisMethod,
      versionAnalyse: row.analysisVersion,
      producteur: producteur?.name ?? null,
    },
  });

  // Le nom du fichier doit se lire comme ce qu'il est : un brouillon.
  const filename = `BROUILLON_DDS_${reference}`;

  if (format === "geojson") {
    const built = buildEudrIsGeoJson([
      {
        geometry: (row.geometry ?? { type: "Point", coordinates: [row.centroidLon, row.centroidLat] }) as never,
        areaHa: row.areaHa,
        producerName: producteur?.name ?? null,
        producerCountry: producteur?.country ?? null,
        productionPlace: row.parcelReference ?? row.id,
      },
    ]);
    return new Response(JSON.stringify(built.geojson, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/geo+json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.geojson"`,
        "X-GeoForest-Transmission-Status": "NOT_TRANSMITTED",
        "X-GeoForest-Warnings": Buffer.from(built.warnings.join(" | "), "utf-8")
          .toString("base64url")
          .slice(0, 1000),
      },
    });
  }

  if (format === "json") {
    return new Response(JSON.stringify(buildDdsPayload(row, operator, options), null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.json"`,
        "X-GeoForest-Transmission-Status": "NOT_TRANSMITTED",
      },
    });
  }

  return new Response(buildTracesXml(row, operator, options), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.xml"`,
      "X-GeoForest-Transmission-Status": "NOT_TRANSMITTED",
    },
  });
});
