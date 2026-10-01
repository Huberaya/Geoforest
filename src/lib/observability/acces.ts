import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Accès aux routes d'observabilité.
 *
 * ⚠️ P1-06 — pourquoi un accès à part, et pas une route publique.
 *   `/api/metrics` expose la topologie du service : quelles routes existent,
 *   lesquelles sont lentes, lesquelles échouent, depuis quelle organisation.
 *   C'est exactement la carte qu'un attaquant dresserait à tâtons, requête
 *   après requête. Cette route n'est donc publique sous aucun prétexte, et la
 *   décision par défaut est le refus.
 *
 * Deux voies :
 *
 *   · **la session**, comme partout ailleurs ;
 *   · **un jeton statique** (`GF_METRICS_TOKEN`), pour un supervisionnaire qui
 *     ne peut pas ouvrir de session interactive. Il n'est accepté que s'il est
 *     explicitement configuré : sans lui, la session est exigée. Un jeton
 *     absent n'assouplit jamais la règle, il la laisse stricte.
 */

export function jetonConfigure(): boolean {
  return Boolean(process.env.GF_METRICS_TOKEN?.trim());
}

/**
 * Vérifie l'en-tête `Authorization: Bearer …`.
 *
 * ⚠️ La comparaison porte sur des **condensats** de longueur fixe, et non sur
 *   les chaînes elles-mêmes : `timingSafeEqual` exige des longueurs égales, et
 *   comparer les longueurs avant de comparer le contenu réintroduirait par le
 *   temps d'exécution l'information qu'on cherche à protéger.
 */
export function jetonValide(request: NextRequest): boolean {
  const attendu = process.env.GF_METRICS_TOKEN?.trim();
  if (!attendu) return false;
  const entete = request.headers.get("authorization") ?? "";
  const presente = /^Bearer\s+(.+)$/i.exec(entete)?.[1]?.trim();
  if (!presente) return false;
  const a = createHash("sha256").update(attendu).digest();
  const b = createHash("sha256").update(presente).digest();
  return timingSafeEqual(a, b);
}
