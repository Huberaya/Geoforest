/**
 * Le journal d'audit ne doit pas devenir un contournement du droit à
 * l'effacement.
 *
 * ⚠️ Le défaut, mesuré dans le schéma avant correction.
 *
 *   `gf_audit_logs.avant` et `.apres` contiennent la ligne entière, telle
 *   qu'elle était et telle qu'elle est devenue. C'est voulu : un journal qui ne
 *   dit pas ce qui a changé ne répond à aucune question de contrôle (P1-10).
 *
 *   Mais la conséquence n'avait pas été tirée. Supprimer une adresse de contact
 *   de fournisseur efface bien `gf_suppliers.contact_email` ; la même adresse
 *   reste, en clair, dans le `avant` du journal. Un effacement qui laisse la
 *   donnée dans une copie n'est pas un effacement — c'est un déplacement.
 *
 * ⚠️ Et le journal est immuable : append-only, chaîné par empreinte, sans droit
 *   de suppression pour le rôle applicatif. On ne peut donc pas « nettoyer
 *   après ». Ce qui n'est pas assaini À L'ÉCRITURE ne le sera jamais.
 *
 * ⚠️ Ce qui n'est PAS retiré, et pourquoi.
 *
 *   On retire les données personnelles, pas l'identité de l'acteur ni son
 *   adresse e-mail professionnelle : sans elles, le journal ne dit plus
 *   « qui ». C'est l'arbitrage écrit en D-012. Ce qui part, ce sont les données
 *   des TIERS recopiées par effet de bord (coordonnées de contact, adresse IP,
 *   agent utilisateur), pas la trace de l'action elle-même.
 */

/** Valeur inscrite à la place d'une donnée personnelle retirée. */
export const VALEUR_RETIREE = "[retiré à l'audit — donnée personnelle]";

/**
 * Colonnes dont la valeur ne doit jamais être recopiée dans le journal.
 *
 * ⚠️ Comparaison sur le nom NORMALISÉ (minuscules, sans souligné ni tiret) :
 *   une ligne de base arrive en `contactEmail` (camelCase Drizzle) lors d'une
 *   écriture applicative, et en `contact_email` (colonne SQL) lors d'une
 *   relecture. Ne traiter qu'une seule des deux formes laisserait fuiter
 *   l'autre — c'est le piège classique de ce genre de filtre.
 */
const COLONNES_A_RETIRER = new Set([
  "contactemail",
  "contactphone",
  "contactname",
  "useragent",
  "ip",
  "producerphone",
  "operatoremail",
]);

function normaliser(cle: string): string {
  return cle.toLowerCase().replace(/[_-]/g, "");
}

/**
 * Assainit une copie de ligne avant de la confier au journal.
 *
 * - retire les colonnes listées, où qu'elles soient dans l'objet ;
 * - borne la profondeur : un objet cyclique ne doit pas faire échouer la requête
 *   au seul motif qu'on cherchait à la journaliser ;
 * - laisse les secrets au filtre du journal applicatif (`rediger`), qui les
 *   traite déjà pour les journaux de trace.
 */
export function assainirPourAudit(valeur: unknown, profondeur = 0): unknown {
  if (profondeur > 6) return "[trop profond]";
  if (valeur === null || valeur === undefined) return valeur;
  if (valeur instanceof Date) return valeur;
  if (Array.isArray(valeur)) return valeur.map((v) => assainirPourAudit(v, profondeur + 1));
  if (typeof valeur === "object") {
    const source = valeur as Record<string, unknown>;
    const sortie: Record<string, unknown> = {};
    for (const [cle, v] of Object.entries(source)) {
      sortie[cle] = COLONNES_A_RETIRER.has(normaliser(cle)) ? VALEUR_RETIREE : assainirPourAudit(v, profondeur + 1);
    }
    return sortie;
  }
  return valeur;
}
