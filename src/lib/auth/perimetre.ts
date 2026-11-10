import { AuthError } from "./session";

/**
 * Périmètre d'un compte fournisseur (chantier 6).
 *
 * Le rôle `supplier` a les permissions de dépôt (document:write, plot:write). Sans
 * périmètre, il pourrait modifier, supprimer ou rattacher les pièces et parcelles
 * de **tous** les producteurs de son organisation : c'est ce qu'a reproduit l'audit
 * (cf. docs/SUPPLIER_PORTAL_TEST_REPORT.md, §2).
 *
 * Règle : le périmètre est la fiche producteur rattachée au compte, lue en base à
 * chaque requête (`users.supplier_id`). Il n'est jamais déduit du corps de requête
 * ni d'un nom. Les autres rôles n'ont pas de périmètre (retour `null`).
 */
export interface AvecUtilisateur {
  user: { role: string; supplierId?: string | null };
}

/**
 * Retourne l'identifiant de la fiche producteur à laquelle le compte est limité,
 * ou `null` si le compte n'est pas un compte fournisseur.
 * Un compte fournisseur sans fiche rattachée est refusé : il ne peut rien atteindre.
 */
export function perimetreFournisseur(session: AvecUtilisateur): string | null {
  if (session.user.role !== "supplier") return null;
  if (!session.user.supplierId) {
    throw new AuthError(403, "supplier_unbound", "Compte fournisseur non rattaché à une fiche producteur.");
  }
  return session.user.supplierId;
}
