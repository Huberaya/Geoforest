import { logAction } from "@/lib/api/audit-log";
import { lireCorpsMultipart } from "@/lib/api/multipart";
import { documents } from "@/db/schema";
import { deposerPiece } from "@/lib/storage/depot";
import { stockageValide } from "@/lib/storage";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dépose une **nouvelle version** d'une pièce.
 *
 * ⚠️ L'ancienne version n'est ni écrasée ni effacée. Un dossier de conformité
 * s'audite après coup : on doit pouvoir établir quelle pièce était jointe à
 * une date donnée. Remplacer le fichier rendrait cette question impossible à
 * trancher, et le condensat conservé ne correspondrait plus à rien de
 * vérifiable.
 */
export const POST = guard<{ params: Promise<{ id: string }> }>("document:write")(async (
  request: Request,
  context,
  { tx, organizationId, session },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });

  // Appartenance vérifiée AVANT tout accès au support : une pièce rattachée à
  // un document d'une autre organisation serait écrite sous le répertoire de
  // l'appelant, donc hors de portée de son véritable propriétaire.
  const [doc] = await tx
    .select({ id: documents.id, version: documents.version })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.organizationId, organizationId)))
    .limit(1);
  if (!doc) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });

  const lecture = await lireCorpsMultipart(request);
  if (!lecture.ok) return lecture.response;

  const fichier = lecture.value.fichiers[0];
  if (!fichier) {
    return NextResponse.json({ detail: "Aucun fichier dans la requête (champ attendu : file)" }, { status: 422 });
  }

  // ------------------------------------------------------------------ P1-10
  // L'état d'avant est relu avant le dépôt : une nouvelle version sans trace
  // de l'ancienne rendrait impossible de dire quelle pièce était jointe à une
  // date donnée — la question même qu'un contrôle pose.
  const [avant] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, doc.id), eq(documents.organizationId, organizationId)))
    .limit(1);

  const depot = await deposerPiece(tx, organizationId, doc.id, fichier, session.user.email);
  if (depot.refuse) return NextResponse.json({ detail: depot.detail }, { status: depot.statut });

  const [apres] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, doc.id), eq(documents.organizationId, organizationId)))
    .limit(1);

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "UPDATE",
    entityType: "DOCUMENT",
    entityId: doc.id,
    avant: (avant ?? null) as unknown as Record<string, unknown> | null,
    apres: (apres ?? null) as unknown as Record<string, unknown> | null,
    details: {
      action: "NOUVELLE_VERSION",
      version: depot.piece.version,
      versionPrecedente: doc.version,
      sha256: depot.piece.sha256,
      sizeBytes: depot.piece.taille,
      mimeDetected: depot.piece.typeReel.mime,
      scanStatus: depot.piece.analyse.statut,
    },
  });

  return NextResponse.json(
    {
      documentId: doc.id,
      version: depot.piece.version,
      versionPrecedente: doc.version,
      fileName: depot.piece.nomFichier,
      sha256: depot.piece.sha256,
      sizeBytes: depot.piece.taille,
      mimeDetected: depot.piece.typeReel.mime,
      mimeDeclared: depot.piece.typeDeclare,
      typeTrompeur: depot.piece.typeTrompeur,
      scanStatus: depot.piece.analyse.statut,
      scanMoteur: depot.piece.analyse.moteur,
      supportValide: stockageValide(),
      warnings: depot.piece.avertissements,
      notice: "L'ancienne version est conservée et reste consultable.",
    },
    { status: 201 },
  );
});
