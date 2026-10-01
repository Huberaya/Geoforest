import { lireCorpsJson } from "@/lib/api/body";
import { documentVersions, documents, plots, suppliers } from "@/db/schema";
import { DOCUMENT_CATEGORIES, type ComplianceDocument, type DocumentCategory } from "@/lib/eudr/types";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { actionSuppression, logAction } from "@/lib/api/audit-log";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function daysUntil(expiry: string | null): number | null {
  if (!expiry) return null;
  const target = Date.parse(`${expiry}T00:00:00Z`);
  if (!Number.isFinite(target)) return null;
  return Math.round((target - Date.now()) / 86_400_000);
}

function toDocument(row: typeof documents.$inferSelect): ComplianceDocument {
  return {
    id: row.id,
    supplierId: row.supplierId,
    plotId: row.plotId,
    title: row.title,
    category: row.category as DocumentCategory,
    fileName: row.fileName,
    fileUrl: row.fileUrl,
    fileSize: row.fileSize,
    expiryDate: row.expiryDate,
    status: row.status as ComplianceDocument["status"],
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    daysUntilExpiry: daysUntil(row.expiryDate),

    // ------------------------------------------------------------ P1-02
    // ⚠️ Ces champs ne sont jamais acceptés en écriture (cf. PATCH plus bas) :
    // ils sont la conséquence mesurée du dépôt, pas une saisie. Les laisser
    // modifiables permettrait d'afficher un condensat qui n'est pas celui du
    // fichier — c'est-à-dire de fabriquer une preuve d'intégrité fausse.
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    mimeDetected: row.mimeDetected,
    mimeDeclared: row.mimeDeclared,
    mimeMismatch: row.mimeMismatch === true,
    version: row.version,
    scanStatus: (row.scanStatus as ComplianceDocument["scanStatus"]) ?? "NOT_SCANNED",
    scanDetail: row.scanDetail,
    scanMoteur: row.scanMoteur,
    hasFile: row.storageKey !== null,
  };
}

export const GET = guard<{ params: Promise<{ id: string }> }>("document:read")(async (
  _request: Request,
  context,
  { tx, organizationId },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });

  const [row] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.organizationId, organizationId)))
    .limit(1);
  if (!row) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });

  return NextResponse.json(toDocument(row));
});

export const PATCH = guard<{ params: Promise<{ id: string }> }>("document:write")(async (
  request: Request,
  context,
  { tx, organizationId, session },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });

  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const patch: Record<string, unknown> = {};

  if (body.title !== undefined) {
    if (str(body.title).length < 2) return NextResponse.json({ detail: "Intitulé trop court" }, { status: 422 });
    patch.title = str(body.title);
  }
  if (body.category !== undefined) {
    if (!DOCUMENT_CATEGORIES.includes(str(body.category) as DocumentCategory)) {
      return NextResponse.json({ detail: "Catégorie invalide" }, { status: 422 });
    }
    patch.category = str(body.category);
  }
  if (body.expiryDate !== undefined) {
    const expiry = str(body.expiryDate);
    if (expiry && !DATE_PATTERN.test(expiry)) {
      return NextResponse.json({ detail: "Date d'expiration invalide (AAAA-MM-JJ)" }, { status: 422 });
    }
    patch.expiryDate = expiry || null;
  }
  if (body.status !== undefined) {
    if (!["VALID", "EXPIRED", "TO_VERIFY", "REJECTED"].includes(str(body.status))) {
      return NextResponse.json({ detail: "Statut invalide" }, { status: 422 });
    }
    patch.status = str(body.status);
  }
  if (body.notes !== undefined) patch.notes = str(body.notes) || null;
  if (body.supplierId !== undefined) {
    const sid = str(body.supplierId);
    if (sid) {
      const [owner] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.id, sid), eq(suppliers.organizationId, organizationId)))
        .limit(1);
      if (!owner) return NextResponse.json({ detail: "Fournisseur introuvable" }, { status: 404 });
      patch.supplierId = sid;
    } else {
      patch.supplierId = null;
    }
  }
  if (body.plotId !== undefined) {
    const pid = str(body.plotId);
    if (pid) {
      const [owner] = await tx
        .select({ id: plots.id })
        .from(plots)
        .where(and(eq(plots.id, pid), eq(plots.organizationId, organizationId)))
        .limit(1);
      if (!owner) return NextResponse.json({ detail: "Parcelle introuvable" }, { status: 404 });
      patch.plotId = pid;
    } else {
      patch.plotId = null;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ detail: "Aucune modification transmise" }, { status: 422 });
  }

  // ------------------------------------------------------------------ P1-10
  // L'état complet d'avant est lu avant l'écriture : sans lui, « le statut du
  // document a changé » ne dit pas de quoi à quoi.
  const [avant] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.organizationId, organizationId)))
    .limit(1);

  const [row] = await tx
    .update(documents)
    .set(patch)
    .where(and(eq(documents.id, id), eq(documents.organizationId, organizationId)))
    .returning();
  if (!row) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "UPDATE",
    entityType: "DOCUMENT",
    entityId: id,
    avant: (avant ?? null) as unknown as Record<string, unknown> | null,
    apres: row as unknown as Record<string, unknown>,
    details: { fields: Object.keys(patch) },
  });

  return NextResponse.json(toDocument(row));
});

export const DELETE = guard<{ params: Promise<{ id: string }> }>("document:write")(async (
  _request: Request,
  context,
  { tx, organizationId, session },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });

  // ------------------------------------------------------------------ P1-10
  // ⚠️ La fiche est marquée, et **la pièce est conservée**.
  //
  //   Effacer le fichier au retrait de la fiche reviendrait à détruire la
  //   preuve en même temps que son index : la question « quel était le
  //   contenu exact de la pièce déposée le 12 mars ? » deviendrait
  //   impossible à trancher, alors que c'est précisément la question qu'un
  //   contrôle pose. Le condensat SHA-256, les versions antérieures et les
  //   objets du support restent donc intacts.
  //
  //   Le comptage de références introduit en P1-02 reste nécessaire — deux
  //   documents peuvent partager une clé — mais il s'applique désormais à la
  //   purge de rétention (5 ans), pas au retrait d'une fiche. On relève donc
  //   les clés pour les déclarer à la purge, sans rien effacer ici.
  const cles = (
    await tx
      .select({ cle: documentVersions.storageKey })
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, id), eq(documentVersions.organizationId, organizationId)))
  ).map((l) => l.cle);

  // ⚠️ L'écriture passe par `gf_marquer_suppression()` et non par un simple
  //   `update` : PostgreSQL applique la clause `using` des politiques `select`
  //   à la nouvelle ligne d'un `update`, et la politique de lecture masque les
  //   lignes effacées — un `update` ordinaire échouait donc, et la route
  //   répondait 500. Vérifié sur l'instance avant correction.
  const marque = await tx.execute(
    sql`select gf_marquer_suppression('gf_documents'::regclass, ${id}::uuid, ${session.user.email}) as ligne`,
  );
  const ligne = (marque.rows[0] as { ligne: Record<string, unknown> } | undefined)?.ligne;
  // ⚠️ `null` recouvre trois cas indistinguables, et c'est voulu.
  if (!ligne) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });

  await logAction(
    tx,
    organizationId,
    actionSuppression(session, "DOCUMENT", id, {
      ...ligne,
      piecesConservees: cles.length,
    }),
  );

  return new Response(null, {
    status: 204,
    headers: {
      "X-GeoForest-Deletion": "logique",
      // ⚠️ Les pièces sont conservées, et le nombre est annoncé : un
      // exploitant qui voit grossir son volume de stockage sait pourquoi, au
      // lieu de soupçonner une fuite.
      "X-GeoForest-Pieces-Conservees": String(cles.length),
      "X-GeoForest-Condensat": (ligne.sha256 as string | null) ?? "",
    },
  });
});
