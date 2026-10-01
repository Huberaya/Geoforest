/**
 * Vérification du rôle applicatif — P1-10b.
 *
 * ⚠️ Pourquoi un script à part, alors que `scripts/verifier-chaine.ts` existe
 *   déjà.
 *
 * `verifier-chaine.ts` contrôle l'intégrité du journal. Il s'exécute avec le
 * rôle d'**administration** (`DATABASE_URL_ADMIN`) — celui qui migre, qui
 * amorce, qui purge — et qui a donc tous les droits par construction. Ce
 * script-ci fait l'inverse : il se connecte exactement comme le produit, avec
 * `DATABASE_URL`, et vérifie ce que ce rôle **ne peut pas** faire. Passer
 * l'URL d'administration à ce script le fait échouer, et c'est le but : c'est
 * la configuration à ne pas reproduire en production.
 *
 * Il se branche donc naturellement en amont d'une mise en production :
 *
 *     DATABASE_URL=postgresql://… npx tsx scripts/verifier-role.ts
 *
 * Sortie : code 0 si le rôle est conforme, 1 sinon.
 */
import { config } from "dotenv";

/**
 * ⚠️ `.env.local` n'est chargé que si `DATABASE_URL` n'est pas déjà fourni.
 *   Mélanger les deux fausserait la vérification : un contrôle qui porte sur
 *   une URL de production n'a rien à devoir à la configuration du poste. Cas
 *   rencontré le 02/10/2026 — `DATABASE_URL_ADMIN` du développement local
 *   faisait déclarer la séparation des rôles conforme alors qu'elle ne
 *   l'était pas.
 */
if (!process.env.DATABASE_URL) config({ path: ".env.local" });

import { comparerConnexions, decrireRoleApplication, verifierRoleAvec } from "../src/db/controle-role";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "🔴 DATABASE_URL n'est pas défini (.env.local).\n" +
        "   Ce script doit s'exécuter avec l'URL de l'APPLICATION, pas celle d'administration.",
    );
    process.exit(1);
  }

  // ⚠️ `pg` est importé ici, après `config()` : une importation statique est
  //   remontée en tête de fichier et s'exécuterait avant la lecture de
  //   `.env.local`. La même précaution est prise dans `purge-retention.ts`.
  const { Pool } = await import("pg");

  const roleUrl = new URL(url);
  console.log("Vérification du rôle applicatif — GeoForest Trace");
  console.log(`  hôte   : ${roleUrl.hostname}`);
  console.log(`  base   : ${roleUrl.pathname.replace(/^\//, "")}`);
  console.log(`  rôle   : ${decodeURIComponent(roleUrl.username)}`);
  console.log("");

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const etat = await verifierRoleAvec(pool);
    for (const ligne of decrireRoleApplication(etat)) console.log(ligne);

    // Le produit ouvre une seconde connexion, privilégiée, pour
    // l'authentification et le journal d'audit. Elle doit être distincte de la
    // première — sinon les routes métier perdent le cloisonnement.
    const separation = comparerConnexions();
    console.log(`  rôle d'administration     : ${separation.roleAdministration ?? "indéterminé"}`);
    console.log("");

    const problemes = [...etat.messages];
    if (separation.indetermine) {
      problemes.push(
        "l'une des deux URL de base est absente ou illisible : la séparation des rôles n'est pas établie.",
      );
    } else if (!separation.adminDeclare) {
      problemes.push(
        "DATABASE_URL_ADMIN n'est pas déclaré : l'authentification et le journal d'audit " +
          "s'exécuteraient avec le rôle applicatif, lequel n'atteint aucune ligne hors " +
          "contexte d'organisation. Aucune connexion ne serait possible.",
      );
    } else if (separation.memeRole) {
      problemes.push(
        `les deux connexions emploient le même rôle « ${separation.roleApplicatif} » : ` +
          "les routes métier s'exécuteraient avec le rôle d'administration.",
      );
    }

    if (problemes.length === 0) {
      console.log("✅ Rôle conforme : la RLS s'applique aux requêtes du produit.");
      return;
    }

    for (const probleme of problemes) console.log(`  🔴 ${probleme}`);
    console.log("");
    console.log("🔴 Rôle non conforme. Le cloisonnement multi-tenant n'est pas garanti.");
    console.log("   Corriger DATABASE_URL : docs/DEPLOYMENT_VERCEL.md, § « Rôle applicatif ».");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("🔴 Vérification impossible :", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
