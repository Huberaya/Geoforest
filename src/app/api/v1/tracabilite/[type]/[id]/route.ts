import { documentVersions, parcelAudits } from "@/db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * Reconstitution de l'historique d'un dossier — P1-10.
 *
 * Le critère du chantier est « l'historique d'un dossier est reconstituable ».
 * Ce point d'entrée rassemble, pour une entité donnée :
 *
 *   · la **chronologie** issue du journal d'audit scellé (qui, quand, avant,
 *     après) ;
 *   · les **versions** successives d'une pièce, avec leur condensat (DOCUMENT) ;
 *   · les **analyses** menées sur une parcelle, avec leur méthode (PLOT) ;
 *   · l'**état de la chaîne** au moment de la lecture.
 *
 * ⚠️ Ce qu'on ne peut pas faire, et pourquoi c'est ainsi.
 *   Une entité supprimée logiquement n'est plus visible par la politique RLS :
 *   son historique reste consultable — il est dans le journal, qui n'est pas
 *   soumis à ce filtre — mais l'entité elle-même ne l'est plus. C'est
 *   volontaire, et c'est la propriété cherchée : on peut toujours répondre
 *   « que s'est-il passé ? », jamais « rendez-moi la ligne ».
 *
 * ⚠️ La chaîne est **vérifiée à la lecture**. Un journal qu'on ne vérifie
 *   jamais ne protège de rien : la vérification doit être un réflexe, pas une
 *   procédure qu'on sort le jour du contrôle.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TYPES = new Set(["SUPPLIER", "PLOT", "DOCUMENT", "DDS", "SHIPMENT", "PRODUCT", "TASK"]);

export const GET = guard<{ params: Promise<{ type: string; id: string }> }>(
  "audit:read",
)(async (_request: Request, context, { tx, organizationId }): Promise<Response> => {
  const { type, id } = await context.params;
  const typeNormalise = type.toUpperCase();

  if (!TYPES.has(typeNormalise)) {
    return NextResponse.json(
      { detail: "Type d'entité inconnu", types: [...TYPES] },
      { status: 404 },
    );
  }
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ detail: "Identifiant invalide" }, { status: 400 });
  }

  // ------------------------------------------------------------------ chronologie
  const chronologie = await tx
    .select({
      sequence: sql<number>`sequence`,
      createdAt: sql<string>`created_at`,
      userEmail: sql<string>`user_email`,
      acteurId: sql<string | null>`acteur_id`,
      acteurRole: sql<string | null>`acteur_role`,
      action: sql<string>`action`,
      details: sql<Record<string, unknown> | null>`details`,
      avant: sql<Record<string, unknown> | null>`avant`,
      apres: sql<Record<string, unknown> | null>`apres`,
      requestId: sql<string | null>`request_id`,
    })
    .from(sql`gf_audit_logs`)
    .where(and(sql`organization_id = ${organizationId}`, sql`entity_id = ${id}`))
    .orderBy(desc(sql`sequence`))
    .limit(500);

  // ------------------------------------------------------- pièces et analyses
  let versions: unknown[] = [];
  let analyses: unknown[] = [];

  if (typeNormalise === "DOCUMENT") {
    versions = await tx
      .select({
        version: documentVersions.version,
        sha256: documentVersions.sha256,
        sizeBytes: documentVersions.sizeBytes,
        mimeDetected: documentVersions.mimeDetected,
        fileName: documentVersions.fileName,
        createdAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, id), eq(documentVersions.organizationId, organizationId)))
      .orderBy(asc(documentVersions.version));
  }

  if (typeNormalise === "PLOT") {
    // Les analyses sont rattachées à la parcelle par sa référence : le schéma
    // d'audit ne porte pas d'identifiant de parcelle. On cherche donc les deux,
    // et l'on dit lequel a répondu — une liste vide doit être explicable.
    const reference = await tx
      .select({ reference: sql<string | null>`reference` })
      .from(sql`gf_plots`)
      .where(and(sql`organization_id = ${organizationId}`, sql`id = ${id}`))
      .limit(1);
    const ref = reference[0]?.reference ?? null;

    if (ref) {
      analyses = await tx
        .select({
          id: parcelAudits.id,
          createdAt: parcelAudits.createdAt,
          compliant: parcelAudits.compliant,
          probante: parcelAudits.analysisProbative,
          methode: parcelAudits.analysisMethod,
          version: parcelAudits.analysisVersion,
          params: parcelAudits.analysisParams,
          limites: parcelAudits.analysisLimits,
          source: parcelAudits.analysisSource,
          transmissionStatus: parcelAudits.transmissionStatus,
          draftReference: parcelAudits.draftReference,
        })
        .from(parcelAudits)
        .where(and(eq(parcelAudits.organizationId, organizationId), eq(parcelAudits.parcelReference, ref)))
        .orderBy(desc(parcelAudits.createdAt))
        .limit(100);
    }
  }

  // ---------------------------------------------------------- vérification de la chaîne
  const anomalies = await tx.execute(
    sql`select sequence::text, anomalie from verifier_chaine_audit(${organizationId}) limit 20`,
  );
  const lignesAnormales = (anomalies.rows ?? []) as Array<{ sequence: string; anomalie: string }>;

  return NextResponse.json({
    entite: { type: typeNormalise, id },
    // ⚠️ Le nombre d'événements est annoncé explicitement. Une chronologie vide
    //   peut signifier deux choses très différentes — aucune action consignée,
    //   ou une entité qui n'existe pas — et le lecteur doit pouvoir trancher.
    evenements: chronologie.length,
    chronologie: chronologie.map((l) => ({
      sequence: Number(l.sequence),
      le: l.createdAt,
      qui: l.userEmail,
      acteurId: l.acteurId,
      role: l.acteurRole,
      action: l.action,
      avant: l.avant,
      apres: l.apres,
      details: l.details,
      requestId: l.requestId,
    })),
    versions,
    analyses,
    integrite: {
      chaineValide: lignesAnormales.length === 0,
      anomalies: lignesAnormales,
      // ⚠️ Dit ce que la vérification couvre : l'organisation entière, pas la
      //   seule entité demandée. Une chaîne se rompt à un rang ; on ne peut pas
      //   la vérifier entité par entité.
      portee: "organisation",
    },
  });
});
