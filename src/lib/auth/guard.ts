import "server-only";

import type { NextRequest } from "next/server";

import type { Permission } from "./roles";
import { AuthError, requireAuth, requirePermission, type Session } from "./session";
import { apiError, authErrorResponse, isAuthError } from "./respond";
import { databaseUnavailableResponse, isDatabaseUnavailable } from "@/lib/api/db-error";
import { withTenant, type TenantTx } from "@/lib/tenant";
import { dansContexte, motifDeRoute, contexteCourant } from "@/lib/observability/contexte";
import { journal } from "@/lib/observability/journal";
import { enregistrerRequete, noterJauges } from "@/lib/observability/metriques";
import { avecIdempotence, methodeProtegee } from "@/lib/idempotence";

export interface GuardedContext {
  /** Session validée (utilisateur, organisation, permissions). */
  session: Session;
  /** Transaction avec le contexte du tenant posé (RLS active). */
  tx: TenantTx;
  /** Raccourci : identifiant de l'organisation de la session. */
  organizationId: string;
}

type Handler<C> = (
  request: NextRequest,
  context: C,
  ctx: GuardedContext,
) => Promise<Response> | Response;

/**
 * Signature attendue par Next.js pour un gestionnaire de route.
 */
export type RouteHandler = (request: NextRequest, context: unknown) => Promise<Response>;

/**
 * Enveloppe une route API : authentification obligatoire, contrôle de
 * permission, exécution **dans le contexte du tenant** (RLS), et traduction
 * des erreurs d'authentification.
 *
 * Utilisation :
 * `export const GET = guard("supplier:read")(async (req, ctx, { session, tx, organizationId }) => …)`
 *
 * ⚠️ deny-by-default : `guard()` sans permission exige seulement une session
 * valide. Le cloisonnement, lui, est systématique.
 */
export function guard<C = { params?: Promise<Record<string, string>> }>(
  permission?: Permission,
): (handler: Handler<C>) => RouteHandler {
  return (handler: Handler<C>): RouteHandler =>
    (async (request: NextRequest, context: unknown): Promise<Response> => {
      const debut = Date.now();
      const chemin = new URL(request.url).pathname;
    const route = motifDeRoute(chemin);
      // ⚠️ L'identifiant proposé par le client est réutilisé **s'il a la forme
      // attendue** (cf. `dansContexte`) — jamais recopié tel quel.
      const propose = request.headers.get("x-request-id");
      let organisation: string | undefined;

      const reponse = await dansContexte({ route, requestId: propose, debut }, async () => {
        try {
          const session = permission ? await requirePermission(permission) : await requireAuth();

          const organizationId = session.user.organizationId;
          if (!organizationId) {
            throw new AuthError(
              403,
              "tenant_unresolved",
              "Aucune organisation rattachée à ce compte : accès refusé.",
            );
          }
          organisation = organizationId;

          // P1-11 — les méthodes qui modifient l'état sont exécutées sous
          //   idempotence : une même soumission rejouée ne produit qu'une
          //   seule ressource, et la requête jumelle reçoit la réponse de la
          //   première. Les lectures passent directement.
          const executer = (): Promise<Response> =>
            withTenant(organizationId, async (tx) =>
              handler(request, context as C, { session, tx, organizationId }),
            );

          return methodeProtegee(request.method)
            ? await avecIdempotence({
                request,
                route,
                chemin,
                organizationId,
                utilisateurId: session.user.id,
                operation: executer,
              })
            : await executer();
        } catch (error) {
          if (isAuthError(error)) return authErrorResponse(error);
          // P0-07 : une base injoignable se déclare. On ne la déguise ni en 200
          // dégradé, ni en 404, ni en erreur générique sans corps exploitable.
          if (isDatabaseUnavailable(error)) {
            // ⚠️ Une base injoignable est l'incident le plus grave du produit :
            // elle est journalisée comme telle, et la jauge est posée pour que
            // la règle d'alerte correspondante se déclenche sans attendre le
            // passage du supervisionnaire.
            noterJauges("base", 0);
            journal.error("base.injoignable", {
              route,
              erreur: error instanceof Error ? error.message : String(error),
            });
            return databaseUnavailableResponse(error);
          }

          // ⚠️ P1-06 — une erreur non traitée partait en 500 anonyme : aucune
          // trace, aucune corrélation, aucun moyen de relier le signalement
          // d'un utilisateur à une ligne de journal. Elle est consignée avec
          // sa pile, et l'identifiant de corrélation est renvoyé au client
          // pour qu'un signalement soit exploitable.
          journal.error("requete.en_echec", {
            route,
            methode: request.method,
            erreur: error instanceof Error ? error.message : String(error),
            pile: error instanceof Error ? (error.stack ?? "").split("\n").slice(0, 8) : null,
          });
          return Response.json(
            {
              detail: "Erreur interne du serveur.",
              requestId: contexteCourant()?.requestId ?? null,
            },
            { status: 500 },
          );
        }
      });

      const dureeMs = Date.now() - debut;
      enregistrerRequete({
        route,
        methode: request.method,
        statut: reponse.status,
        dureeMs,
        organisation: organisation ?? null,
      });
      if (reponse.status >= 500) {
        journal.warn("requete.5xx", { route, methode: request.method, statut: reponse.status, dureeMs });
      }
      // L'identifiant de corrélation est renvoyé : c'est lui qui permet à un
      // utilisateur de citer une requête précise dans un signalement.
      const requestId = contexteCourant()?.requestId;
      if (requestId) reponse.headers.set("X-Request-Id", requestId);
      return reponse;
    }) as RouteHandler;
}

/** Alias explicite pour les routes publiques (documentation du deny-by-default). */
export function publicRoute<C = { params?: Promise<Record<string, string>> }>(
  handler: (request: NextRequest, context: C) => Promise<Response> | Response,
): RouteHandler {
  return (async (request: NextRequest, context: unknown): Promise<Response> => {
    const debut = Date.now();
    const chemin = new URL(request.url).pathname;
    const route = motifDeRoute(chemin);
    const propose = request.headers.get("x-request-id");

    const reponse = await dansContexte({ route, requestId: propose, debut }, async () => {
      try {
        return await handler(request, context as C);
      } catch (error) {
        journal.error("requete.publique.en_echec", {
          route,
          methode: request.method,
          erreur: error instanceof Error ? error.message : String(error),
        });
        return apiError("internal_error", "Erreur interne.", 500);
      }
    });

    enregistrerRequete({
      route,
      methode: request.method,
      statut: reponse.status,
      dureeMs: Date.now() - debut,
    });
    const requestId = contexteCourant()?.requestId;
    if (requestId) reponse.headers.set("X-Request-Id", requestId);
    return reponse;
  }) as RouteHandler;
}

export { AuthError };
