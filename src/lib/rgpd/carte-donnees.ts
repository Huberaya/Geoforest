/**
 * Carte des données personnelles détenues par GeoForest.
 *
 * ⚠️ Pourquoi cette carte existe, et pourquoi elle est dans le code source.
 *
 *   Un registre de traitement (art. 30 RGPD) qui vivrait seulement dans un
 *   document Word vieillirait à la première migration. Une colonne ajoutée au
 *   schéma sans être déclarée ici serait une donnée détenue sans finalité
 *   écrite ni durée de conservation — exactement ce que le règlement interdit.
 *
 *   La carte est donc une STRUCTURE DE DONNÉES, et `npm run check:rgpd` la
 *   confronte au schéma réel : toute colonne personnelle présente en base et
 *   absente de cette liste fait échouer le contrôle.
 *
 * ⚠️ Ce que cette carte n'est pas.
 *
 *   Elle n'est pas un avis juridique. Elle décrit ce que le produit fait, avec
 *   les bases légales qui le justifient au regard de sa destination — un outil
 *   de conformité EUDR utilisé par des opérateurs. La qualification définitive
 *   appartient au responsable de traitement de chaque organisation cliente, qui
 *   est seul à connaître ses finalités propres.
 */

export interface DonneePersonnelle {
  /** Identifiant stable, utilisé par les contrôles et la documentation. */
  identifiant: string;
  /** Table(s) et colonne(s) concernées, telles qu'elles existent en base. */
  tables: string[];
  colonnes: string[];
  /** Ce que la donnée permet de faire. Sans finalité, pas de traitement licite. */
  finalite: string;
  /** Article ou motif du RGPD sur lequel repose le traitement. */
  baseLegale: string;
  /** Combien de temps, et pourquoi cette durée — pas « indéfiniment ». */
  conservation: string;
  /** Qui peut la lire, dans le produit. */
  acces: string;
}

export const CARTE_DONNEES: readonly DonneePersonnelle[] = [
  {
    identifiant: "compte-utilisateur",
    tables: ["gf_users"],
    colonnes: ["email", "name"],
    finalite:
      "Identifier une personne, l'authentifier et lui attribuer des droits dans son organisation.",
    baseLegale:
      "Exécution du contrat (art. 6.1.b) : sans identité, aucun compte n'est possible. Intérêt légitime (art. 6.1.f) pour la traçabilité des actions, imposée par ailleurs à l'opérateur EUDR.",
    conservation:
      "Durée de la relation contractuelle, puis 5 ans après la dernière activité — la durée de conservation des preuves de diligence raisonnée exigée par l'EUDR (art. 12).",
    acces: "Membres de la même organisation, selon leur rôle. Jamais visible d'une autre organisation (RLS).",
  },
  {
    identifiant: "session-et-securite",
    tables: ["gf_sessions"],
    colonnes: ["ip", "user_agent"],
    finalite:
      "Détecter le vol d'un jeton de session et limiter une attaque par bourrage d'identifiants. Ces données servent à protéger le compte, pas à suivre la personne.",
    baseLegale:
      "Intérêt légitime (art. 6.1.f) : la sécurité du service et de ses utilisateurs. Aucune donnée n'est utilisée à des fins publicitaires ou de profilage.",
    conservation:
      "Effacées 90 jours après la fin de validité de la session. Au-delà, elles ne servent plus à rien : la fenêtre de sécurité est passée, et les garder serait une conservation excessive.",
    acces: "Personne dans l'application : aucune route ne les expose. Lecture réservée à l'exploitant technique, en cas d'incident.",
  },
  {
    identifiant: "tentatives-connexion",
    tables: ["gf_login_attempts"],
    colonnes: ["window_key"],
    finalite:
      "Limiter le débit des tentatives de connexion. La clé mêle une adresse IP et un e-mail normalisés, tronqués en condensat.",
    baseLegale: "Intérêt légitime (art. 6.1.f) : prévention de l'abus et protection des comptes.",
    conservation: "Fenêtre glissante de quelques minutes à quelques heures selon la politique de limitation, puis purge.",
    acces: "Aucun accès applicatif. Table exclue du cloisonnement multi-tenant et de la lecture par les routes.",
  },
  {
    identifiant: "journal-audit",
    tables: ["gf_audit_logs"],
    colonnes: ["user_email", "acteur_id", "avant", "apres"],
    finalite:
      "Consigner qui a fait quoi, quand. C'est une obligation de traçabilité : un dossier EUDR dont on ne peut pas dire qui l'a modifié n'est pas opposable.",
    baseLegale:
      "Obligation légale (art. 6.1.c) : l'EUDR impose la traçabilité des diligences. Intérêt légitime pour la sécurité du service.",
    conservation:
      "Chaînée par empreinte et APPEND-ONLY en base : une ligne ne se modifie ni ne s'efface. Conservée 5 ans, comme les preuves de diligence.",
    acces:
      "Membres de l'organisation pour ses propres lignes, selon leur rôle. Les données personnelles recopiées par `avant/apres` sont assainies à l'écriture (voir `assainir-audit.ts`) — sans quoi le journal deviendrait un contournement du droit à l'effacement.",
  },
  {
    identifiant: "contact-fournisseur",
    tables: ["gf_suppliers"],
    colonnes: ["contact_name", "contact_email", "contact_phone"],
    finalite:
      "Joindre la personne responsable d'un fournisseur pour obtenir les pièces de légalité et traiter une non-conformité.",
    baseLegale:
      "Exécution du contrat (art. 6.1.b) lorsqu'il s'agit d'un fournisseur contractant ; intérêt légitime (art. 6.1.f) lorsqu'il s'agit du préposé d'une personne morale, dont les coordonnées professionnelles sont nécessaires à la relation.",
    conservation:
      "Durée de la relation fournisseur, puis 5 ans après la dernière livraison — alignée sur la conservation des preuves EUDR.",
    acces: "Membres de l'organisation du fournisseur, selon leur rôle.",
  },
  {
    identifiant: "producteur-et-operateur",
    tables: ["parcel_audits"],
    colonnes: ["producer_name", "operator_name", "operator_address"],
    finalite:
      "Documenter l'origine d'une parcelle et l'identité de l'opérateur qui déclare. Ces mentions sont exigées dans un dossier de diligence.",
    baseLegale:
      "Obligation légale (art. 6.1.c) : le règlement (UE) 2023/1115 impose d'identifier l'opérateur et le producteur, et de conserver ces informations.",
    conservation: "5 ans à compter de la mise sur le marché ou de l'exportation, conformément à l'art. 12 EUDR.",
    acces: "Membres de l'organisation de l'opérateur, selon leur rôle.",
  },
  {
    identifiant: "parcelle-geometrie",
    tables: ["gf_plots", "parcel_audits"],
    colonnes: ["geometry", "centroid_lon", "centroid_lat", "name"],
    finalite:
      "Localiser une parcelle pour l'analyse de déforestation et pour la déclaration. Un point ou un polygone situe une exploitation, donc une personne physique lorsqu'elle est un producteur.",
    baseLegale:
      "Obligation légale (art. 6.1.c) : les coordonnées géographiques des parcelles sont un élément OBLIGATOIRE de la déclaration de diligence (art. 9.1.d).",
    conservation: "5 ans après la dernière déclaration qui cite la parcelle, comme le reste du dossier.",
    acces: "Membres de l'organisation, selon leur rôle, y compris en lecture seule pour un auditeur.",
  },
  {
    identifiant: "adresse-organisation",
    tables: ["gf_organizations"],
    colonnes: ["address", "eori"],
    finalite:
      "Mentionner l'opérateur dans une déclaration de diligence. L'EORI identifie l'opérateur auprès des douanes.",
    baseLegale:
      "Obligation légale (art. 6.1.c) : l'identification de l'opérateur est une mention obligatoire de la déclaration.",
    conservation: "Durée de vie de l'organisation, puis 5 ans.",
    acces: "Membres de l'organisation ; les tiers ne voient que ce qui est exporté dans un dossier, jamais l'annuaire.",
  },
];

/** Les colonnes personnelles déclarées sur la carte, sans doublon. */
export function donneesPersonnellesDans(table: string): string[] {
  return CARTE_DONNEES.filter((e) => e.tables.includes(table)).flatMap((e) => e.colonnes);
}

/**
 * Les colonnes personnelles sont-elles assainies à la copie d'audit ?
 *
 * Sert au contrôle : une donnée personnelle peut être détenue par le produit,
 * elle ne doit pas être recopiée sans nécessité dans un journal immuable.
 */
export const COLONNES_ASSAINIES_A_L_AUDIT: readonly string[] = [
  "contact_email",
  "contact_phone",
  "user_email",
  "acteur_id",
  "ip",
  "user_agent",
];
