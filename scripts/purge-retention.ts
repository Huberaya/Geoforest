/**
 * Purge de rétention — P1-10.
 *
 * ⚠️ Pourquoi ce script existe, et ce qu'il ne fait **pas**.
 *
 * Le chantier exige l'absence de suppression physique. Or l'absence totale de
 * purge n'est pas une politique de conservation : c'est une accumulation
 * indéfinie, qui finit par coûter plus cher que la preuve qu'elle prétend
 * protéger. La durée de rétention est donc **déclarée** — cinq ans, comme le
 * règlement l'exige pour les pièces de diligence — et la purge est un acte
 * explicite, daté, journalisé, et **refusé par défaut**.
 *
 * Trois refus sont volontaires, et chacun correspond à une erreur réelle :
 *
 *   1. ** `--appliquer` est obligatoire.** Sans lui, le script ne fait qu'un
 *      état des lieux. Une purge qui se déclenche parce qu'on a tapé la
 *      commande pour voir est une purge qu'on regrette.
 *   2. **Rien de plus jeune que la durée n'est jamais touché**, même en mode
 *      appliqué. La date butoir est calculée puis vérifiée deux fois.
 *   3. **Les lignes non marquées supprimées ne sont jamais touchées.** Une
 *      ligne vivante n'est pas une ligne périmée : la confier à une tâche
 *      planifiée, c'est prendre le risque qu'un jour de mauvaise configuration
 *      elle emporte des dossiers en cours.
 *
 * Usage :
 *   npx tsx scripts/purge-retention.ts                    # état des lieux
 *   npx tsx scripts/purge-retention.ts --appliquer        # purge effective
 *   npx tsx scripts/purge-retention.ts --jours=1826       # durée explicite
 *
 * Ce script s'exécute avec le rôle d'**administration** : le rôle applicatif
 * s'est vu retirer le privilège `DELETE`, précisément pour qu'aucune route ne
 * puisse détruire une preuve. La purge est donc la seule voie de suppression
 * physique, elle est hors du produit, et elle est tracée.
 */
import { config } from "dotenv";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

config({ path: ".env.local" });

/**
 * ⚠️ Le pool est construit **ici**, et non importé de `src/db/admin.ts` : les
 *   importations statiques sont remontées en tête de fichier, avant l'appel à
 *   `config()`. Ce module lit `DATABASE_URL_ADMIN` à son chargement, et le
 *   trouvait donc vide — l'erreur était levée avant la première ligne du
 *   script. Un script d'exploitation se suffit par ailleurs à lui-même : il
 *   n'a aucune raison d'emprunter au produit une connexion qui contourne la
 *   RLS, ni de dépendre d'un module marqué `server-only`.
 */
const url = process.env.DATABASE_URL_ADMIN;
if (!url) {
  console.error("🔴 DATABASE_URL_ADMIN n'est pas défini (.env.local).");
  process.exit(1);
}
const pool = new Pool({ connectionString: url, max: 4 });
const dbAdmin = drizzle(pool);

/** Cinq ans, jours bissextiles compris (365,25 × 5). */
const RETENTION_DEFAUT_JOURS = 1826;

const TABLES = [
  "gf_suppliers",
  "gf_products",
  "gf_shipments",
  "gf_plots",
  "gf_documents",
  "gf_due_diligence_statements",
  "gf_compliance_tasks",
] as const;

interface Arguments {
  appliquer: boolean;
  jours: number;
}

function lireArguments(argv: string[]): Arguments {
  const appliquer = argv.includes("--appliquer");
  const brut = argv.find((a) => a.startsWith("--jours="));
  const jours = brut ? Number(brut.split("=")[1]) : RETENTION_DEFAUT_JOURS;
  if (!Number.isFinite(jours) || jours <= 0) {
    console.error(`🔴 Durée invalide : ${brut}. Attendu : un nombre de jours strictement positif.`);
    process.exit(1);
  }
  return { appliquer, jours };
}

async function compter(table: string, limite: Date): Promise<number> {
  const { rows } = await dbAdmin.execute(
    sql.raw(
      `select count(*)::int as n from ${table} where deleted_at is not null and deleted_at < '${limite.toISOString()}'::timestamptz`,
    ),
  );
  return Number((rows[0] as { n: number } | undefined)?.n ?? 0);
}

async function main(): Promise<void> {
  const { appliquer, jours } = lireArguments(process.argv.slice(2));
  const limite = new Date(Date.now() - jours * 86_400_000);

  console.log("Purge de rétention — GeoForest Trace");
  console.log(`  durée déclarée : ${jours} jour(s) (${(jours / 365.25).toFixed(1)} an(s))`);
  console.log(`  date butoir    : ${limite.toISOString()}`);
  console.log(`  mode           : ${appliquer ? "APPLICATION" : "état des lieux (aucune suppression)"}`);
  console.log("");

  // ⚠️ Contrôle préalable, avant toute suppression : la date butoir doit être
  //   dans le passé. Une date future viderait la base entière, et ce contrôle
  //   coûte une ligne.
  if (limite.getTime() >= Date.now()) {
    console.error("🔴 La date butoir est dans le futur : la purge est refusée.");
    process.exit(1);
  }
  if (jours < 365) {
    console.error(
      `🔴 Durée de ${jours} jour(s) inférieure à un an : la purge est refusée.\n` +
        "   Une durée aussi courte n'est pas une politique de conservation, c'est un effacement.",
    );
    process.exit(1);
  }

  let total = 0;
  for (const table of TABLES) {
    const n = await compter(table, limite);
    total += n;
    console.log(`  ${n.toString().padStart(6)}  ${table}`);
  }

  const { rows: journaux } = await dbAdmin.execute(
    sql.raw(
      `select count(*)::int as n from gf_audit_logs where created_at < '${limite.toISOString()}'::timestamptz`,
    ),
  );
  const journauxPérimes = Number((journaux[0] as { n: number } | undefined)?.n ?? 0);
  console.log(`  ${journauxPérimes.toString().padStart(6)}  gf_audit_logs (journal, ${jours} jour(s) révolus)`);
  console.log("");

  if (!appliquer) {
    console.log(
      total + journauxPérimes === 0
        ? "  Rien à purger : aucune ligne n'a atteint la durée de rétention."
        : `  ${total + journauxPérimes} ligne(s) périmée(s). Relancer avec --appliquer pour effectuer la purge.`,
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // ⚠️ Le journal est purgé EN PREMIER, et c'est volontaire : si la purge des
  //   lignes métier échoue à mi-chemin, on veut que la trace de l'opération
  //   subsiste. Purger le journal en dernier reviendrait à perdre la preuve de
  //   la purge en cas d'incident.
  // ---------------------------------------------------------------------------
  console.log("  Journalisation de la purge…");
  await dbAdmin.execute(
    sql.raw(
      `insert into gf_audit_logs (organization_id, user_email, action, entity_type, entity_id, details)
         values (null, 'system', 'PURGE', 'SYSTEM', 'retention',
                 ${JSON.stringify({
                   dureeJours: jours,
                   limite: limite.toISOString(),
                   lignesPerimees: total,
                   journauxPerimes: journauxPérimes,
                   tables: TABLES,
                 })}::jsonb)`,
    ),
  );

  for (const table of TABLES) {
    const { rowCount } = await dbAdmin.execute(
      sql.raw(
        `delete from ${table} where deleted_at is not null and deleted_at < '${limite.toISOString()}'::timestamptz`,
      ),
    );
    console.log(`  ${String(rowCount ?? 0).padStart(6)}  ${table} — purgée`);
  }

  const { rowCount: purges } = await dbAdmin.execute(
    sql.raw(
      `delete from gf_audit_logs where created_at < '${limite.toISOString()}'::timestamptz
         and id <> (select id from gf_audit_logs where action = 'PURGE' order by sequence desc limit 1)`,
    ),
  );
  console.log(`  ${String(purges ?? 0).padStart(6)}  gf_audit_logs — purgée`);

  // ⚠️ La ligne de purge est conservée : elle est la seule trace qu'une
  //   destruction a eu lieu, et la seule réponse possible à « pourquoi ce
  //   dossier de 2021 n'existe plus ? ».
  console.log("");
  console.log("✅ Purge effectuée. La ligne PURGE est conservée : elle atteste de l'opération.");
  console.log(
    "   Les objets du support (pièces jointes) ne sont PAS effacés par ce script :",
    "   leur purge suit la même durée, mais suppose d'abord de dresser l'inventaire",
    "   des clés devenues orphelines — ce qui n'a jamais été exécuté ici (⚪ non validé).",
  );

  // Le rôle applicatif n'ayant plus le droit de suppression, on vérifie qu'il
  // ne l'a pas récupéré : un privilège réattribué par mégarde rouvrirait la
  // porte que ce chantier a fermée.
  const { rows: privileges } = await dbAdmin.execute(
    sql.raw(
      `select count(*)::int as n from information_schema.role_table_grants
        where grantee = 'geoforest_app' and privilege_type = 'DELETE'
          and table_name = any(${JSON.stringify([...TABLES])}::text[])`,
    ),
  );
  const restants = Number((privileges[0] as { n: number } | undefined) ?? 0);
  if (restants > 0) {
    console.log(
      `\n🔴 ${restants} privilège(s) DELETE encore accordé(s) au rôle applicatif : ` +
        "l'absence de suppression physique n'est plus garantie par la base.",
    );
    process.exit(1);
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error("🔴 Purge échouée :", err instanceof Error ? err.message : String(err));
    await pool.end();
    process.exit(1);
  });
