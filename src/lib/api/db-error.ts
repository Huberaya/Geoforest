import "server-only";

import { NextResponse } from "next/server";

/**
 * Détection et traduction des incidents de persistance (P0-07).
 *
 * Règle : **aucune réponse 2xx ne doit être renvoyée si l'écriture n'est pas
 * durablement enregistrée.** Une base injoignable n'est pas une situation
 * dégradée que l'on masque : c'est une indisponibilité que l'on déclare.
 */

/** Codes `pg` et erreurs réseau qui trahissent une base indisponible. */
const UNAVAILABLE_CODES = new Set([
  // Connexion / réseau
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EPIPE",
  // SQLSTATE : exceptions de connexion (classe 08)
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  // SQLSTATE : arrêt / annulation par l'administrateur (classe 57)
  "57P01",
  "57P02",
  "57P03",
  // SQLSTATE : ressources épuisées (classe 53)
  "53300",
  "53200",
]);

interface MaybePgError {
  code?: unknown;
  errno?: unknown;
  cause?: unknown;
}

function codeOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as MaybePgError;
  if (typeof candidate.code === "string") return candidate.code;
  if (typeof candidate.errno === "string") return candidate.errno;
  return undefined;
}

/**
 * Vrai si l'erreur provient d'une base injoignable, par opposition à une erreur
 * métier (contrainte violée, valeur invalide) qui relève d'un 4xx.
 */
export function isDatabaseUnavailable(error: unknown, depth = 0): boolean {
  const code = codeOf(error);
  if (code && UNAVAILABLE_CODES.has(code)) return true;
  if (depth > 4) return false;

  if (error && typeof error === "object") {
    const candidate = error as MaybePgError;
    if (candidate.cause) return isDatabaseUnavailable(candidate.cause, depth + 1);
  }
  return false;
}

/**
 * Réponse à renvoyer quand une lecture ou une écriture n'a pas pu aboutir.
 *
 * Le corps est explicite et reprend le message d'origine : l'appelant doit
 * pouvoir comprendre ce qui s'est passé, jamais le deviner.
 */
export function databaseUnavailableResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json(
    {
      detail:
        "Persistance indisponible : l'opération n'a pas été enregistrée. " +
        "Aucune donnée n'a été créée ni modifiée ; aucune conclusion ne doit en être tirée.",
      cause: message,
      retryable: true,
    },
    { status: 503, headers: { "Retry-After": "10" } },
  );
}
