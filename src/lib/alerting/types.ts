import "server-only";

/**
 * Transport d'alertes.
 *
 * ⚠️ P1-06 — le drapeau `valide` reprend la règle déjà posée par le stockage
 * (P1-02) : un adaptateur qui n'a jamais été exécuté contre le service réel
 * **n'est pas** un adaptateur prêt. Il est écrit, il est documenté, et le
 * produit refuse de l'employer sans acquittement explicite de l'exploitant.
 * Présenter comme opérationnelle une alerte qui ne part jamais est pire que de
 * ne pas en avoir : on baisse la garde en croyant être couvert.
 */
export interface TransportAlerte {
  readonly nom: string;
  /** Vrai si ce transport a déjà été éprouvé sur une instance réelle. */
  readonly valide: boolean;
  /** Nom de la variable qui l'active. */
  readonly variable: string;
  envoyer(alerte: Alerte): Promise<ResultatEnvoi>;
}

export interface ResultatEnvoi {
  transport: string;
  /** « envoyé » : le service a accepté l'alerte. */
  etat: "envoyé" | "refusé" | "echec" | "non configuré";
  detail?: string;
}

export type Gravite = "critique" | "majeure" | "mineure";

export interface Alerte {
  /** Code stable : c'est lui qui sert de clé de déduplication. */
  code: string;
  gravite: Gravite;
  /** Titre court, lisible par une astreinte. */
  titre: string;
  /** Ce qui a été mesuré, et la valeur qui a déclenché. */
  message: string;
  /** Composant concerné. */
  composant: "base" | "api" | "gfw" | "stockage" | "disque" | "sauvegarde";
  /** Valeurs chiffrées ayant conduit au déclenchement. */
  mesures: Record<string, number | string | boolean | null>;
  /** Ce qu'il faut faire, en une phrase. */
  action: string;
  /** Horodatage de déclenchement. */
  ts: string;
  /** « déclenchée » ou « résolue ». */
  etat: "déclenchée" | "résolue";
}
