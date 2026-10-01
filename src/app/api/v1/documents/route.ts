import { lireCorpsJson } from "@/lib/api/body";
import { lireCorpsMultipart } from "@/lib/api/multipart";
import { logAction } from "@/lib/api/audit-log";
import { documents, documentVersions, plots, suppliers } from "@/db/schema";
import { DOCUMENT_CATEGORIES, type ComplianceDocument, type DocumentCategory } from "@/lib/eudr/types";
import { deposerPiece, verifierPiece } from "@/lib/storage/depot";
import { stockageValide } from "@/lib/storage";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

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
    // ------------------------------------------------------------- P1-02
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    mimeDetected: row.mimeDetected,
    mimeDeclared: row.mimeDeclared,
    // ⚠️ Jamais recalculé ici. La règle qui distingue un mensonge d'une simple
    // absence d'information (`ecartDeType`) est nuancée : « octet-stream » n'est
    // pas un mensonge, un conteneur ZIP contenant du docx non plus. Une
    // inégalité de chaînes les traiterait comme tels — et, pire, l'appréciation
    // portée sur une pièce changerait si la règle évoluait après versement au
    // dossier. La valeur est donc celle arrêtée au dépôt.
    mimeMismatch: row.mimeMismatch === true,
    version: row.version,
    scanStatus: (row.scanStatus as ComplianceDocument["scanStatus"]) ?? "NOT_SCANNED",
    scanDetail: row.scanDetail,
    scanMoteur: row.scanMoteur,
    hasFile: row.storageKey !== null,
  };
}

export const GET = guard("document:read")(async (request: Request, _ctx, { tx, organizationId }): Promise<Response> => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const category = url.searchParams.get("category")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "200") || 200, 1), 500);

  const filters = [eq(documents.organizationId, organizationId)];
  if (q) {
    const like = `%${q}%`;
    filters.push(or(ilike(documents.title, like), ilike(documents.fileName, like))!);
  }
  if (status) filters.push(eq(documents.status, status));
  if (category) filters.push(eq(documents.category, category));

  const rows = await tx
    .select({
      document: documents,
      supplierName: suppliers.name,
      plotName: plots.name,
    })
    .from(documents)
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .leftJoin(plots, eq(plots.id, documents.plotId))
    .where(and(...filters))
    .orderBy(desc(documents.createdAt))
    .limit(limit);

  return NextResponse.json(
    rows.map((r) => ({ ...toDocument(r.document), supplierName: r.supplierName, plotName: r.plotName })),
  );
});

export const POST = guard("document:write")(async (request: Request, _ctx, { tx, organizationId, session }): Promise<Response> => {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  // Deux usages, un seul point d'entrée :
  //   · multipart/form-data — déclaration **et** dépôt de la pièce ;
  //   · JSON                — déclaration seule, la pièce viendra plus tard.
  if (contentType.startsWith("multipart/form-data")) {
    return creerAvecPiece(request, tx, organizationId, session);
  }
  return creerSansPiece(request, tx, organizationId, session);
});

/**
 * Déclaration **et** dépôt de la pièce, en une requête.
 *
 * ⚠️ Ordre des écritures : le document est créé d'abord, la pièce ensuite. Une
 * pièce ne peut pas être rattachée à un document qui n'existe pas, et créer la
 * pièce avant produirait un objet orphelin si la validation des métadonnées
 * échouait. Si le dépôt échoue après la création, la transaction est annulée :
 * il ne reste rien.
 */
async function creerAvecPiece(
  request: Request,
  tx: any,
  organizationId: string,
  session: { user: { id: string; email: string; role: string } },
): Promise<Response> {
  const lecture = await lireCorpsMultipart(request);
  if (!lecture.ok) return lecture.response;
  const { champs, fichiers } = lecture.value;

  const fichier = fichiers[0];
  if (!fichier) {
    return NextResponse.json({ detail: "Aucun fichier dans la requête (champ attendu : file)" }, { status: 422 });
  }

  const titre = (champs.title ?? "").trim();
  if (titre.length < 2) {
    return NextResponse.json({ detail: "Intitulé requis (≥ 2 caractères)" }, { status: 422 });
  }
  const categorie = (champs.category ?? "").trim();
  if (!DOCUMENT_CATEGORIES.includes(categorie as DocumentCategory)) {
    return NextResponse.json({ detail: "Catégorie invalide" }, { status: 422 });
  }
  const echeance = (champs.expiryDate ?? "").trim();
  if (echeance && !DATE_PATTERN.test(echeance)) {
    return NextResponse.json({ detail: "Date d'expiration invalide (AAAA-MM-JJ)" }, { status: 422 });
  }

  const lien = await resoudreLien(tx, organizationId, champs.supplierId, champs.plotId);
  if ("erreur" in lien) return lien.erreur;

  // ⚠️ Les contrôles du fichier passent AVANT la création de la fiche.
  // Sans cette précaution, un exécutable déguisé laissait une fiche de document
  // parfaitement valide — sans pièce, et sans que rien ne le signale : le
  // dossier citait un document dont le fichier n'avait jamais existé. Le refus
  // doit être sans trace.
  const verif = await verifierPiece(fichier);
  if (verif.refuse) {
    return NextResponse.json({ detail: verif.detail }, { status: verif.statut });
  }

  const [row] = await tx
    .insert(documents)
    .values({
      organizationId,
      supplierId: lien.supplierId,
      plotId: lien.plotId,
      title: titre,
      category: categorie,
      fileName: fichier.nomFichier,
      fileUrl: null,
      fileSize: 0,
      expiryDate: echeance || null,
      status: "TO_VERIFY",
      notes: (champs.notes ?? "").trim() || null,
    })
    .returning();

  const depot = await deposerPiece(tx, organizationId, row.id, fichier, session.user.email, verif.controle);
  if (depot.refuse) {
    // La transaction est annulée par l'appelant en cas d'erreur : on propage.
    return NextResponse.json({ detail: depot.detail }, { status: depot.statut });
  }

  const [final] = await tx.select().from(documents).where(eq(documents.id, row.id)).limit(1);

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "CREATE",
    entityType: "DOCUMENT",
    entityId: row.id,
    // ⚠️ P1-10 — l'état complet est conservé, condensat compris : c'est ce qui
    //   permet de prouver, plus tard, que la pièce versée au dossier est bien
    //   celle qui a été déposée.
    apres: (final ?? null) as unknown as Record<string, unknown> | null,
    details: {
      category: categorie,
      fileStored: true,
      sha256: depot.piece.sha256,
      sizeBytes: depot.piece.taille,
      mimeDetected: depot.piece.typeReel.mime,
      mimeDeclared: depot.piece.typeDeclare,
      scanStatus: depot.piece.analyse.statut,
    },
  });

  return NextResponse.json(
    {
      ...toDocument(final),
      notice: stockageValide()
        ? "Pièce déposée, son condensat est enregistré."
        : "Pièce déposée sur un support non validé : à confirmer en recette avant mise en service.",
      warnings: depot.piece.avertissements,
    },
    { status: 201 },
  );
}

async function creerSansPiece(
  request: Request,
  tx: any,
  organizationId: string,
  session: { user: { id: string; email: string; role: string } },
): Promise<Response> {
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const title = str(body.title);
  if (title.length < 2) return NextResponse.json({ detail: "Intitulé requis (≥ 2 caractères)" }, { status: 422 });

  const category = str(body.category);
  if (!DOCUMENT_CATEGORIES.includes(category as DocumentCategory)) {
    return NextResponse.json({ detail: "Catégorie invalide" }, { status: 422 });
  }

  const expiry = str(body.expiryDate);
  if (expiry && !DATE_PATTERN.test(expiry)) {
    return NextResponse.json({ detail: "Date d'expiration invalide (AAAA-MM-JJ)" }, { status: 422 });
  }

  const hasFile = typeof body.fileName === "string" && body.fileName.trim().length > 0;

  const lien = await resoudreLien(tx, organizationId, str(body.supplierId), str(body.plotId));
  if ("erreur" in lien) return lien.erreur;

  const [row] = await tx
    .insert(documents)
    .values({
      organizationId,
      supplierId: lien.supplierId,
      plotId: lien.plotId,
      title,
      category,
      fileName: hasFile ? str(body.fileName) : "—",
      fileUrl: str(body.fileUrl) || null,
      fileSize: Number.isFinite(Number(body.fileSize)) ? Number(body.fileSize) : 0,
      expiryDate: expiry || null,
      status: "TO_VERIFY",
      notes: str(body.notes) || null,
    })
    .returning();

    await logAction(tx, organizationId, {
      userEmail: session.user.email,
      acteurId: session.user.id,
      acteurRole: session.user.role,
      action: "CREATE",
      entityType: "DOCUMENT",
      entityId: row.id,
      apres: row as unknown as Record<string, unknown>,
      details: { title, category, fileStored: false },
    });

  return NextResponse.json(
    {
      ...toDocument(row),
      // ⚠️ Le message dit exactement ce qui s'est passé. Depuis P1-02, un dépôt
      // est possible : l'absence de pièce est donc un choix, pas une limite du
      // produit, et le texte ne prétend plus le contraire.
      notice: hasFile
        ? "Document déclaré avec un nom de fichier, mais aucune pièce déposée : " +
          "seules les métadonnées sont enregistrées. Déposez le fichier pour qu'il soit conservé et vérifiable."
        : "Document enregistré sans pièce jointe. Le fichier peut être déposé ultérieurement " +
          "(POST /api/v1/documents/{id}/file).",
    },
    { status: 201 },
  );
}

/**
 * Résout fournisseur et parcelle, en vérifiant l'appartenance.
 *
 * ⚠️ Sans ce contrôle, un identifiant valide mais appartenant à une autre
 * organisation serait accepté silencieusement, et la pièce serait rattachée à
 * un dossier étranger.
 */
async function resoudreLien(
  tx: any,
  organizationId: string,
  supplierIdBrut: string | undefined,
  plotIdBrut: string | undefined,
): Promise<{ supplierId: string | null; plotId: string | null } | { erreur: Response }> {
  let supplierId: string | null = null;
  if (supplierIdBrut) {
    if (!UUID_PATTERN.test(supplierIdBrut)) {
      return { erreur: NextResponse.json({ detail: "Fournisseur invalide" }, { status: 422 }) };
    }
    const [owner] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierIdBrut), eq(suppliers.organizationId, organizationId)))
      .limit(1);
    if (!owner) return { erreur: NextResponse.json({ detail: "Fournisseur introuvable" }, { status: 404 }) };
    supplierId = owner.id;
  }

  let plotId: string | null = null;
  if (plotIdBrut) {
    if (!UUID_PATTERN.test(plotIdBrut)) {
      return { erreur: NextResponse.json({ detail: "Parcelle invalide" }, { status: 422 }) };
    }
    const [owner] = await tx
      .select({ id: plots.id })
      .from(plots)
      .where(and(eq(plots.id, plotIdBrut), eq(plots.organizationId, organizationId)))
      .limit(1);
    if (!owner) return { erreur: NextResponse.json({ detail: "Parcelle introuvable" }, { status: 404 }) };
    plotId = owner.id;
  }

  return { supplierId, plotId };
}

/** Exporté pour la route des versions : même projection, sans jointure. */
export { toDocument, documentVersions };
