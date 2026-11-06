import { lireCorpsJson } from "@/lib/api/body";
import {
  complianceTasks,
  documents,
  dueDiligenceStatements,
  parcelAudits,
  plots,
  products,
  suppliers,
} from "@/db/schema";
import { DDS_STATUSES, type Commodity, type DdsStatus, type RiskLevel } from "@/lib/eudr/types";
import { examinerDossier, type DossierAExaminer, type ParcelleDuDossier } from "@/lib/eudr/validateur-dossier";
import type { TenantTx } from "@/lib/tenant";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Transitions de statut autorisées pour un dossier de diligence raisonnée.
 *
 * ⚠️ P0-06 : `DECLARED` est délibérément **inatteignable**. Une déclaration
 * n'existe qu'après un accusé du système d'information EUDR, qu'aucun
 * composant de ce produit ne peut obtenir à ce jour.
 */
const TRANSITIONS: Record<DdsStatus, DdsStatus[]> = {
  DRAFT: ["MISSING_DATA", "IN_ANALYSIS", "ARCHIVED"],
  MISSING_DATA: ["DRAFT", "IN_ANALYSIS", "ARCHIVED"],
  IN_ANALYSIS: ["UNDER_REVIEW", "RISK_IDENTIFIED", "MISSING_DATA", "ARCHIVED"],
  UNDER_REVIEW: ["RISK_IDENTIFIED", "ACTION_REQUIRED", "READY_FOR_DECLARATION", "IN_ANALYSIS", "ARCHIVED"],
  RISK_IDENTIFIED: ["ACTION_REQUIRED", "UNDER_REVIEW", "ARCHIVED"],
  ACTION_REQUIRED: ["UNDER_REVIEW", "RISK_IDENTIFIED", "ARCHIVED"],
  READY_FOR_DECLARATION: ["UNDER_REVIEW", "ACTION_REQUIRED", "ARCHIVED"],
  DECLARED: ["ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

/**
 * Rassemble ce que l'examen du dossier doit lire, et rien de plus.
 *
 * ⚠️ Appelée seulement avant une transition vers `READY_FOR_DECLARATION`.
 *
 *   `GET` est une lecture d'écran : elle ne paie pas quatre requêtes
 *   supplémentaires pour afficher un statut. L'examen n'a lieu qu'au moment où
 *   l'on prétend que le dossier est complet — c'est-à-dire rarement.
 *
 * ⚠️ Les parcelles sont rattachées par le FOURNISSEUR du dossier.
 *
 *   Le schéma ne porte pas de lien direct dossier ↔ parcelle ; c'est le seul
 *   chemin que les données permettent. Il est consigné en D-005 plutôt que
 *   laissé implicite, parce qu'un dossier sans fournisseur ne peut, par
 *   construction, examiner aucune parcelle — et le validateur le dit
 *   explicitement (`SANS_PARCELLE`) au lieu de conclure à un dossier vide.
 *
 * ⚠️ L'analyse d'une parcelle est lue par `plot_id` (C7, migration 0008).
 *   Auparavant, seul `parcel_reference` existait : du texte libre. Une analyse
 *   ne pouvait donc pas être rattachée à une parcelle de façon vérifiable, et
 *   un dossier ne pouvait pas savoir ce qui avait été analysé.
 */
async function examiner(
  tx: TenantTx,
  organizationId: string,
  dds: typeof dueDiligenceStatements.$inferSelect,
  taches: Array<{ id: string; status: string; severity: string }>,
  aujourdhui: string,
): Promise<ReturnType<typeof examinerDossier>> {
  const lignes =
    dds.supplierId === null
      ? []
      : await tx
          .select()
          .from(plots)
          .where(and(eq(plots.organizationId, organizationId), eq(plots.supplierId, dds.supplierId)));

  const ids = lignes.map((p) => p.id);

  // Dernière analyse par parcelle : tri par date décroissante, première
  // rencontrée conservée. Un audit ancien ne doit pas prendre la place du plus
  // récent — c'est le dernier état constaté qui fait foi.
  const analyses =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(parcelAudits)
          .where(and(eq(parcelAudits.organizationId, organizationId), inArray(parcelAudits.plotId, ids)))
          .orderBy(desc(parcelAudits.createdAt));

  const derniere = new Map<string, (typeof analyses)[number]>();
  for (const a of analyses) {
    if (a.plotId && !derniere.has(a.plotId)) derniere.set(a.plotId, a);
  }

  const pieces =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(documents)
          .where(and(eq(documents.organizationId, organizationId), inArray(documents.plotId, ids)));

  const parcelles: ParcelleDuDossier[] = lignes.map((p) => {
    const a = derniere.get(p.id) ?? null;
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      countryCode: p.countryCode,
      countryStatut: a?.countryStatut ?? null,
      areaHa: p.areaHa,
      derniereAnalyse: a
        ? {
            analysisSource: a.analysisSource,
            analysisProbative: a.analysisProbative,
            status: a.status,
            harvestDate: a.harvestDate,
          }
        : null,
      documents: pieces
        .filter((d) => d.plotId === p.id && d.deletedAt === null)
        .map((d) => ({ id: d.id, category: d.category, status: d.status, expiryDate: d.expiryDate })),
    };
  });

  const aExaminer: DossierAExaminer = {
    id: dds.id,
    status: dds.status,
    supplierId: dds.supplierId,
    productId: dds.productId,
    commodity: dds.commodity,
    parcelles,
    taches,
  };
  return examinerDossier(aExaminer, aujourdhui);
}

export const GET = guard<{ params: Promise<{ id: string }> }>("dds:read")(async (
  _request: Request,
  context,
  { tx, organizationId },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });

  const [row] = await tx
    .select({ dds: dueDiligenceStatements, supplierName: suppliers.name, productName: products.name })
    .from(dueDiligenceStatements)
    .leftJoin(suppliers, eq(suppliers.id, dueDiligenceStatements.supplierId))
    .leftJoin(products, eq(products.id, dueDiligenceStatements.productId))
    .where(and(eq(dueDiligenceStatements.id, id), eq(dueDiligenceStatements.organizationId, organizationId)))
    .limit(1);
  if (!row) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });

  const tasks = await tx
    .select()
    .from(complianceTasks)
    .where(and(eq(complianceTasks.organizationId, organizationId), eq(complianceTasks.diligenceId, id)))
    .orderBy(complianceTasks.createdAt);

  return NextResponse.json({
    id: row.dds.id,
    reference: row.dds.reference,
    title: row.dds.title,
    commodity: row.dds.commodity as Commodity,
    supplierId: row.dds.supplierId,
    supplierName: row.supplierName,
    productId: row.dds.productId,
    productName: row.productName,
    status: row.dds.status as DdsStatus,
    riskLevel: row.dds.riskLevel as RiskLevel,
    completenessScore: row.dds.completenessScore,
    plotsCount: row.dds.plotsCount,
    totalAreaHa: row.dds.totalAreaHa,
    netWeightKg: row.dds.netWeightKg,
    createdAt: row.dds.createdAt.toISOString(),
    updatedAt: row.dds.updatedAt.toISOString(),
    transmissionStatus: "NOT_TRANSMITTED",
    transmission_notice:
      "Aucune déclaration n'a été déposée : le dépôt dans le système d'information EUDR " +
      "reste à réaliser par l'opérateur.",
    allowed_transitions: TRANSITIONS[row.dds.status as DdsStatus] ?? [],
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      severity: t.severity,
      status: t.status,
      assignee: t.assignee,
      dueDate: t.dueDate,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

export const PATCH = guard<{ params: Promise<{ id: string }> }>("dds:validate")(async (
  request: Request,
  context,
  { tx, organizationId, session },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });

  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as Record<string, unknown>;

  const [current] = await tx
    .select()
    .from(dueDiligenceStatements)
    .where(and(eq(dueDiligenceStatements.id, id), eq(dueDiligenceStatements.organizationId, organizationId)))
    .limit(1);
  if (!current) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (body.title !== undefined) {
    if (str(body.title).length < 2) return NextResponse.json({ detail: "Intitulé trop court" }, { status: 422 });
    patch.title = str(body.title);
  }
  if (body.riskLevel !== undefined) {
    if (!["LOW", "STANDARD", "HIGH", "CRITICAL"].includes(str(body.riskLevel))) {
      return NextResponse.json({ detail: "Niveau de risque invalide" }, { status: 422 });
    }
    patch.riskLevel = str(body.riskLevel);
  }
  // ⚠️ C7 — le score de complétude n'est plus reçu du client.
  //
  //   Il était écrit tel quel dans la ligne (`patch.completenessScore =
  //   Math.round(score)`), ce qui permettait de déclarer à 100 % un dossier
  //   vide dans la même requête que son passage en « prêt à déclarer ». Un
  //   score de complétude est une MESURE : il se calcule à partir des données
  //   du dossier, comme `supplierCompleteness()` le fait pour les fournisseurs.
  //
  //   Le champ reste accepté dans le corps pour ne pas casser les clients
  //   existants — mais il est ignoré, et la réponse le dit explicitement
  //   (`completeness_score_ignore`). Le refuser en 422 aurait rendu illisible
  //   un écran qui l'envoie encore ; l'ignorer en silence aurait laissé croire
  //   qu'il a été pris en compte.
  const scoreRecu = body.completenessScore !== undefined;
  if (body.netWeightKg !== undefined) {
    const weight = Number(body.netWeightKg);
    if (!Number.isFinite(weight) || weight < 0) {
      return NextResponse.json({ detail: "Poids net invalide" }, { status: 422 });
    }
    patch.netWeightKg = weight;
  }

  if (body.status !== undefined) {
    const next = str(body.status);
    if (!DDS_STATUSES.includes(next as DdsStatus)) {
      return NextResponse.json({ detail: "Statut inconnu" }, { status: 422 });
    }
    if (next === "DECLARED") {
      // Refus explicite plutôt qu'un statut vide de sens.
      return NextResponse.json(
        {
          detail:
            "Le statut « DECLARED » ne peut pas être attribué depuis cette application : " +
            "il suppose un accusé du système d'information EUDR, qu'aucun composant du " +
            "produit ne peut obtenir aujourd'hui.",
        },
        { status: 409 },
      );
    }
    const from = current.status as DdsStatus;
    if (!(TRANSITIONS[from] ?? []).includes(next as DdsStatus)) {
      return NextResponse.json(
        { detail: `Transition refusée : « ${from} » → « ${next} » n'est pas un enchaînement admis.` },
        { status: 409 },
      );
    }
    // ⚠️ C7 — le cœur de la correction.
    //
    //   `TRANSITIONS` était le SEUL filtre : un dossier créé par `POST` —
    //   aucune parcelle, aucun document, aucune tâche — passait « prêt à
    //   déclarer » en un clic. Le produit enregistrait une affirmation ; il ne
    //   constatait rien.
    //
    //   Seule la transition VERS `READY_FOR_DECLARATION` est examinée. Les
    //   autres (retour en revue, archivage, brouillon) ne prétendent rien : les
    //   soumettre à un examen rendrait impossible de constater un dossier
    //   incomplet — c'est-à-dire de le corriger.
    if (next === "READY_FOR_DECLARATION") {
      const tasks = await tx
        .select()
        .from(complianceTasks)
        .where(and(eq(complianceTasks.organizationId, organizationId), eq(complianceTasks.diligenceId, id)));

      const examen = await examiner(tx, organizationId, current, tasks, new Date().toISOString().slice(0, 10));

      if (!examen.complet) {
        // 409 et non 422 : la requête est bien formée, c'est l'ÉTAT du dossier
        // qui s'oppose à la transition. Le message énumère les manques, avec
        // pour chacun ce qu'il faut faire — un refus qui n'explique pas se
        // contourne au lieu de se corriger.
        return NextResponse.json(
          {
            detail:
              `Dossier non validable : ${examen.manques.length} condition(s) ne sont pas tenues. ` +
              "Un dossier n'est « prêt à déclarer » que lorsque le produit a pu le constater.",
            manques: examen.manques,
            score_calcule: examen.score,
            base_de_calcul: examen.baseDeCalcul,
          },
          { status: 409 },
        );
      }

      // Le score enregistré est celui de l'examen, jamais celui du client.
      patch.completenessScore = examen.score;
      patch.plotsCount = examen.baseDeCalcul.parcelles;
      patch.totalAreaHa = examen.baseDeCalcul.surfaceHa;
    }

    patch.status = next;
  }

  // ------------------------------------------------------------------ P1-10
  // L'état complet d'avant est lu avant l'écriture : une modification
  // consignée sous la forme « champ modifié » ne permet pas de répondre
  // « de quelle valeur à quelle valeur ? », qui est la seule question utile.
  const [avant] = await tx
    .select()
    .from(dueDiligenceStatements)
    .where(and(eq(dueDiligenceStatements.id, id), eq(dueDiligenceStatements.organizationId, organizationId)))
    .limit(1);

  const [row] = await tx
    .update(dueDiligenceStatements)
    .set(patch)
    .where(and(eq(dueDiligenceStatements.id, id), eq(dueDiligenceStatements.organizationId, organizationId)))
    .returning();
  if (!row) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: body.status !== undefined ? "VALIDATE" : "UPDATE",
    entityType: "DDS",
    entityId: id,
    avant: avant as unknown as Record<string, unknown> | null,
    apres: row as unknown as Record<string, unknown>,
    details: { fields: Object.keys(patch).filter((k) => k !== "updatedAt") },
  });

  return NextResponse.json({
    id: row.id,
    reference: row.reference,
    status: row.status as DdsStatus,
    riskLevel: row.riskLevel as RiskLevel,
    completenessScore: row.completenessScore,
    updatedAt: row.updatedAt.toISOString(),
    transmissionStatus: "NOT_TRANSMITTED",
    // ⚠️ C7 — dit explicitement que le score reçu n'a pas été retenu. Un champ
    //   ignoré en silence se lit comme un champ pris en compte.
    completeness_score_ignore: scoreRecu,
    allowed_transitions: TRANSITIONS[row.status as DdsStatus] ?? [],
  });
});
