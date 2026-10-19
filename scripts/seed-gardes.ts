/**
 * Garde-fous de l'amorçage de démonstration.
 *
 * ⚠️ Défaut corrigé.
 *
 *   `scripts/seed-auth.ts` créait cinq comptes, dont un administrateur, avec un
 *   mot de passe **écrit dans le dépôt** et utilisé par défaut. Il mettait en
 *   outre à jour le mot de passe des comptes déjà existants, remettait leur MFA
 *   à zéro et les réactivait. Lancé par erreur contre une base partagée, il
 *   remplaçait les identifiants réels par un secret public — sans rien demander.
 *
 *   Ce module centralise les refus, pour qu'ils soient testables sans base :
 *   • le mot de passe doit être fourni explicitement et ne doit pas être celui
 *     qui figure dans l'historique du dépôt ;
 *   • l'exécution est refusée en production (`NODE_ENV=production`) ;
 *   • une base non locale n'est acceptée que sur autorisation explicite ;
 *   • la réinitialisation de comptes existants exige un drapeau dédié ;
 *   • le mot de passe n'est jamais affiché.
 *
 * Module sans dépendance : importé par le script et par les tests.
 */

export interface EnvironnementSeed {
  NODE_ENV?: string;
  SEED_DEMO_PASSWORD?: string;
  SEED_REINITIALISER?: string;
  SEED_AUTORISE_HOTE_DISTANT?: string;
  DATABASE_URL_ADMIN?: string;
  DATABASE_URL?: string;
}

export interface DecisionSeed {
  /** `false` : le script doit s'arrêter sans écrire. */
  autorise: boolean;
  /** Raisons du refus, en clair. Vide quand l'exécution est autorisée. */
  refus: string[];
  /** Faut-il réinitialiser les comptes déjà présents ? */
  reinitialiser: boolean;
  /** Longueur minimale exigée pour le mot de passe de démonstration. */
  longueur: number;
}

/** Mot de passe publié dans l'historique du dépôt : plus jamais accepté. */
export const MOT_DE_PASSE_PUBLIE = ["Trace", "Demo2026x"].join("!");

export const LONGUEUR_MINIMALE = 12;

/** Hôtes considérés comme locaux : une base de démonstration y est isolée. */
const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);

function hoteDe(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Décide si l'amorçage de démonstration peut s'exécuter.
 *
 * Toutes les raisons de refus sont renvoyées ensemble : corriger un script en
 * découvrant les erreurs une par une est une perte de temps, et un message qui
 * n'en montre qu'une laisse croire que les autres n'existent pas.
 */
export function validerSeed(env: EnvironnementSeed): DecisionSeed {
  const refus: string[] = [];
  const motDePasse = env.SEED_DEMO_PASSWORD?.trim() ?? "";

  if (env.NODE_ENV === "production") {
    refus.push(
      "NODE_ENV=production : des comptes de démonstration ne doivent pas être créés sur une instance de production.",
    );
  }

  if (!motDePasse) {
    refus.push(
      "SEED_DEMO_PASSWORD est absent : aucun mot de passe par défaut n'est fourni. " +
        "Définir une valeur d'au moins " +
        LONGUEUR_MINIMALE +
        " caractères, propre à votre poste.",
    );
  } else {
    if (motDePasse.length < LONGUEUR_MINIMALE) {
      refus.push(
        `SEED_DEMO_PASSWORD doit contenir au moins ${LONGUEUR_MINIMALE} caractères (${motDePasse.length} fournis).`,
      );
    }
    if (motDePasse === MOT_DE_PASSE_PUBLIE) {
      refus.push(
        "SEED_DEMO_PASSWORD est le mot de passe publié dans l'historique du dépôt : il est connu de tous.",
      );
    }
  }

  const url = env.DATABASE_URL_ADMIN ?? env.DATABASE_URL ?? "";
  if (!url) {
    refus.push("Aucune base cible : DATABASE_URL_ADMIN (ou DATABASE_URL) n'est pas défini.");
  } else {
    const hote = hoteDe(url);
    if (hote === null) {
      refus.push("L'URL de base est illisible : impossible d'établir si la cible est locale.");
    } else if (!HOTES_LOCAUX.has(hote) && env.SEED_AUTORISE_HOTE_DISTANT !== "oui") {
      refus.push(
        `La base cible n'est pas locale (${hote}). Des identifiants de démonstration connus ne doivent pas y être installés ; ` +
          "SEED_AUTORISE_HOTE_DISTANT=oui permet de passer outre en connaissance de cause.",
      );
    }
  }

  return {
    autorise: refus.length === 0,
    refus,
    reinitialiser: env.SEED_REINITIALISER === "oui",
    longueur: LONGUEUR_MINIMALE,
  };
}
