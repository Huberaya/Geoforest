/**
 * Amorçage des comptes de démonstration — chantier P0-01, durci en P0 (recette 2026-10-08).
 *
 * Crée deux organisations distinctes (A et B) et un utilisateur par rôle, afin
 * de pouvoir vérifier l'authentification, les rôles et le cloisonnement entre tenants.
 *
 * ⚠️ Règles, toutes bloquantes :
 *   1. `SEED_DEMO_PASSWORD` est OBLIGATOIRE. Il n'existe aucune valeur de repli :
 *      le mot de passe qui figurait ici auparavant est public (dépôt public).
 *   2. Le mot de passe doit faire au moins 12 caractères et ne pas figurer dans
 *      la liste des valeurs compromises ci-dessous.
 *   3. Refus en production (`NODE_ENV=production`) : des comptes de démonstration
 *      n'ont rien à faire dans un environnement client.
 *   4. Un compte existant n'est JAMAIS réinitialisé sans `--reset` explicite.
 *      Sans ce drapeau, rejouer le script ne modifie ni le mot de passe, ni le rôle,
 *      ni la MFA d'un compte.
 *
 * Usage : `SEED_DEMO_PASSWORD=… npm run seed:auth [-- --reset]`  (lit .env.local)
 */
import "dotenv/config";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

config({ path: ".env.local" });

import { hashPassword } from "../src/lib/auth/password";
import { organizations, users } from "../src/db/schema";

/** Mots de passe connus publiquement : jamais acceptés, quel que soit l'environnement. */
const VALEURS_COMPROMISES = new Set(["Trace!Demo2026x"]);
const RESET = process.argv.includes("--reset");

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

function verifierPrerequis(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refus : des comptes de démonstration ne sont jamais créés en production (NODE_ENV=production).",
    );
  }
  if (!process.env.DATABASE_URL_ADMIN && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL_ADMIN n'est pas défini (charger .env.local).");
  }
  const motDePasse = process.env.SEED_DEMO_PASSWORD ?? "";
  if (!motDePasse) {
    throw new Error(
      "SEED_DEMO_PASSWORD est absent. Aucun mot de passe n'est inventé : renseignez-le puis relancez.",
    );
  }
  if (motDePasse.length < 12) {
    throw new Error("SEED_DEMO_PASSWORD doit faire au moins 12 caractères.");
  }
  if (VALEURS_COMPROMISES.has(motDePasse)) {
    throw new Error("SEED_DEMO_PASSWORD figure dans la liste des mots de passe publiquement connus : refusé.");
  }
  return motDePasse;
}

async function main(): Promise<void> {
  const DEMO_PASSWORD = verifierPrerequis();

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

    if (existing[0] && !RESET) {
      console.log(`compte existant, inchangé : ${account.email} (relancer avec --reset pour le réinitialiser)`);
      continue;
    }
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
  console.log("\nMot de passe commun : transmis par SEED_DEMO_PASSWORD (non affiché).");
  console.log("⚠️ Comptes de démonstration — à supprimer avant toute mise en production.");

  await pool.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? `🔴 ${error.message}` : error);
  process.exit(1);
});
