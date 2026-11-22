import { and, eq } from "drizzle-orm";

import { suppliers } from "@/db/schema";

/**
 * Effacement / anonymisation RGPD encadré (art. 17 du RGPD et art. 12 EUDR).
 *
 * Principes réglementaires :
 *  1. Les coordonnées personnelles de contact d'un fournisseur (`contactName`,
 *     `contactEmail`, `contactPhone`) sont effaçables à la demande par
 *     l'administrateur de l'organisation (`UPDATE` à `NULL`), tout en
 *     conservant la fiche fournisseur et ses liens de diligence raisonnée.
 *  2. Les données métier soumises à l'obligation légale de conservation de
 *     5 ans (art. 12 du règlement UE 2023/1115 — dossiers DDR, parcelles,
 *     analyses satellites, pièces probantes, journal d'audit) ne peuvent pas
 *     être effacées sur demande (exception art. 17.3.b du RGPD) : la demande
 *     est refusée explicitement en 409 avec sa base légale.
 *  3. L'organisation est toujours fournie par la session (`guard`), jamais par
 *     le corps de requête.
 */

export const CIBLES_CONSERVEES_EUDR = [
  "dossier_ddr",
  "parcelle",
  "analyse",
  "journal_audit",
] as const;

export type CibleConserveeEudr = (typeof CIBLES_CONSERVEES_EUDR)[number];

export const CIBLE_FOURNISSEUR_CONTACT = "fournisseur_contact" as const;

export type DemandeEffacementValide =
  | {
      type: "effacer_contact_fournisseur";
      supplierId: string;
      motif: string | null;
    }
  | {
      type: "refus_conservation_legale";
      cible: CibleConserveeEudr;
      baseLegale: string;
      dureeConservation: string;
      message: string;
    };

export type ValidationEffacement =
  | { ok: true; demande: DemandeEffacementValide }
  | { ok: false; code: string; detail: string; status: 400 | 422 };

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MOTIF_MAX_CARACTERES = 500;

const MOTIFS_CONSERVATION: Record<
  CibleConserveeEudr,
  { baseLegale: string; dureeConservation: string; message: string }
> = {
  dossier_ddr: {
    baseLegale: "Art. 17.3.b RGPD — Obligation légale art. 12 du règlement (UE) 2023/1115 (EUDR)",
    dureeConservation: "5 ans à compter de la mise sur le marché ou de l'exportation",
    message:
      "Effacement refusé : un dossier de diligence raisonnée doit être conservé 5 ans au titre de l'article 12 de l'EUDR (exception art. 17.3.b du RGPD).",
  },
  parcelle: {
    baseLegale: "Art. 17.3.b RGPD — Obligation légale art. 9.1.d et art. 12 EUDR",
    dureeConservation: "5 ans après la dernière déclaration qui cite la parcelle",
    message:
      "Effacement refusé : la géolocalisation d'une parcelle est une pièce obligatoire de la diligence raisonnée conservée 5 ans (art. 9.1.d et 12 EUDR).",
  },
  analyse: {
    baseLegale: "Art. 17.3.b RGPD — Obligation légale art. 12 EUDR",
    dureeConservation: "5 ans à compter de la mise sur le marché ou de l'exportation",
    message:
      "Effacement refusé : une analyse satellite et sa provenance constituent une preuve de diligence conservée 5 ans (art. 12 EUDR).",
  },
  journal_audit: {
    baseLegale: "Art. 17.3.b RGPD — Obligation légale art. 12 EUDR (traçabilité inaltérable)",
    dureeConservation: "5 ans (table append-only chaînée par condensats)",
    message:
      "Effacement refusé : le journal d'audit est append-only et chaîné pour la traçabilité réglementaire. Les coordonnées de tiers y sont déjà assainies à l'écriture (D-012).",
  },
};

/**
 * Valide le corps JSON d'une demande d'effacement RGPD.
 * Refuse tout champ `organizationId` / `organization_id` (l'organisation vient
 * uniquement de la session).
 */
export function validerDemandeEffacement(corps: unknown): ValidationEffacement {
  if (!corps || typeof corps !== "object" || Array.isArray(corps)) {
    return {
      ok: false,
      code: "corps_invalide",
      detail: "Le corps de requête doit être un objet JSON.",
      status: 400,
    };
  }

  const obj = corps as Record<string, unknown>;

  if ("organizationId" in obj || "organization_id" in obj) {
    return {
      ok: false,
      code: "organisation_interdite",
      detail:
        "Le périmètre d'organisation est déterminé exclusivement par la session ; ne pas fournir organizationId.",
      status: 422,
    };
  }

  const cible = typeof obj.cible === "string" ? obj.cible.trim() : "";

  if ((CIBLES_CONSERVEES_EUDR as readonly string[]).includes(cible)) {
    const cibleTypee = cible as CibleConserveeEudr;
    return {
      ok: true,
      demande: {
        type: "refus_conservation_legale",
        cible: cibleTypee,
        ...MOTIFS_CONSERVATION[cibleTypee],
      },
    };
  }

  if (cible !== CIBLE_FOURNISSEUR_CONTACT) {
    return {
      ok: false,
      code: "cible_invalide",
      detail: `Cible d'effacement non reconnue. Cible effaçable : "${CIBLE_FOURNISSEUR_CONTACT}".`,
      status: 422,
    };
  }

  const supplierId = typeof obj.supplierId === "string" ? obj.supplierId.trim() : "";
  if (!UUID_REGEX.test(supplierId)) {
    return {
      ok: false,
      code: "identifiant_invalide",
      detail: "supplierId doit être un UUID valide.",
      status: 422,
    };
  }

  let motif: string | null = null;
  if (obj.motif !== undefined && obj.motif !== null) {
    if (typeof obj.motif !== "string") {
      return {
        ok: false,
        code: "motif_invalide",
        detail: "motif doit être une chaîne de caractères.",
        status: 422,
      };
    }
    const propre = obj.motif.trim();
    if (propre.length > MOTIF_MAX_CARACTERES) {
      return {
        ok: false,
        code: "motif_trop_long",
        detail: `motif ne peut pas dépasser ${MOTIF_MAX_CARACTERES} caractères.`,
        status: 422,
      };
    }
    motif = propre.length > 0 ? propre : null;
  }

  return {
    ok: true,
    demande: {
      type: "effacer_contact_fournisseur",
      supplierId,
      motif,
    },
  };
}

export interface ResultatEffacementContact {
  trouve: boolean;
  supplierId: string;
  champsEffaces: string[];
  dejaEfface: boolean;
  donneesConservees: string[];
  baseConservation: string;
}

/**
 * Efface les coordonnées personnelles de contact d'un fournisseur de
 * l'organisation (contact_name, contact_email, contact_phone → NULL).
 *
 * Filtre explicitement sur `(suppliers.id, suppliers.organizationId)` en plus
 * de la RLS transactionnelle. Ne supprime jamais la ligne fournisseur afin de
 * préserver les liens EUDR (parcelles, documents, dossiers DDR) pendant 5 ans.
 */
export async function effacerContactsFournisseur(
  tx: {
    select: typeof import("../../db").db.select;
    update: typeof import("../../db").db.update;
  },
  organizationId: string,
  supplierId: string,
): Promise<ResultatEffacementContact> {
  const [existant] = await tx
    .select({
      id: suppliers.id,
      contactName: suppliers.contactName,
      contactEmail: suppliers.contactEmail,
      contactPhone: suppliers.contactPhone,
    })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, organizationId)))
    .limit(1);

  if (!existant) {
    return {
      trouve: false,
      supplierId,
      champsEffaces: [],
      dejaEfface: false,
      donneesConservees: [],
      baseConservation: "",
    };
  }

  const champsEffaces: string[] = [];
  if (existant.contactName !== null) champsEffaces.push("contact_name");
  if (existant.contactEmail !== null) champsEffaces.push("contact_email");
  if (existant.contactPhone !== null) champsEffaces.push("contact_phone");

  if (champsEffaces.length > 0) {
    await tx
      .update(suppliers)
      .set({
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        updatedAt: new Date(),
      })
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, organizationId)));
  }

  return {
    trouve: true,
    supplierId,
    champsEffaces,
    dejaEfface: champsEffaces.length === 0,
    donneesConservees: [
      "fiche_fournisseur (id, raison sociale, EORI, pays, matière première)",
      "parcelles, documents probants, analyses et dossiers DDR rattachés",
      "journal d'audit chaîné (sans coordonnées personnelles)",
    ],
    baseConservation:
      "Obligation légale de conservation 5 ans — art. 12 du règlement (UE) 2023/1115 (EUDR) / exception art. 17.3.b du RGPD.",
  };
}
