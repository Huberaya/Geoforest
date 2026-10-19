/**
 * Amorçage des comptes de démonstration — chantier P0-01.
 *
 * Crée deux organisations distinctes (A et B) et un utilisateur par rôle, afin
 * de pouvoir vérifier l'authentification, les rôles et, au chantier suivant,
 * le cloisonnement entre tenants.
 *
 * Usage : `npm run seed:auth`  (lit .env.local)
 */
import "dotenv/config";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

config({ path: ".env.local" });

import { hashPassword } from "../src/lib/auth/password";
import { organizations, users } from "../src/db/schema";

/**
 * ---------------------------------------------------------------- P3-04
 * ⚠️ Le mot de passe de démonstration n'a **plus de valeur par défaut**.
 *
 * Il était écrit en dur (une constante littérale, volontairement non recopiée ici)
 * puis **affiché sur stdout**
 * à la fin de l'amorçage. Deux conséquences : un mot de passe fonctionnel
 * vivait dans le dépôt, et il finissait dans les journaux de la machine ou de
 * la CI qui lançait le script. Un secret qu'on peut lire dans `git log` n'est
 * pas un secret, et une valeur par défaut fait qu'un lancement accidentel
 * crée des comptes ouverts au lieu d'échouer.
 *
 * Le mot de passe est donc exigé explicitement, avec une longueur minimale.
 */
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "";

const LONGUEUR_MINIMALE = 12;

const ORGS = [
  { slug: "geoforest-agro", name: "GeoForest Agrobusiness SAS (FR)", country: "FR", eori: "FR28475619283" },
  { slug: "demo-tenant-b", name: "Tenant de test B — Import Cacao SARL (BE)", country: "BE", eori: "BE0472839102" },
];

const ACCOUNTS = [
  { email: "admin@geoforest.eu", name: "Camille Ferrand", role: "admin", org: "geoforest-agro" },
  { email: "conformite@geoforest.eu", name: "Nadia Belkacem", role: "compliance_officer", org: "geoforest-agro" },
  { email: "auditeur@geoforest.eu", name: "Yann Le Goff", role: "auditor", org: "geoforest-agro" },
  { email: "lecteur@geoforest.eu", name: "Sophie Meyer", role: "viewer", org: "geoforest-agro" },
  { email: "admin@tenant-b.test", name: "Marc Delaunay", role: "admin", org: "demo-tenant-b" },
];

async function main(): Promise<void> {
  // ⚠️ P3-04 — garde de production. Les comptes créés ici partagent un mot de
  //   passe commun et n'ont pas de MFA : ils n'ont rien à faire sur un
  //   environnement qui sert de vraies données. La variable d'échappement
  //   existe pour un environnement de recette explicitement identifié, jamais
  //   pour la production.
  if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
    throw new Error(
      "seed:auth refuse de s'exécuter avec NODE_ENV=production. " +
        "Ces comptes partagent un mot de passe et n'ont pas de MFA. " +
        "Pour une recette isolée, posez explicitement SEED_ALLOW_PRODUCTION=1.",
    );
  }

  if (DEMO_PASSWORD.length < LONGUEUR_MINIMALE) {
    throw new Error(
      `SEED_DEMO_PASSWORD est requis et doit contenir au moins ${LONGUEUR_MINIMALE} caractères. ` +
        "Aucune valeur par défaut n'est fournie : un compte de démonstration " +
        "avec un mot de passe connu du dépôt est un compte ouvert.",
    );
  }

  if (!process.env.DATABASE_URL_ADMIN) {
    throw new Error("DATABASE_URL_ADMIN n'est pas défini (charger .env.local).");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL,
  });
  const db = drizzle(pool);

  const orgIds = new Map<string, string>();

  for (const org of ORGS) {
    const existing = await db.select().from(organizations).where(eq(organizations.slug, org.slug)).limit(1);
    if (existing[0]) {
      orgIds.set(org.slug, existing[0].id);
      console.log(`organisation existante : ${org.name}`);
      continue;
    }
    const inserted = await db
      .insert(organizations)
      .values({ name: org.name, slug: org.slug, country: org.country, eori: org.eori })
      .returning({ id: organizations.id });
    orgIds.set(org.slug, inserted[0].id);
    console.log(`organisation créée     : ${org.name}`);
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const account of ACCOUNTS) {
    const organizationId = orgIds.get(account.org)!;
    const existing = await db.select().from(users).where(eq(users.email, account.email)).limit(1);

    if (existing[0]) {
      await db
        .update(users)
        .set({
          passwordHash,
          passwordUpdatedAt: new Date(),
          role: account.role,
          name: account.name,
          organizationId,
          status: "active",
          // Réinitialise la MFA pour rejouer le parcours d'enregistrement.
          mfaSecret: null,
          mfaEnabledAt: null,
          mfaRecoveryCodes: null,
          failedLogins: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing[0].id));
      console.log(`compte réinitialisé    : ${account.email} (${account.role})`);
      continue;
    }

    await db.insert(users).values({
      email: account.email,
      name: account.name,
      role: account.role,
      organizationId,
      passwordHash,
      passwordUpdatedAt: new Date(),
      status: "active",
    });
    console.log(`compte créé            : ${account.email} (${account.role})`);
  }

  console.log("\n--- Comptes de démonstration ---");
  for (const account of ACCOUNTS) {
    console.log(`  ${account.email.padEnd(28)} ${account.role.padEnd(18)} ${account.org}`);
  }
  // ⚠️ P3-04 — le mot de passe n'est plus affiché. Il a été fourni par
  //   l'appelant ; le répéter sur stdout le recopiait dans les journaux.
  console.log(
    `\nMot de passe : celui fourni dans SEED_DEMO_PASSWORD (${DEMO_PASSWORD.length} caractères), non affiché.`,
  );
  console.log("⚠️ Comptes de démonstration — à supprimer avant toute mise en production.");
  console.log("   Rotation : voir docs/ROTATION_SECRETS_ET_INTEGRITE_AUDIT.md");

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
