import "server-only";

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { identifiantCourant } from "./contexte";

/**
 * Journal applicatif structuré.
 *
 * ⚠️ P1-06 — pourquoi un module, alors que `console.error` existe.
 *
 * L'audit relevait « aucune journalisation structurée (`console.warn` /
 * `console.error`) ». La différence n'est pas cosmétique : une ligne
 * `console.error("boom", err)` ne dit ni quelle requête, ni quelle
 * organisation, ni depuis quand, et un outil ne peut pas la regrouper. Sans
 * structure, il n'y a pas de métrique, et sans métrique il n'y a pas d'alerte.
 *
 * Deux exigences gouvernent ce fichier :
 *
 *   1. **Il ne doit jamais faire échouer ce qu'il observe.** Un disque plein
 *      est précisément le moment où l'on a besoin des journaux ; si l'écriture
 *      échoue, on le signale et on continue.
 *   2. **Il ne doit jamais écrire un secret.** Un journal est recopié, indexé,
 *      conservé. Le filtrage se fait donc à la source, par clé, et non après
 *      coup par qui relit.
 */

export type Niveau = "debug" | "info" | "warn" | "error";

const ORDRE: Record<Niveau, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Clés dont la valeur ne doit jamais atteindre un journal, quel que soit le niveau. */
const CLES_SENSIBLES = new Set([
  "password",
  "mot_de_passe",
  "motdepasse",
  "newpassword",
  "currentpassword",
  "secret",
  "mfa_secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "set-cookie",
  "sig",
  "signature",
  "api_key",
  "apikey",
  "gfw_api_key",
  "database_url",
  "eori",
]);

const MOTIFS_SENSIBLES =
  /(password|motdepasse|secret|token|api[_-]?key|authorization|cookie|sig\b)/i;

const VALEUR_MASQUEE = "[masqué]";

/**
 * Masque récursivement ce qui ne doit pas être écrit.
 *
 * ⚠️ La profondeur est bornée : un objet cyclique ou très profond ne doit pas
 *   faire exploser la sérialisation, et donc la requête, au seul motif qu'on
 *   cherchait à la journaliser.
 */
export function rediger(valeur: unknown, profondeur = 0): unknown {
  if (valeur === null || valeur === undefined) return valeur;
  if (typeof valeur === "string") {
    return valeur.length > 500 ? valeur.slice(0, 500) + "…(tronqué)" : valeur;
  }
  if (typeof valeur !== "object") {
    return typeof valeur === "bigint" ? String(valeur) : valeur;
  }
  if (valeur instanceof Error) {
    return {
      type: valeur.name,
      message: valeur.message,
      // La pile est utile, mais elle peut contenir des variables locales.
      // Elle est donc conservée pour les erreurs, tronquée, et seulement
      // jusqu'à la profondeur utile au diagnostic.
      pile: (valeur.stack ?? "").split("\n").slice(0, 12).join("\n"),
    };
  }
  if (profondeur > 4) return "[objet trop profond]";

  if (Array.isArray(valeur)) {
    return valeur.slice(0, 50).map((v) => rediger(v, profondeur + 1));
  }

  const sortie: Record<string, unknown> = {};
  for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) {
    sortie[cle] = CLES_SENSIBLES.has(cle.toLowerCase()) || MOTIFS_SENSIBLES.test(cle)
      ? VALEUR_MASQUEE
      : rediger(v, profondeur + 1);
  }
  return sortie;
}

/** Destination du fichier de journal. `null` si le journal fichier est désactivé. */
function fichierJournal(): string | null {
  const explicite = process.env.GF_LOG_FILE?.trim();
  if (explicite === "off" || explicite === "") return null;
  if (explicite) return resolve(explicite);
  // Un fichier par défaut, uniquement hors production : en production, c'est
  // le collecteur de l'infrastructure qui ramasse la sortie standard, et
  // écrire en plus sur le disque de l'instance serait écrire au mauvais
  // endroit (conteneur éphémère).
  if (process.env.NODE_ENV === "production") return null;
  return resolve(process.cwd(), "var", "log", "app.log");
}

let repertoirePret = false;

function ecrireFichier(ligne: string): void {
  const chemin = fichierJournal();
  if (!chemin) return;
  try {
    if (!repertoirePret) {
      mkdirSync(dirname(chemin), { recursive: true });
      repertoirePret = true;
    }
    appendFileSync(chemin, ligne + "\n", "utf8");
  } catch {
    // ⚠️ Silence volontaire, et pour une raison : si le disque est plein,
    // tenter d'écrire « le disque est plein » échouera aussi, et une boucle
    // d'échecs masquerait la panne d'origine. L'alerte correspondante est
    // portée par la règle `disque` du module d'alertes, pas par le journal.
  }
}

/** Niveau minimal retenu, piloté par `GF_LOG_LEVEL` (défaut : info). */
function niveauMinimum(): Niveau {
  const brut = (process.env.GF_LOG_LEVEL ?? "info").toLowerCase();
  return (["debug", "info", "warn", "error"] as const).includes(brut as Niveau)
    ? (brut as Niveau)
    : "info";
}

export interface ChampsJournal {
  [cle: string]: unknown;
}

function emettre(niveau: Niveau, evenement: string, champs: ChampsJournal): void {
  if (ORDRE[niveau] < ORDRE[niveauMinimum()]) return;

  const entree = {
    // `ts` en ISO : un horodatage local serait ambigu dès que deux instances
    // ne sont pas dans le même fuseau, et c'est le premier réflexe d'un
    // outil d'analyse que de trier par date.
    ts: new Date().toISOString(),
    niveau,
    evenement,
    requestId: identifiantCourant(),
    ...(rediger(champs) as ChampsJournal),
  };

  let ligne: string;
  try {
    ligne = JSON.stringify(entree);
  } catch {
    // Objet non sérialisable : on ne perd pas l'événement pour autant.
    ligne = JSON.stringify({
      ts: entree.ts,
      niveau,
      evenement,
      requestId: entree.requestId,
      detail: "[non sérialisable]",
    });
  }

  ecrireFichier(ligne);
  // La sortie standard reste la voie normale : c'est elle qu'un collecteur
  // (journald, Docker, OpenTelemetry) ramasse en production.
  if (niveau === "error") console.error(ligne);
  else if (niveau === "warn") console.warn(ligne);
  else if (niveau === "debug") console.debug(ligne);
  else console.log(ligne);
}

export const journal = {
  debug(evenement: string, champs: ChampsJournal = {}): void {
    emettre("debug", evenement, champs);
  },
  info(evenement: string, champs: ChampsJournal = {}): void {
    emettre("info", evenement, champs);
  },
  warn(evenement: string, champs: ChampsJournal = {}): void {
    emettre("warn", evenement, champs);
  },
  error(evenement: string, champs: ChampsJournal = {}): void {
    emettre("error", evenement, champs);
  },
};

/** Répertoire racine des journaux, pour les outils d'exploitation. */
export const RACINE_JOURNAUX = join(process.cwd(), "var", "log");
