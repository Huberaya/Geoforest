/**
 * Limites de ressource — **un seul endroit** où elles sont définies.
 *
 * ⚠️ P1-07 — pourquoi ce fichier existe.
 *
 * Avant, aucune route ne bornait quoi que ce soit : un corps de 8 Mo était lu
 * en mémoire et stocké, une géométrie imbriquée sur 2 000 niveaux était
 * acceptée et écrite en base, un polygone de 100 000 sommets était traité, et
 * 200 requêtes pouvaient être envoyées en 3 secondes sans la moindre réaction.
 * Mesuré sur le produit avant correction, le 30/09/2026.
 *
 * Rien de tout cela n'est une attaque sophistiquée : ce sont des valeurs
 * qu'un client unique envoie sans même le vouloir. L'absence de limite
 * transforme une maladresse en panne.
 *
 * Ce module est volontairement **sans aucune dépendance** : il est importé
 * aussi bien par les routes (Node) que par le middleware (Edge).
 */

/** Corps de requête : 1 Mio. Un dossier EUDR ne dépasse pas quelques centaines de ko. */
export const CORPS_MAX_OCTETS = 1 * 1024 * 1024;

/**
 * Pièce justificative téléversée : 10 Mio.
 *
 * ⚠️ Limite distincte de celle du corps JSON, et ce n'est pas une incohérence.
 * Un corps JSON décrit une géométrie : 1 Mio suffit largement à 10 000 sommets.
 * Une pièce justificative est un PDF numérique ou un permis scanné, dont la
 * taille n'a rien à voir. Calquer la limite du JSON interdirait des documents
 * parfaitement légitimes ; supprimer la borne rouvrirait la brèche fermée en
 * P1-07. La borne est donc propre au téléversement, et la lecture qui l'applique
 * compte les octets pendant le transfert (`src/lib/api/multipart.ts`), comme
 * pour le JSON.
 */
export const FICHIER_MAX_OCTETS = 10 * 1024 * 1024;

/** Types de pièces refusés au dépôt, quel que soit le nom du fichier. */
export const TYPES_REFUSES = ["application/x-dosexec", "application/x-elf", "application/x-mach-binary"] as const;

/** Profondeur d'imbrication maximale d'un objet JSON accepté. */
export const PROFONDEUR_MAX = 32;

/** Nombre maximal de sommets d'une géométrie. */
export const SOMMETS_MAX = 10_000;

/**
 * Champs dont la taille est bornée individuellement.
 * Une parcelle de 10 000 sommets tient largement sous 1 Mio ; c'est le
 * bourrage de champs texte qui fait exploser un corps.
 */
export const CHAMPS_MAX: Record<string, number> = {
  name: 200,
  title: 200,
  reference: 120,
  description: 4_000,
  notes: 4_000,
  fileName: 255,
  fileUrl: 2_048,
  contactName: 200,
  contactEmail: 320,
  contactPhone: 64,
  assignee: 200,
};

// ------------------------------------------------------------------ Cadence
//
// Deux fenêtres complémentaires :
//   • une fenêtre courte qui arrête les rafales ;
//   • une fenêtre longue qui arrête les envois soutenus.
// Une seule fenêtre laisserait passer soit les rafales, soit les envois lents.
//
// Les valeurs sont choisies pour qu'un usage humain ne soit jamais gêné —
// un écran charge une dizaine de requêtes — tout en bornant une machine.

/**
 * Rafale : requêtes admises par organisation sur 10 secondes.
 *
 * Le chiffre se justifie par la mesure : l'envoi de 200 requêtes en 3,4
 * secondes — environ 59 par seconde — passait intégralement. Une page de
 * l'application charge une dizaine de requêtes, un tableau de bord qui se
 * rafraîchit toutes les 5 secondes en consomme 2 par seconde. La limite est
 * donc environ soixante fois l'usage humain, et bloque l'envoi mesuré.
 */
export const CADENCE_ORG_RAFALE = 150;
export const CADENCE_ORG_RAFALE_FENETRE_MS = 10_000;

/** Régime soutenu : requêtes admises par organisation par minute. */
export const CADENCE_ORG_SOUTENUE = 900;
export const CADENCE_ORG_SOUTENUE_FENETRE_MS = 60_000;

/**
 * Rafale et régime soutenu par adresse IP.
 *
 * Volontairement plus large que le quota par organisation : un immeuble de
 * bureaux, une université ou un opérateur mobile partagent une adresse de
 * sortie. Puiser sur l'adresse IP la seule ressource de limitation pénali-
 * serait des utilisateurs qui ne se connaissent pas. L'adresse IP sert donc
 * de second rideau, l'organisation étant le premier.
 */
export const CADENCE_IP_RAFALE = 600;
export const CADENCE_IP_RAFALE_FENETRE_MS = 10_000;
export const CADENCE_IP_SOUTENUE = 3_000;
export const CADENCE_IP_SOUTENUE_FENETRE_MS = 60_000;

/**
 * Routes recevant un secret (connexion, code TOTP, changement de mot de passe).
 *
 * Beaucoup plus serré que le reste, mais pas autant qu'on serait tenté de le
 * faire : une première version fixait 10 par minute, et le parcours réel l'a
 * démenti — chaque ouverture de session coûte deux requêtes (connexion, puis
 * code TOTP), si bien qu'une poignée d'utilisateurs derrière une même adresse
 * de sortie suffisait à épuiser le quota en usage parfaitement normal.
 *
 * Le chiffre retenu, 30 par minute, représente une dizaine de fois l'usage
 * légitime d'un bureau tout en bornant une machine : un hachage de mot de
 * passe toutes les deux secondes est négligeable, là où un script en
 * enchaînait plusieurs milliers par minute sans la moindre réaction.
 *
 * La protection contre les essais de mot de passe n'est d'ailleurs pas ici :
 * elle est assurée par le verrouillage de compte (`gf_login_attempts`), qui
 * compte les échecs **par compte**. Les deux se complètent et ne se
 * remplacent pas.
 */
export const CADENCE_AUTH = 30;
export const CADENCE_AUTH_FENETRE_MS = 60_000;

// ------------------------------------------------------------- Délai d'expiration

/** Requête SQL : au-delà, la transaction est annulée par PostgreSQL. */
export const SQL_STATEMENT_TIMEOUT_MS = 10_000;
export const SQL_IDLE_IN_TRANSACTION_TIMEOUT_MS = 15_000;
export const SQL_CONNECTION_TIMEOUT_MS = 5_000;

/** Appel HTTP sortant (API satellite). */
export const HTTP_EXTERNE_TIMEOUT_MS = 10_000;

/** En-tête posé sur les réponses 429 : secondes à attendre. */
export function retryAfter(secondes: number): string {
  return String(Math.max(1, Math.ceil(secondes)));
}
