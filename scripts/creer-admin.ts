/**
 * Création sécurisée d'un compte administrateur initial (production ou recette).
 *
 * Contrairement à `scripts/seed-auth.ts` (strictement réservé aux bases de test
 * et comptes de démonstration), ce script crée UNE seule organisation et UN seul
 * compte `admin` réel, sans mot de passe par défaut et sans jamais réinitialiser
 * un compte existant.
 *
 * À la première connexion sur `/login`, la double authentification TOTP (MFA)
 * est exigée automatiquement pour le rôle `admin`.
 *
 * Usage (variables d'environnement uniquement — jamais le mot de passe en CLI) :
 *   DATABASE_URL_ADMIN="postgresql://neondb_owner:...@.../neondb?sslmode=require" \
 *   ADMIN_ORG_NAME="Votre Organisation" \
 *   ADMIN_ORG_SLUG="votre-organisation" \
 *   ADMIN_ORG_COUNTRY="FR" \
 *   ADMIN_NAME="Prénom Nom" \
 *   ADMIN_EMAIL="admin@votre-domaine.fr" \
 *   ADMIN_PASSWORD="<mot de passe fort >= 12 car.>" \
 *   npm run db:creer-admin
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { organizations, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { validerCreationAdmin } from "./creer-admin-gardes";

async function main(): Promise<void> {
  const decision = validerCreationAdmin({
    DATABASE_URL_ADMIN: process.env.DATABASE_URL_ADMIN,
    ADMIN_ORG_NAME: process.env.ADMIN_ORG_NAME,
    ADMIN_ORG_SLUG: process.env.ADMIN_ORG_SLUG,
    ADMIN_ORG_COUNTRY: process.env.ADMIN_ORG_COUNTRY,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_NAME: process.env.ADMIN_NAME,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  });
  if (!decision.autorise) {
    console.error("🔴 Création administrateur refusée :");
    for (const raison of decision.refus) {
      console.error(`   · ${raison}`);
    }
    process.exit(1);
  }

  const { databaseUrlAdmin, orgName, orgSlug, orgCountry, email, name, password } =
    decision.parametres;

  const pool = new Pool({ connectionString: databaseUrlAdmin, max: 2 });
  const db = drizzle(pool);

  try {
    // 1. Refuser d'écraser ou réinitialiser un compte existant.
    const existants = await db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existants.length > 0) {
      console.error(
        `🔴 Un compte existe déjà pour « ${email} » (statut=${existants[0].status}, rôle=${existants[0].role}). ` +
          `Ce script ne réinitialise jamais un compte existant.`,
      );
      process.exit(1);
    }

    // 2. Organisation : créer si absente, sinon réutiliser par slug.
    const orgs = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.slug, orgSlug))
      .limit(1);

    let organizationId: string;
    if (orgs.length > 0) {
      organizationId = orgs[0].id;
      console.log(`ℹ️ Organisation existante réutilisée : ${orgs[0].name} (${orgSlug})`);
    } else {
      const [created] = await db
        .insert(organizations)
        .values({
          name: orgName,
          slug: orgSlug,
          country: orgCountry,
        })
        .returning({ id: organizations.id });
      organizationId = created.id;
      console.log(`✅ Organisation créée : ${orgName} (${orgSlug}, ${orgCountry})`);
    }

    // 3. Hachage scrypt OWASP et insertion du compte admin (MFA à enrôler au 1er login).
    const passwordHash = await hashPassword(password);
    await db.insert(users).values({
      organizationId,
      email,
      name,
      role: "admin",
      status: "active",
      passwordHash,
      passwordUpdatedAt: new Date(),
      tokenVersion: 0,
      failedLogins: 0,
      lockedUntil: null,
      mfaSecret: null,
      mfaEnabledAt: null,
      mfaRecoveryCodes: null,
    });

    console.log(
      `✅ Compte administrateur créé pour « ${email} ».\n` +
        `   → Connectez-vous sur /login : l'enrôlement TOTP (MFA) sera demandé dès la première connexion.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("🔴 Échec création administrateur :", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
