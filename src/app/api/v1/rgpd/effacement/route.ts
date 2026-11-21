import { NextResponse } from "next/server";

import { logAction } from "@/lib/api/audit-log";
import { guard } from "@/lib/auth/guard";
import {
  effacerContactsFournisseur,
  validerDemandeEffacement,
} from "@/lib/rgpd/effacement-donnees";

export const dynamic = "force-dynamic";

const ENTETES_PRIVES = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};

/**
 * Effacement partiel encadré — art. 17 du RGPD (et exception art. 17.3.b / art. 12 EUDR).
 *
 * - Réservé aux administrateurs de l'organisation (`org:manage`, MFA exigée par
 *   le proxy et la garde).
 * - L'organisation provient exclusivement de la session (`organizationId`).
 * - Efface les coordonnées personnelles de contact d'un fournisseur
 *   (`contact_name`, `contact_email`, `contact_phone` → `NULL`) tout en
 *   conservant la fiche fournisseur et les preuves de diligence EUDR (5 ans).
 * - Refuse en `409 Conflict` toute demande visant un dossier DDR, une parcelle,
 *   une analyse ou le journal d'audit, en motivant l'obligation légale EUDR.
 * - Journalise l'opération sans jamais recopier les valeurs effacées.
 */
export const POST = guard("org:manage")(async (
  request,
  _ctx,
  { tx, organizationId, session },
): Promise<Response> => {
  let corps: unknown;
  try {
    corps = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "json_invalide", message: "Corps JSON invalide." } },
      { status: 400, headers: ENTETES_PRIVES },
    );
  }

  const validation = validerDemandeEffacement(corps);
  if (!validation.ok) {
    return NextResponse.json(
      {
        detail: validation.detail,
        error: { code: validation.code, message: validation.detail },
      },
      { status: validation.status, headers: ENTETES_PRIVES },
    );
  }

  if (validation.demande.type === "refus_conservation_legale") {
    const refus = validation.demande;
    return NextResponse.json(
      {
        statut: "refuse_conservation_legale",
        cible: refus.cible,
        detail: refus.message,
        base_legale: refus.baseLegale,
        duree_conservation: refus.dureeConservation,
      },
      { status: 409, headers: ENTETES_PRIVES },
    );
  }

  const { supplierId, motif } = validation.demande;
  const resultat = await effacerContactsFournisseur(tx, organizationId, supplierId);

  if (!resultat.trouve) {
    return NextResponse.json(
      {
        detail: "Fournisseur introuvable dans votre organisation.",
        error: {
          code: "introuvable",
          message: "Fournisseur introuvable dans votre organisation.",
        },
      },
      { status: 404, headers: ENTETES_PRIVES },
    );
  }

  // Journalisation sans aucune donnée personnelle effacée : seuls les noms de
  // colonnes, le nombre de champs et l'objet réglementaire sont consignés.
  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "PURGE",
    entityType: "SUPPLIER",
    entityId: supplierId,
    details: {
      objet: "effacement_rgpd_contact_fournisseur",
      champs_effaces: resultat.champsEffaces,
      deja_efface: resultat.dejaEfface,
      motif_fourni: motif !== null,
    },
  });

  return NextResponse.json(
    {
      statut: resultat.dejaEfface ? "deja_efface" : "efface",
      cible: "fournisseur_contact",
      supplier_id: resultat.supplierId,
      champs_effaces: resultat.champsEffaces,
      donnees_conservees: resultat.donneesConservees,
      base_conservation: resultat.baseConservation,
    },
    { status: 200, headers: ENTETES_PRIVES },
  );
});
