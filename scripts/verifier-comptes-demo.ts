/**
 * Inventaire des comptes de démonstration — **lecture seule**.
 *
 * ⚠️ Pourquoi ce script existe.
 *
 *   `scripts/seed-auth.ts` a créé, jusqu'au 19/10/2026, cinq comptes dont un
 *   administrateur avec un mot de passe **publié dans le dépôt**. Le script
 *   refuse désormais de s'exécuter sans mot de passe fourni, mais cela ne
 *   corrige pas les bases où l'ancien jeu de données a déjà été appliqué : les
 *   comptes y existent, avec le mot de passe public.
 *
 *   Ce script **constate** et ne corrige rien : il ne modifie aucun compte, ne
 *   lit aucun mot de passe (c'est impossible : les condensats sont salés) et
 *   n'affiche aucun secret. Il répond à la seule question qui compte avant une
 *   rotation : « ces comptes existent-ils encore, sont-ils actifs, et leur mot
 *   de passe a-t-il été changé depuis la publication ? »
 *
 * Usage :
 *   npx tsx scripts/verifier-comptes-demo.ts
 *   npx tsx scripts/verifier-comptes-demo.ts --apres=2026-10-19
 *   npx tsx scripts/verifier-comptes-demo.ts --json
 *
 *   `--apres=AAAA-MM-JJ` : signale les comptes **actifs** dont le mot de passe
 *   n'a pas été changé depuis cette date. C'est le mode à utiliser en
 *   vérification post-rotation : il doit alors sortir en code 1 tant qu'un
 *   compte reste à traiter.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { Pool } from "pg";

/** Comptes créés par l'ancien jeu de démonstration (cf. `scripts/seed-auth.ts`). */
export const COMPTES_DEMO = [
  "admin@geoforest.eu",
  "conformite@geoforest.eu",
  "auditeur@geoforest.eu",
  "lecteur@geoforest.eu",
  "admin@tenant-b.test",
] as const;

export interface EtatCompte {
  email: string;
  organisation: string | null;
  role: string;
  statut: string;
  /** Date du dernier changement de mot de passe ; `null` = jamais changé. */
  motDePasseChangeLe: string | null;
  mfa: boolean;
}

/**
 * Décide si un compte doit être signalé. Séparé de la requête pour être testé
 * sans base : la règle est simple, mais c'est elle qui décide d'une alerte.
 */
export function doitEtreSignale(compte: EtatCompte, apres: Date | null): boolean {
  if (!apres) return false;
  if (compte.statut !== "active") return false;
  if (!compte.motDePasseChangeLe) return true;
  return new Date(compte.motDePasseChangeLe) < apres;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("🔴 DATABASE_URL_ADMIN (ou DATABASE_URL) n'est pas défini.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const apresArg = args.find((a) => a.startsWith("--apres="))?.split("=")[1];
  let apres: Date | null = null;
  if (apresArg) {
    apres = new Date(`${apresArg}T00:00:00Z`);
    if (Number.isNaN(apres.getTime())) {
      console.error("🔴 --apres attend une date AAAA-MM-JJ.");
      process.exit(1);
    }
  }

  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const { rows } = await pool.query<{
      email: string;
      organisation: string | null;
      role: string;
      status: string;
      password_updated_at: Date | null;
      mfa_enabled_at: Date | null;
    }>(
      `select u.email,
              o.name as organisation,
              u.role,
              u.status,
              u.password_updated_at,
              u.mfa_enabled_at
         from gf_users u
         left join gf_organizations o on o.id = u.organization_id
        where u.email = any($1::text[])
        order by u.email`,
      [COMPTES_DEMO],
    );

    const comptes: EtatCompte[] = rows.map((l) => ({
      email: l.email,
      organisation: l.organisation,
      role: l.role,
      statut: l.status,
      motDePasseChangeLe: l.password_updated_at ? l.password_updated_at.toISOString() : null,
      mfa: l.mfa_enabled_at !== null,
    }));

    const signales = comptes.filter((c) => doitEtreSignale(c, apres));

    if (json) {
      console.log(JSON.stringify({ comptes, signales: signales.map((c) => c.email) }, null, 2));
    } else {
      console.log("Comptes de démonstration connus du dépôt");
      console.log("");
      if (comptes.length === 0) {
        console.log("  · aucun de ces comptes n'existe dans cette base");
      }
      for (const c of comptes) {
        const change = c.motDePasseChangeLe
          ? c.motDePasseChangeLe.slice(0, 10)
          : "jamais";
        console.log(
          `  · ${c.email.padEnd(26)} ${c.statut.padEnd(10)} ${String(c.role).padEnd(20)}` +
            ` mot de passe changé : ${change}${c.mfa ? " · MFA" : ""}`,
        );
      }
      console.log("");
      if (!apres) {
        console.log(
          "  (lecture seule — aucune modification. Utiliser --apres=AAAA-MM-JJ pour " +
            "signaler les comptes dont le mot de passe n'a pas été changé depuis.)",
        );
      } else if (signales.length === 0) {
        console.log(`✅ Aucun compte actif au mot de passe antérieur au ${apresArg}.`);
      } else {
        console.log(
          `🔴 ${signales.length} compte(s) actif(s) au mot de passe antérieur au ${apresArg} :`,
        );
        for (const c of signales) console.log(`   · ${c.email}`);
        console.log("");
        console.log("   Rotation : voir docs/EXPLOITATION-secrets-et-audit.md, § R3.");
        console.log("   Ne pas réutiliser l'ancien mot de passe ; ne pas l'afficher.");
      }
    }

    if (signales.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// Exécution directe uniquement : le module est aussi importé par les tests.
if (process.argv[1] && process.argv[1].endsWith("verifier-comptes-demo.ts")) {
  main().catch((erreur) => {
    console.error("🔴", erreur instanceof Error ? erreur.message : erreur);
    process.exit(1);
  });
}
