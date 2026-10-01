import { documentVersions, documents } from "@/db/schema";
import { DUREE_MAX_SECONDES, DUREE_MIN_SECONDES, creerUrlSignee, originePublique, secretDeDeveloppement } from "@/lib/storage/url-signee";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fabrique une URL de téléchargement à durée limitée.
 *
 * ⚠️ Ce que cette URL n'est PAS : un moyen de contourner l'autorisation. La
 * route de téléchargement vérifie la session **et** l'appartenance du document
 * à l'organisation, indépendamment de la signature. Une URL valide ne donne
 * donc rien à un utilisateur d'une autre organisation, et une URL interceptée
 * expire d'elle-même.
 *
 * La signature lie l'organisation **et** la version : une URL émise pour la
 * version 2 ne permet pas de lire la version 1, ni de lire la version 3 une
 * fois celle-ci déposée.
 */
export const GET = guard<{ params: Promise<{ id: string }> }>("document:read")(async (
  request: Request,
  context,
  { tx, organizationId },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });

  const [doc] = await tx
    .select({ id: documents.id, version: documents.version, storageKey: documents.storageKey })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.organizationId, organizationId)))
    .limit(1);
  if (!doc) return NextResponse.json({ detail: "Document introuvable" }, { status: 404 });
  if (!doc.storageKey) {
    return NextResponse.json(
      { detail: "Aucune pièce déposée pour ce document : il n'y a rien à télécharger." },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const demande = Number(url.searchParams.get("duree") ?? "");
  const duree = Number.isFinite(demande) && demande > 0 ? demande : undefined;

  if (duree !== undefined && (duree < DUREE_MIN_SECONDES || duree > DUREE_MAX_SECONDES)) {
    return NextResponse.json(
      { detail: `Durée hors bornes : entre ${DUREE_MIN_SECONDES} et ${DUREE_MAX_SECONDES} secondes.` },
      { status: 422 },
    );
  }

  // Version demandée. Sans ce paramètre, l'URL vise la version courante.
  //
  // ⚠️ Le numéro est d'abord confronté à l'historique réel du document : signer
  // une version inexistante produirait une URL valide pour rien, et signer la
  // version d'un autre document — même d'un chiffre plausible — reviendrait à
  // déléguer au client le soin de désigner ce qu'il veut lire.
  const brut = url.searchParams.get("version");
  let versionDemandee = doc.version;
  if (brut !== null) {
    const demandeVersion = Number(brut);
    if (!Number.isInteger(demandeVersion) || demandeVersion < 1) {
      return NextResponse.json({ detail: "Numéro de version invalide." }, { status: 422 });
    }
    const [trouvee] = await tx
      .select({ version: documentVersions.version })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, id),
          eq(documentVersions.organizationId, organizationId),
          eq(documentVersions.version, demandeVersion),
        ),
      )
      .limit(1);
    if (!trouvee) {
      return NextResponse.json(
        { detail: `La version ${demandeVersion} n'existe pas pour ce document.` },
        { status: 404 },
      );
    }
    versionDemandee = trouvee.version;
  }

  const signee = creerUrlSignee(
    originePublique(request),
    doc.id,
    versionDemandee,
    organizationId,
    duree,
  );

  return NextResponse.json({
    url: signee.url,
    version: versionDemandee,
    expiration: new Date(signee.expiration * 1000).toISOString(),
    dureeSecondes: signee.dureeSecondes,
    avertissement: secretDeDeveloppement()
      ? "Secret de signature de développement : ces URLs ne doivent être utilisées qu'en recette."
      : null,
  });
});
