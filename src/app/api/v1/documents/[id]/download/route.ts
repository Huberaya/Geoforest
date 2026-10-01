import { documentVersions, documents } from "@/db/schema";
import { stockageCourant } from "@/lib/storage";
import { verifierUrlSignee } from "@/lib/storage/url-signee";
import { logAction } from "@/lib/api/audit-log";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Téléchargement d'une pièce, par URL signée.
 *
 * ⚠️ P1-02 — deux contrôles indépendants, et aucun ne remplace l'autre.
 *
 *   1. **La signature**, qui lie le document, la version, l'organisation et une
 *      date d'expiration. Une URL émise pour une organisation est donc sans
 *      valeur pour une autre : c'est le refus attendu par le critère du
 *      chantier, et il se produit **avant** tout accès au support.
 *   2. **L'appartenance**, revérifiée en base malgré la signature. Redondant
 *      avec la politique RLS, et volontairement : une URL volée ne doit pas
 *      suffire, même valide.
 *
 * L'ordre retenu — signature d'abord — n'est pas indifférent : il évite qu'un
 * attaquant ne distingue « document existant » de « document inexistant » en
 * comparant les réponses. Document absent, URL expirée et organisation
 * étrangère ne se différencient pas avant l'authentification.
 */
export const GET = guard<{ params: Promise<{ id: string }> }>("document:read")(async (
  request: Request,
  context,
  { tx, organizationId, session },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });

  const url = new URL(request.url);
  const verification = verifierUrlSignee({
    documentId: id,
    // La version demandée : la signature la couvre, donc la comparer au document
    // exige de le lire d'abord — d'où le `Number` tolérant ci-dessous.
    versionAttendue: Number(url.searchParams.get("v")),
    organisationId: organizationId,
    expiration: url.searchParams.get("exp"),
    version: url.searchParams.get("v"),
    signature: url.searchParams.get("sig"),
  });

  if (!verification.valide) {
    const messages: Record<string, string> = {
      SIGNATURE_INVALID: "Lien de téléchargement invalide : il n'a pas été émis par ce serveur, ou il ne vous est pas destiné.",
      EXPIREE: "Lien de téléchargement expiré. Demandez une nouvelle URL : elles sont volontairement éphémères.",
      VERSION: "Ce lien vise une version qui n'est plus celle du document.",
      ORGANISATION: "Ce lien n'appartient pas à votre organisation.",
      MALFORMEE: "Lien de téléchargement illisible.",
    };
    return NextResponse.json({ detail: messages[verification.raison] }, { status: 403 });
  }

  const [doc] = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.organizationId, organizationId)))
    .limit(1);

  if (!doc) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });

  // La pièce servie est celle de la **version signée**, pas nécessairement la
  // version courante : une URL établie pour la version 1 doit continuer à
  // rendre la version 1 après le dépôt d'une version 2. C'est à cela que sert
  // de conserver l'historique, et c'est aussi pourquoi la version fait partie
  // de la signature : on ne télécharge que la pièce que le lien désigne.
  const [piece] = await tx
    .select({
      version: documentVersions.version,
      storageKey: documentVersions.storageKey,
      fileName: documentVersions.fileName,
      mimeDetected: documentVersions.mimeDetected,
      sha256: documentVersions.sha256,
    })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, id),
        eq(documentVersions.organizationId, organizationId),
        eq(documentVersions.version, verification.charge.version),
      ),
    )
    .limit(1);

  if (!piece) {
    return NextResponse.json(
      { detail: "Cette version n'existe pas pour ce document." },
      { status: 404 },
    );
  }

  const contenu = await stockageCourant().lire(piece.storageKey);
  if (!contenu) {
    // ⚠️ Ne pas masquer : une pièce déclarée en base mais absente du support
    // est un incident d'exploitation, pas un « document introuvable ».
    return NextResponse.json(
      { detail: "La pièce est déclarée mais introuvable sur le support : incident à traiter.", storageKey: piece.storageKey },
      { status: 500 },
    );
  }

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "EXPORT",
    entityType: "DOCUMENT",
    entityId: doc.id,
    details: { action: "TELECHARGEMENT", version: piece.version, sha256: piece.sha256 },
  });

  const nomSur = (piece.fileName ?? "piece").replace(/["\\\r\n]/g, "_");

  return new Response(contenu as BodyInit, {
    status: 200,
    headers: {
      // Le type servi est celui **lu dans les octets**, jamais celui déclaré au
      // dépôt : restituer un fichier sous le type annoncé par son déposant
      // permettrait de le faire exécuter par le navigateur.
      "Content-Type": piece.mimeDetected ?? "application/octet-stream",
      "Content-Length": String(contenu.byteLength),
      "Content-Disposition": `attachment; filename="${nomSur}"`,
      // `nosniff` : sans lui, un navigateur peut réinterpréter le type annoncé.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
      // Le condensat est exposé pour que le client puisse vérifier l'intégrité
      // de ce qu'il reçoit, sans avoir à refaire confiance au transport.
      "X-GeoForest-SHA256": piece.sha256 ?? "",
    },
  });
});
