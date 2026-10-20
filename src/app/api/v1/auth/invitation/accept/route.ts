import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { dbAdmin as db } from "@/db/admin";
import { suppliers, users } from "@/db/schema";
import { lireCorpsJson } from "@/lib/api/body";
import { logAuditEvent } from "@/lib/audit-log";
import { checkPasswordPolicy, hashPassword } from "@/lib/auth/password";
import { publicRoute } from "@/lib/auth/guard";
import { hashToken } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Activation d'un compte fournisseur (chantier 6). Route publique : le producteur n'a
 * pas encore de session. Le jeton (256 bits) est la seule preuve. Il est comparé par
 * empreinte SHA-256 et n'est utilisable qu'une fois.
 *
 * La lecture et l'écriture passent par la connexion d'administration, hors contexte de
 * tenant : le compte n'est pas encore rattaché à une session. Ce chemin ne fait que
 * deux choses : poser le mot de passe, et passer le compte de `invited` à `active`.
 */

const JETON_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** Message unique pour toute impossibilité d'activer : pas d'oracle sur le jeton. */
const INVALIDE = "Invitation invalide ou expirée.";

export const POST = publicRoute(async (request: Request) => {
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as Record<string, unknown>;

  const jeton = typeof body.token === "string" ? body.token.trim() : "";
  const motDePasse = typeof body.password === "string" ? body.password : "";
  if (!JETON_PATTERN.test(jeton)) return NextResponse.json({ detail: INVALIDE }, { status: 400 });

  const empreinte = hashToken(jeton);
  const [compte] = await db
    .select({
      id: users.id,
      email: users.email,
      organizationId: users.organizationId,
      supplierId: users.supplierId,
      invitationExpiresAt: users.invitationExpiresAt,
    })
    .from(users)
    .where(and(eq(users.invitationTokenHash, empreinte), eq(users.status, "invited")))
    .limit(1);
  if (!compte || !compte.invitationExpiresAt || compte.invitationExpiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ detail: INVALIDE }, { status: 400 });
  }

  const politique = checkPasswordPolicy(motDePasse, compte.email);
  if (!politique.ok) {
    return NextResponse.json(
      { detail: `Mot de passe non conforme : ${politique.reasons.join(", ")}.`, reasons: politique.reasons },
      { status: 422 },
    );
  }

  const hash = await hashPassword(motDePasse);
  // Le jeton est effacé dans la même écriture : une seconde soumission ne trouve plus rien.
  const actives = await db
    .update(users)
    .set({
      passwordHash: hash,
      passwordUpdatedAt: new Date(),
      status: "active",
      invitationTokenHash: null,
      invitationExpiresAt: null,
      failedLogins: 0,
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, compte.id), eq(users.invitationTokenHash, empreinte), eq(users.status, "invited")))
    .returning({ id: users.id });
  if (actives.length === 0) return NextResponse.json({ detail: INVALIDE }, { status: 400 });

  if (compte.supplierId) {
    await db
      .update(suppliers)
      .set({ status: "ACTIVE", updatedAt: new Date() })
      .where(and(eq(suppliers.id, compte.supplierId), eq(suppliers.organizationId, compte.organizationId)));
  }

  await logAuditEvent({
    organizationId: compte.organizationId,
    userEmail: compte.email,
    action: "UPDATE",
    entityType: "SUPPLIER",
    entityId: compte.supplierId ?? compte.id,
    details: { evenement: "invitation_acceptee", compte: compte.id },
  });

  return NextResponse.json({ status: "active" });
});
