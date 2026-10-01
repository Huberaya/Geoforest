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

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Trace!Demo2026x";

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
  if (!process.env.DATABASE_URL_ADMIN) {
    throw new Error("DATABASE_URL n'est pas défini (charger .env.local).");
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
  console.log(`\nMot de passe commun : ${DEMO_PASSWORD}`);
  console.log("⚠️ Comptes de démonstration — à supprimer avant toute mise en production.");

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
