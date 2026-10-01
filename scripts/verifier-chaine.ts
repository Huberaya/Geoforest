/**
 * Vérification de la chaîne d'audit — P1-10.
 *
 * ⚠️ Ce que ce contrôle apporte, et ce qu'il ne peut pas apporter.
 *
 * Un journal scellé par condensats ne protège de rien s'il n'est jamais
 * relu. Ce script est la relue : il parcourt chaque organisation, recalcule
 * les condensats et signale toute rupture.
 *
 * Il produit, pour chaque organisation, le **dernier numéro et son
 * condensat** — c'est-à-dire l'ancre. C'est la seule défense contre la
 * limite que le chaînage ne couvre pas : la suppression de la dernière ligne
 * d'une organisation ne rompt aucune chaîne, puisqu'aucune ligne ne pointe
 * vers elle. Conserver l'ancre **ailleurs** — copie signée, registre
 * indépendant, journal d'un autre système — rend cette suppression
 * décelable. Le script affiche donc l'ancre pour qu'elle soit exportée ; il
 * ne l'exporte pas lui-même : ⚪ non implémenté.
 *
 * ⚠️ Aucune réparation n'est proposée, et c'est volontaire. Un outil de
 *   « réparation » de chaîne est un outil d'effacement de preuve : il rend
 *   indétectable l'altération qu'il efface. La seule conduite à tenir face à
 *   une rupture est de la **conserver** et de la signaler.
 *
 * Usage :
 *   npx tsx scripts/verifier-chaine.ts [--org=<uuid>] [--json]
 */
import { config } from "dotenv";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// ⚠️ `config()` est appelé avant la construction du pool ci-dessous : les
//   importations statiques sont remontées en tête de fichier, si bien qu'un
//   `import { pool }` depuis `src/db/admin.ts` lirait une variable
//   d'environnement encore vide. Le pool est donc construit ici.
config({ path: ".env.local" });

const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
if (!url) {
  console.error("🔴 DATABASE_URL_ADMIN ou DATABASE_URL n'est pas défini (.env.local).");
  process.exit(1);
}
const pool = new Pool({ connectionString: url, max: 4 });
const db = drizzle(pool);

interface Organisation {
  id: string;
  name: string;
}

interface Anomalie {
  sequence: string;
  anomalie: string;
  attendu: string;
  trouve: string;
}

async function organisations(cible: string | null): Promise<Organisation[]> {
  const { rows } = cible
    ? await db.execute(sql`select id, name from gf_organizations where id = ${cible}`)
    : await db.execute(sql`select id, name from gf_organizations order by name`);
  return (rows ?? []) as unknown as Organisation[];
}

async function verifier(org: string): Promise<Anomalie[]> {
  const { rows } = await db.execute(
    sql`select sequence::text, anomalie, attendu, trouve
          from verifier_chaine_audit(${org}) order by sequence limit 50`,
  );
  return (rows ?? []) as unknown as Anomalie[];
}

async function ancre(org: string): Promise<{ rang: string; hash: string; le: string } | null> {
  const { rows } = await db.execute(
    // ⚠️ `order by sequence desc` trierait sur la **colonne de sortie**
    //   `sequence::text`, donc par ordre lexicographique : le rang 9 passerait
    //   avant le rang 14. La colonne est donc aliasée, et le tri qualifié par
    //   le nom de la table.
    sql`select sequence::text as rang, coalesce(hash, ${"(non_scellée)"}) as hash,
                created_at::text as le
          from gf_audit_logs
         where organization_id = ${org}
         order by gf_audit_logs.sequence desc limit 1`,
  );
  const r = (rows ?? []) as unknown as Array<{ rang: string; hash: string; le: string }>;
  return r[0] ?? null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cible = argv.find((a) => a.startsWith("--org="))?.split("=")[1] ?? null;
  const json = argv.includes("--json");

  const orgs = await organisations(cible);
  if (orgs.length === 0) {
    console.log("Aucune organisation.");
    return;
  }

  let totalAnomalies = 0;
  const rapport: unknown[] = [];

  for (const org of orgs) {
    const anomalies = await verifier(org.id);
    const a = await ancre(org.id);
    totalAnomalies += anomalies.length;

    if (json) {
      rapport.push({ organisation: org.name, id: org.id, anomalies, ancre: a });
      continue;
    }
    const entete = `${anomalies.length === 0 ? "✅" : "🔴"} ${org.name}`;
    console.log(entete);
    for (const x of anomalies) {
      console.log(`     rang ${x.sequence} · ${x.anomalie}`);
      console.log(`       attendu : ${x.attendu}`);
      console.log(`       trouvé  : ${x.trouve}`);
    }
    console.log(
      a
        ? `     ancre : rang ${a.rang} · ${a.hash.slice(0, 24)}… · ${a.le}`
        : "     ancre : aucune écriture",
    );
  }

  if (json) {
    console.log(JSON.stringify(rapport, null, 2));
  } else {
    console.log("");
    console.log(
      totalAnomalies === 0
        ? "✅ Chaîne intacte pour toutes les organisations."
        : `🔴 ${totalAnomalies} anomalie(s). Ne pas « réparer » : conserver et signaler.`,
    );
    console.log(
      "   L'ancre ci-dessus doit être conservée hors de la base : c'est la seule",
      "trace qui permette de déceler la suppression de la dernière écriture.",
    );
  }
  if (totalAnomalies > 0) process.exitCode = 1;
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (err: unknown) => {
    console.error("🔴 Vérification échouée :", err instanceof Error ? err.message : String(err));
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
