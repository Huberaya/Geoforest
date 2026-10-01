/**
 * Complétude d'un fournisseur — **calculée**, jamais estimée ni stockée.
 *
 * ⚠️ Avant ce chantier (P0-09), un fournisseur nouvellement créé recevait un
 * `completenessScore` arbitraire de 30, et l'écran de détail en affichait un de
 * 95 pour un fournisseur qui n'existait pas. Un pourcentage de complétude est
 * une mesure : il doit être dérivé de données réellement présentes.
 *
 * Les critères ci-dessous sont volontairement documentés et pondérés de façon
 * transparente, afin qu'un auditeur puisse vérifier le chiffre à la main.
 */

export interface SupplierCompletenessInput {
  name: string | null;
  country: string | null;
  eori: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  plotsCount: number | null;
}

/** Code réservé pour « pays non renseigné » (même convention que les parcelles). */
export const UNKNOWN_COUNTRY = "XX";

interface Criterion {
  key: string;
  label: string;
  weight: number;
  satisfied: (s: SupplierCompletenessInput) => boolean;
}

function has(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const CRITERIA: Criterion[] = [
  {
    key: "identity",
    label: "Raison sociale",
    weight: 15,
    satisfied: (s) => has(s.name),
  },
  {
    key: "country",
    label: "Pays de production",
    weight: 15,
    // `XX` est le marqueur « non renseigné » : il ne vaut pas une donnée.
    satisfied: (s) => has(s.country) && s.country!.trim().toUpperCase() !== UNKNOWN_COUNTRY,
  },
  {
    key: "eori",
    label: "Numéro EORI",
    weight: 15,
    satisfied: (s) => has(s.eori),
  },
  {
    key: "contact_name",
    label: "Personne à contacter",
    weight: 15,
    satisfied: (s) => has(s.contactName),
  },
  {
    key: "contact_reachable",
    label: "Moyen de contact (courriel ou téléphone)",
    weight: 20,
    satisfied: (s) => has(s.contactEmail) || has(s.contactPhone),
  },
  {
    key: "plots",
    label: "Au moins une parcelle géolocalisée",
    weight: 20,
    satisfied: (s) => (s.plotsCount ?? 0) > 0,
  },
];

/** Poids total des critères : la somme doit valoir 100. */
export const COMPLETENESS_TOTAL = CRITERIA.reduce((sum, c) => sum + c.weight, 0);

/** Score entier de 0 à 100. */
export function supplierCompleteness(s: SupplierCompletenessInput): number {
  const earned = CRITERIA.filter((c) => c.satisfied(s)).reduce((sum, c) => sum + c.weight, 0);
  return Math.round((earned / COMPLETENESS_TOTAL) * 100);
}

/** Critères non satisfaits — affichables pour expliquer le score. */
export function missingCompletenessCriteria(s: SupplierCompletenessInput): string[] {
  return CRITERIA.filter((c) => !c.satisfied(s)).map((c) => c.label);
}
