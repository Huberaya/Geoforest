import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";
import { aujourdhuiIso } from "@/lib/eudr/readiness-db";
import { assemblerPack, IncidentPack } from "@/lib/evidence/assembler";
import { construirePack, sha256Hex } from "@/lib/evidence/pack";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pack de preuves d'un dossier (B-10, chantier 4) : archive ZIP qui contient le dossier,
 * sa readiness, les analyses avec leur provenance, les pièces telles que déposées, un
 * extrait du journal, et la liste de ce qui n'est pas vérifié.
 *
 * ⚠️ Le pack peut être produit quel que soit le statut du dossier : il sert aussi à
 *   montrer ce qui manque. Il ne vaut pas déclaration et ne transmet rien.
 * ⚠️ L'export est journalisé dans la même transaction, avec le condensat de l'archive.
 *   Un pack refusé (incident sur une pièce) n'est pas journalisé comme export.
 */
export const GET = guard<{ params: Promise<{ id: string }> }>("export:run")(async (
  _request: Request,
  context,
  { tx, organizationId, session },
): Promise<Response> => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });

  let pack;
  try {
    pack = await assemblerPack(tx, organizationId, id, aujourdhuiIso(), {
      id: session.user.id,
      role: session.user.role,
      email: session.user.email,
    });
  } catch (erreur) {
    if (erreur instanceof IncidentPack) {
      return NextResponse.json({ detail: erreur.message, piece: erreur.piece }, { status: 500 });
    }
    throw erreur;
  }
  if (!pack) return NextResponse.json({ detail: "Dossier introuvable" }, { status: 404 });

  const { zip } = construirePack(pack.fichiers);
  const empreinte = sha256Hex(zip);

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "EXPORT",
    entityType: "DDS",
    entityId: id,
    details: {
      nature: "pack_preuves",
      sha256_archive: empreinte,
      taille_octets: zip.byteLength,
      fichiers: pack.fichiers.length,
      pieces: pack.resume.pieces,
      pieces_sans_fichier: pack.resume.piecesSansFichier,
      analyses: pack.resume.analyses,
      entrees_journal: pack.resume.entreesJournal,
    },
  });

  return new Response(zip as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.byteLength),
      "Content-Disposition": `attachment; filename="pack-preuves-${id}.zip"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "X-GeoForest-SHA256": empreinte,
    },
  });
});
