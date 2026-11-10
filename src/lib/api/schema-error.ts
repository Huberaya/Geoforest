import "server-only";

import { NextResponse } from "next/server";

import type { EtatSchemaSecurite } from "@/db/etat-schema";

/**
 * Réponse opposable à un schéma incomplet — R-05.
 *
 * 503 et non 500 : l'instance n'est pas prête à recevoir du trafic, elle peut
 * le redevenir après migration. `Retry-After` donne un délai d'attente
 * exploitable. Les codes de problèmes sont exposés sans détail d'infrastructure
 * (pas de nom d'hôte, pas de chaîne de connexion).
 */
export function schemaIncompletResponse(etat: EtatSchemaSecurite): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "schema_incomplete",
        message:
          "Schéma de sécurité incomplet : le service refuse de servir du trafic applicatif. " +
          "Exécutez `npm run db:migrate` jusqu'à son succès, puis redémarrez l'instance.",
        details: {
          problemes: etat.problemes.map((p) => ({ code: p.code, message: p.message })),
          role: etat.role,
        },
      },
      retryable: true,
    },
    { status: 503, headers: { "Retry-After": "15" } },
  );
}

/**
 * Renvoie une réponse 503 si le schéma n'est pas prêt, `null` sinon.
 * Réservé aux routes publiques qui touchent la base (connexion, MFA, refresh) :
 * elles ne passent pas par `guard()` et ne doivent pas répondre 500 sur une
 * base à moitié migrée.
 */
export async function exigerSchemaOuReponse(): Promise<NextResponse | null> {
  const { exigerSchemaPret, SchemaSecuriteIncompletError } = await import("@/db/etat-schema");
  try {
    await exigerSchemaPret();
    return null;
  } catch (erreur) {
    if (erreur instanceof SchemaSecuriteIncompletError) {
      return schemaIncompletResponse(erreur.etat);
    }
    throw erreur;
  }
}
