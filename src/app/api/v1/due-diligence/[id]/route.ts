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
import { aujourdhuiIso, chargerDossier, recalculerDossier } from "@/lib/eudr/readiness-db";
import { estFige, TRANSITIONS, verifierTransitionManuelle } from "@/lib/eudr/dds-etats";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


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
  // P0 (recette 2026-10-08) — la readiness est calculée à partir des faits
  // rattachés, jamais lue dans un champ saisi à la main.
  const charge = await chargerDossier(tx, organizationId, id, aujourdhuiIso());
  return NextResponse.json({
    readiness: charge
      ? {
          etat: charge.resultat.etat,
          completude: charge.resultat.completude,
          risque: charge.resultat.risque,
          blocages: charge.resultat.blocages,
          manquants: charge.resultat.manquants,
          explication: charge.resultat.explication,
        }
      : null,
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

  // B-12 — un dossier figé (prêt, exporté, soumis, déclaré) ne change pas de données :
  // un brouillon exporté ne doit pas diverger du dossier. Repasser en revue d'abord.
  if ((body.title !== undefined || body.netWeightKg !== undefined) && estFige(current.status as DdsStatus)) {
    const issue =
      current.status === "READY_FOR_DECLARATION" || current.status === "EXPORTED"
        ? "Repassez-le en revue (statut « UNDER_REVIEW ») avant toute modification."
        : "Aucune modification n'est possible à ce stade.";
    return NextResponse.json(
      { detail: `Dossier figé (statut « ${current.status} ») : ses données ne se modifient pas. ${issue}` },
      { status: 409 },
    );
  }

  if (body.title !== undefined) {
    if (str(body.title).length < 2) return NextResponse.json({ detail: "Intitulé trop court" }, { status: 422 });
    patch.title = str(body.title);
  }
  // ------------------------------------------------------------ P0 (recette 2026-10-08)
  // Le niveau de risque et la complétude sont CALCULÉS à partir des analyses et
  // des pièces rattachées. Les accepter en saisie permettait d'afficher un
  // dossier « risque LOW, complétude 100 % » sans aucune donnée derrière.
  if (body.riskLevel !== undefined || body.completenessScore !== undefined) {
    return NextResponse.json(
      {
        detail:
          "Le niveau de risque et la complétude sont calculés à partir des parcelles analysées et des pièces " +
          "rattachées : ils ne se saisissent pas. Consultez GET /api/v1/due-diligence/{id} (readiness).",
      },
      { status: 409 },
    );
  }
  // C7 (main) expose `completeness_score_ignore` : ici le score reçu est refusé
  // en amont (409), il n'est donc jamais « ignoré ».
  const scoreRecu = false;
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
    // Refus explicite des cibles réservées (SUBMITTED, DECLARED, EXPORTED) et des
    // enchaînements non admis : voir src/lib/eudr/dds-etats.ts.
    const from = current.status as DdsStatus;
    const verdict = verifierTransitionManuelle(from, next as DdsStatus);
    if (!verdict.admise) {
      return NextResponse.json({ detail: verdict.motif }, { status: 409 });
    }
    if (next === "READY_FOR_DECLARATION") {
      // ---------------------------------------------------------- P0 : porte de sortie
      // Le passage à « prêt pour déclaration » exige une revue humaine (le dossier
      // est en UNDER_REVIEW) ET un moteur sans blocage ni donnée manquante.
      const charge = await chargerDossier(tx, organizationId, id, aujourdhuiIso());
      if (!charge) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });
      const readinessRefuse = charge.resultat.etat !== "READY_FOR_REVIEW";
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
      //
      // Les deux contrôles vivent dans le même bloc et sont TOUS DEUX évalués
      // avant de répondre : readiness P0 (moteur sans blocage ni donnée
      // manquante) et examen C7 (conditions constatées, avec pour chaque manque
      // l'action à mener). Un refus porte donc toujours `manques` et
      // `score_calcule` (contrat C7), et `readiness` quand le moteur s'oppose
      // aussi. Répondre dès le premier refus avait été mesuré (10/11/2026,
      // parcours bout en bout) : le client recevait un 409 sans manque énuméré.
      const tasks = await tx
        .select()
        .from(complianceTasks)
        .where(and(eq(complianceTasks.organizationId, organizationId), eq(complianceTasks.diligenceId, id)));

      const examen = await examiner(tx, organizationId, current, tasks, new Date().toISOString().slice(0, 10));

      if (!examen.complet || readinessRefuse) {
        // 409 et non 422 : la requête est bien formée, c'est l'ÉTAT du dossier
        // qui s'oppose à la transition. Le message énumère les manques, avec
        // pour chacun ce qu'il faut faire — un refus qui n'explique pas se
        // contourne au lieu de se corriger.
        const manques = [...examen.manques];
        if (readinessRefuse && examen.complet) {
          // Le moteur s'oppose alors que l'examen est complet : le refus doit
          // quand même nommer ce qu'il faut faire, pas seulement l'état.
          manques.push({
            code: "MOTEUR_NON_PRET",
            gravite: "bloquant",
            detail: charge.resultat.explication,
            action:
              "Lever les blocages et compléter les données manquantes listés dans `readiness`, puis relancer l'analyse.",
          });
        }
        return NextResponse.json(
          {
            detail:
              `Dossier non validable : ${manques.length} condition(s) ne sont pas tenues. ` +
              "Un dossier n'est « prêt à déclarer » que lorsque le produit a pu le constater." +
              (readinessRefuse
                ? ` Moteur : état « ${charge.resultat.etat} ». ${charge.resultat.explication}`
                : ""),
            manques,
            score_calcule: examen.score,
            base_de_calcul: examen.baseDeCalcul,
            readiness: {
              etat: charge.resultat.etat,
              blocages: charge.resultat.blocages,
              manquants: charge.resultat.manquants,
            },
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
  // Les champs calculés suivent toujours les faits, après chaque modification.
  await recalculerDossier(tx, organizationId, id, aujourdhuiIso());

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

  const relu = await chargerDossier(tx, organizationId, id, aujourdhuiIso());
  return NextResponse.json({
    id: row.id,
    reference: row.reference,
    status: row.status as DdsStatus,
    riskLevel: relu?.dds.riskLevel ?? (row.riskLevel as RiskLevel),
    completenessScore: relu?.dds.completenessScore ?? row.completenessScore,
    readiness: relu
      ? { etat: relu.resultat.etat, blocages: relu.resultat.blocages, manquants: relu.resultat.manquants }
      : null,
    updatedAt: row.updatedAt.toISOString(),
    transmissionStatus: "NOT_TRANSMITTED",
    // ⚠️ C7 — dit explicitement que le score reçu n'a pas été retenu. Un champ
    //   ignoré en silence se lit comme un champ pris en compte.
    completeness_score_ignore: scoreRecu,
    allowed_transitions: TRANSITIONS[row.status as DdsStatus] ?? [],
  });
});
