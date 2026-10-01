import { documents, documentVersions } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Historique des versions d'une pièce.
 *
 * ⚠️ Aucune suppression n'est exposée, et ce n'est pas un oubli. Un dossier
 * réglementaire se défend pièce par pièce : on doit pouvoir dire ce qui était
 * joint, par qui, et à quelle date. Un historique que l'on peut réécrire ne
 * prouve plus rien, et son absence d'antériorité se retourne contre l'opérateur
 * au moment du contrôle.
 */
export const GET = guard<{ params: Promise<{ id: string }> }>("document:read")(async (
  _request: Request,
  context,
  { tx, organizationId },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });

  const [doc] = await tx
    .select({ id: documents.id, version: documents.version })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.organizationId, organizationId)))
    .limit(1);
  if (!doc) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });

  const lignes = await tx
    .select({
      version: documentVersions.version,
      storageKey: documentVersions.storageKey,
      fileName: documentVersions.fileName,
      sha256: documentVersions.sha256,
      sizeBytes: documentVersions.sizeBytes,
      mimeDetected: documentVersions.mimeDetected,
      mimeDeclared: documentVersions.mimeDeclared,
      scanStatus: documentVersions.scanStatus,
      scanMoteur: documentVersions.scanMoteur,
      uploadedBy: documentVersions.uploadedBy,
      createdAt: documentVersions.createdAt,
    })
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, id), eq(documentVersions.organizationId, organizationId)))
    .orderBy(desc(documentVersions.version));

  return NextResponse.json({
    documentId: doc.id,
    versionCourante: doc.version,
    count: lignes.length,
    items: lignes.map((l) => ({
      version: l.version,
      fileName: l.fileName,
      sha256: l.sha256,
      sizeBytes: l.sizeBytes,
      mimeDetected: l.mimeDetected,
      mimeDeclared: l.mimeDeclared,
      scanStatus: l.scanStatus,
      scanMoteur: l.scanMoteur,
      uploadedBy: l.uploadedBy,
      createdAt: l.createdAt?.toISOString() ?? null,
      // Le chemin interne n'est jamais exposé : il est un détail du support, et
      // le révéler offrirait une carte des fichiers du serveur.
      _storageKey: undefined,
    })),
  });
});
