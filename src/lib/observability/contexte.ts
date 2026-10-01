import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Contexte de requête propagé sans paramètre explicite.
 *
 * ⚠️ P1-06 — pourquoi un `AsyncLocalStorage` et non un argument de plus.
 *   L'identifiant de corrélation doit figurer dans chaque ligne écrite par
 *   n'importe quelle couche — accès aux données, stockage, analyse — y compris
 *   dans un appel profond qui n'a aucune raison de connaître la requête. Le
 *   faire transiter par les signatures obligerait à le passer partout : la
 *   première fonction oubliée romprait la chaîne, et le lien entre une erreur
 *   et la requête qui l'a provoquée serait perdu sans que rien ne le signale.
 */
export interface ContexteRequete {
  /** Identifiant de corrélation : une requête, un identifiant, de bout en bout. */
  requestId: string;
  /** Route logique (motif), pas l'URL brute qui peut contenir un secret. */
  route: string;
  /** Organisation de la session, si elle est connue. */
  organisation?: string;
  /** Horodatage de début, en millisecondes. */
  debut: number;
}

const stockage = new AsyncLocalStorage<ContexteRequete>();

/** Identifiant court, lisible, et non prédictible. */
export function nouvelIdentifiant(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

export function contexteCourant(): ContexteRequete | undefined {
  return stockage.getStore();
}

/** Identifiant de corrélation de la requête en cours, ou « — » hors requête. */
export function identifiantCourant(): string {
  return stockage.getStore()?.requestId ?? "—";
}

/**
 * Exécute `fn` dans un contexte de requête.
 *
 * ⚠️ L'identifiant fourni par le client est réutilisé **s'il a la forme
 * attendue**, jamais tel quel : accepter un en-tête arbitraire permettrait à
 * un appelant d'écrire ce qu'il veut dans le journal (injection de fausses
 * lignes, ou plus simplement d'un contenu destiné à polluer l'outil d'analyse).
 */
export function dansContexte<T>(
  contexte: Omit<ContexteRequete, "requestId"> & { requestId?: string | null },
  fn: () => Promise<T> | T,
): Promise<T> | T {
  const brut = contexte.requestId ?? "";
  const requestId = /^[A-Za-z0-9_-]{8,64}$/.test(brut) ? brut : nouvelIdentifiant();
  return stockage.run({ ...contexte, requestId }, fn);
}

/**
 * Réduit une URL à un motif de route.
 *
 * ⚠️ Journaliser l'URL brute est une fuite : elle porte des identifiants de
 *   documents, des jetons de téléchargement signés, parfois un mot de passe.
 *   Les segments qui ne sont pas de purs mots-clés sont donc remplacés, et la
 *   chaîne de requête n'est jamais conservée.
 */
export function motifDeRoute(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) =>
      /^[a-z][a-z0-9-]{0,31}$/i.test(segment) && !UUID_LIKE.test(segment)
        ? segment
        : segment === ""
          ? ""
          : ":id",
    )
    .join("/");
}

const UUID_LIKE =
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
