import { lireCorpsJson } from "@/lib/api/body";
import { organizations, plots, suppliers, users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { logAction } from "@/lib/api/audit-log";

export const dynamic = "force-dynamic";

/**
 * Paramètres de l'organisation.
 *
 * ⚠️ Aucun réglage n'est affiché comme actif s'il n'est pas effectif. La
 * configuration EUDR présentée ici est **constatée**, pas déclarée par
 * l'utilisateur : c'est l'état réel du serveur qui est lu.
 */

const EORI_PATTERN = /^[A-Z]{2}[0-9A-Z]{8,15}$/;

export const GET = guard("settings:manage")(async (_request: Request, _ctx, { tx, organizationId, session }): Promise<Response> => {
  const [org] = await tx
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) return NextResponse.json({ detail: "Organisation introuvable" }, { status: 404 });

  const [counts] = await tx
    .select({
      users: sql<number>`(select count(*) from ${users} where ${users.organizationId} = ${organizationId})`,
      suppliers: sql<number>`(select count(*) from ${suppliers} where ${suppliers.organizationId} = ${organizationId})`,
      plots: sql<number>`(select count(*) from ${plots} where ${plots.organizationId} = ${organizationId})`,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId));

  return NextResponse.json({
    organization: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      eori: org.eori ?? null,
      createdAt: org.createdAt.toISOString(),
    },
    usage: {
      users: Number(counts?.users ?? 0),
      suppliers: Number(counts?.suppliers ?? 0),
      plots: Number(counts?.plots ?? 0),
    },
    /**
     * État **constaté** de la configuration réglementaire, lu côté serveur.
     * Rien ici n'est activable depuis l'interface : ce sont des variables
     * d'environnement, et les afficher comme des interrupteurs serait mentir.
     */
    eudr_configuration: {
      satellite_analysis: {
        configured: Boolean(process.env.GFW_API_KEY),
        provider: "Global Forest Watch (Hansen/UMD)",
        dataset: "umd_tree_cover_loss",
        status: process.env.GFW_API_KEY ? "configured" : "non_configuré",
        consequence: process.env.GFW_API_KEY
          ? "Les analyses peuvent être probantes, sous réserve que l'appel aboutisse."
          : "Aucune analyse produite par ce serveur n'est probante (P0-04).",
      },
      demo_mode: {
        enabled: process.env.GFW_DEMO_MODE === "true",
        consequence:
          process.env.GFW_DEMO_MODE === "true"
            ? "⚠️ Mode démonstration actif : les analyses sont simulées et non probantes. À désactiver en production."
            : null,
      },
      eudr_is_transmission: {
        available: false,
        consequence:
          "Aucun dépôt de déclaration n'est possible depuis ce produit (P0-06). " +
          "Le statut « déclaré » ne peut pas être établi.",
      },
      document_storage: {
        available: false,
        consequence: "Les documents sont enregistrés en métadonnées ; aucun fichier n'est conservé (P1-02).",
      },
    },
    viewer: { email: session.user.email, role: session.user.role },
  });
});

export const PATCH = guard("settings:manage")(async (request: Request, _ctx, { tx, organizationId, session }): Promise<Response> => {
  // P1-07 — lecture bornée : taille, profondeur et longueur des champs.
  const lecture = await lireCorpsJson(request);
  if (!lecture.ok) return lecture.response;
  const body = lecture.value as Record<string, unknown>;

  const patch: { name?: string; eori?: string | null } = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 2) return NextResponse.json({ detail: "Raison sociale trop courte" }, { status: 422 });
    patch.name = name;
  }
  if (body.eori !== undefined) {
    const eori = typeof body.eori === "string" ? body.eori.replace(/\s+/g, "").toUpperCase() : "";
    if (eori && !EORI_PATTERN.test(eori)) {
      return NextResponse.json({ detail: "EORI invalide (2 lettres de pays puis 8 à 15 caractères)" }, { status: 422 });
    }
    patch.eori = eori || null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ detail: "Aucune modification transmise" }, { status: 422 });
  }

  // ------------------------------------------------------------------ P1-10
  // L'état complet d'avant est lu avant l'écriture : une modification
  // consignée sous la forme « champ modifié » ne permet pas de répondre
  // « de quelle valeur à quelle valeur ? », qui est la seule question utile.
  const [avant] = await tx
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const [row] = await tx
    .update(organizations)
    .set(patch)
    .where(eq(organizations.id, organizationId))
    .returning();
  if (!row) return NextResponse.json({ detail: "Organisation introuvable" }, { status: 404 });

  await logAction(tx, organizationId, {
    userEmail: session.user.email,
    acteurId: session.user.id,
    acteurRole: session.user.role,
    action: "UPDATE",
    entityType: "SETTINGS",
    entityId: organizationId,
    avant: avant as unknown as Record<string, unknown> | null,
    apres: row as unknown as Record<string, unknown>,
    details: { fields: Object.keys(patch) },
  });

  return NextResponse.json({ id: row.id, name: row.name, eori: row.eori ?? null });
});
