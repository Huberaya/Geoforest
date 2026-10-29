import { randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { dbAdmin } from "@/db/admin";
import { suppliers, users } from "@/db/schema";
import { lireCorpsJson } from "@/lib/api/body";
import { logAction } from "@/lib/api/audit-log";
import { guard } from "@/lib/auth/guard";
import { hashToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Invitation d'un producteur (chantier 6, « parcours fournisseur »).
 *
 * POST : crée le compte fournisseur (rôle `supplier`, statut `invited`), rattaché à
 *        la fiche producteur, et émet un lien d'activation valable 7 jours.
 *        Le jeton n'est affiché qu'une fois ; seule son empreinte SHA-256 est stockée.
 *        Réémission possible tant que le compte n'est pas activé, ou après révocation.
 * DELETE : révoque l'accès (compte suspendu, jeton annulé). Effet immédiat : la session
 *        est refusée à la requête suivante (statut relu en base à chaque appel).
 *
 * Aucun courriel n'est envoyé : aucun fournisseur d'envoi n'est configuré. L'administrateur
 * transmet le lien par un canal de confiance. Cette limite est documentée.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DUREE_INVITATION_MS = 7 * 24 * 60 * 60 * 1000;

type Params = { params: Promise<{ id: string }> };

/** Le jeton est placé dans le fragment (`#`) : il n'est jamais envoyé au serveur ni journalisé. */
function lienInvitation(request: Request, jeton: string): string {
  const base = process.env.GF_PUBLIC_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  return `${base}/accepter-invitation#jeton=${jeton}`;
}

interface CompteExistant {
  id: string | null;
  organizationId: string | null;
  supplierId: string | null;
  status: string | null;
}

export const POST = guard<Params>("supplier:write")(async (request, context, { tx, organizationId, session }) => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Fournisseur introuvable" }, { status: 404 });

  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as Record<string, unknown>;

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const nom = typeof body.name === "string" ? body.name.trim() : "";
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return NextResponse.json({ detail: "Adresse e-mail invalide" }, { status: 422 });
  }
  if (nom.length < 2 || nom.length > 200) {
    return NextResponse.json({ detail: "Nom du contact requis (2 à 200 caractères)" }, { status: 422 });
  }

  const [fournisseur] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.organizationId, organizationId)))
    .limit(1);
  if (!fournisseur) return NextResponse.json({ detail: "Fournisseur introuvable" }, { status: 404 });

  // Une adresse est unique dans toute la plateforme : la rechercher dans le seul
  // tenant courant ne suffirait pas, et laisserait créer un second compte pour la
  // même adresse depuis une autre organisation.
  //
  // ⚠️ La fonction `auth_user_by_email()` n'est plus exécutable par le rôle
  //   applicatif (023) : c'est un point d'entrée global, hors contexte de tenant.
  //   La recherche passe donc par la connexion d'administration, qui ne ramène
  //   que les quatre champs nécessaires — jamais le contenu du compte — et sert
  //   uniquement à décider si l'invitation est possible.
  const trouves = await dbAdmin.execute(
    sql`select id::text as id, organization_id::text as "organizationId", supplier_id::text as "supplierId", status
        from gf_users where lower(email) = ${email} limit 1`,
  );
  const existant = ((trouves.rows ?? []) as unknown as CompteExistant[])[0] ?? null;
  // Message identique dans tous les cas : pas d'oracle sur les comptes d'autres organisations.
  const refus = NextResponse.json({ detail: "Cette adresse ne peut pas recevoir d'invitation." }, { status: 409 });

  const jeton = randomBytes(32).toString("base64url");
  const empreinte = hashToken(jeton);
  const expire = new Date(Date.now() + DUREE_INVITATION_MS);

  let compteId: string;
  let statut: "invited" | "reissued";
  if (existant?.id) {
    // Réémission : seulement pour un compte de CETTE fiche, dans CETTE organisation,
    // non encore activé ou révoqué. Un compte actif ne se réinvite pas.
    const reemissible =
      existant.organizationId === organizationId &&
      existant.supplierId === id &&
      (existant.status === "invited" || existant.status === "suspended");
    if (!reemissible) return refus;
    compteId = existant.id;
    statut = "reissued";
    await tx
      .update(users)
      .set({
        status: "invited",
        invitationTokenHash: empreinte,
        invitationExpiresAt: expire,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, compteId), eq(users.organizationId, organizationId)));
  } else {
    const [cree] = await tx
      .insert(users)
      .values({
        organizationId,
        email,
        name: nom,
        role: "supplier",
        status: "invited",
        supplierId: id,
        invitationTokenHash: empreinte,
        invitationExpiresAt: expire,
      })
      .returning({ id: users.id });
    compteId = cree.id;
    statut = "invited";
  }

  // La fiche attend l'activation : elle repasse ACTIVE à l'activation du compte.
  await tx
    .update(suppliers)
    .set({ status: "PENDING_INVITE", updatedAt: new Date() })
    .where(and(eq(suppliers.id, id), eq(suppliers.organizationId, organizationId)));

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "CREATE",
    entityType: "SUPPLIER",
    entityId: id,
    details: {
      evenement: statut === "invited" ? "invitation_emise" : "invitation_reemise",
      compte: compteId,
      expiration: expire.toISOString(),
    },
  });

  return NextResponse.json(
    {
      user_id: compteId,
      supplier_id: id,
      status: "invited",
      expires_at: expire.toISOString(),
      lien_invitation: lienInvitation(request, jeton),
      avertissement:
        "Ce lien n'est affiché qu'une fois. Transmettez-le par un canal de confiance : aucun courriel n'est envoyé par la plateforme.",
    },
    { status: statut === "invited" ? 201 : 200 },
  );
});

export const DELETE = guard<Params>("supplier:write")(async (_request, context, { tx, organizationId, session }) => {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ detail: "Fournisseur introuvable" }, { status: 404 });

  // ⚠️ Le rôle applicatif n'a **pas** le droit de lire `gf_users` (ni de lister
  //   les comptes) : seules l'insertion et la mise à jour lui sont accordées.
  //   La révocation a besoin de retrouver le compte rattaché à la fiche ; cette
  //   recherche passe donc par la connexion d'administration, avec le filtre
  //   d'organisation explicite — la RLS ne peut plus le faire ici.
  const comptes = await dbAdmin
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.supplierId, id), eq(users.organizationId, organizationId), eq(users.role, "supplier")));
  if (comptes.length === 0) {
    return NextResponse.json({ detail: "Aucun accès fournisseur à révoquer" }, { status: 404 });
  }

  for (const compte of comptes) {
    await tx
      .update(users)
      .set({ status: "suspended", invitationTokenHash: null, invitationExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(users.id, compte.id), eq(users.organizationId, organizationId)));
  }
  await tx
    .update(suppliers)
    .set({ status: "SUSPENDED", updatedAt: new Date() })
    .where(and(eq(suppliers.id, id), eq(suppliers.organizationId, organizationId)));

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "DELETE",
    entityType: "SUPPLIER",
    entityId: id,
    details: { evenement: "acces_fournisseur_revoque", comptes: comptes.length },
  });

  return NextResponse.json({ supplier_id: id, status: "suspended", comptes: comptes.length });
});
