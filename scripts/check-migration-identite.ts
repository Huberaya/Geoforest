/**
 * Non-régression P3-02 — la migration 0007 et son retour arrière.
 *
 * Exécution :
 *     node --conditions=react-server --import tsx scripts/check-migration-identite.ts
 *
 * ⚠️ Ce banc exécute le **SQL réel** de `drizzle/0007_*` sur une base
 *   PostgreSQL embarquée (PGlite). Il ne remplace pas une validation sur un
 *   serveur PostgreSQL — rôles, RLS et privilèges ne sont pas exercés ici — mais
 *   il prouve ce qu'aucun test Python ne prouvait : que l'aller et le retour
 *   s'exécutent, que les lignes survivent, et que le retour arrière **refuse**
 *   d'inventer une identité.
 *
 * ⚠️ Aucune donnée réelle n'est touchée : la base est créée en mémoire et
 *   détruite à la fin.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

const racine = process.cwd();
let echecs = 0;
let total = 0;

function verifier(intitule: string, condition: boolean, detail = ""): void {
  total += 1;
  if (condition) {
    console.log(`  ✅ ${intitule}${detail ? ` — ${detail}` : ""}`);
  } else {
    echecs += 1;
    console.error(`  🔴 ${intitule}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Découpe un fichier drizzle sur son marqueur de statement. */
function instructions(fichier: string): string[] {
  return readFileSync(join(racine, fichier), "utf8")
    .split("--> statement-breakpoint")
    .map((bloc) => bloc.trim())
    .filter((bloc) => bloc.length > 0);
}

/**
 * Schéma d'avant 0007, réduit à ce que la migration touche, plus une colonne
 * témoin : si la migration perdait des lignes, `marqueur` le dirait.
 */
const SCHEMA_AVANT = `
  CREATE TABLE parcel_audits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    marqueur text NOT NULL,
    operator_name text NOT NULL,
    operator_eori text NOT NULL,
    operator_country text NOT NULL DEFAULT 'FR',
    operator_address text
  );
`;

async function appliquer(db: PGlite, fichier: string): Promise<void> {
  for (const instruction of instructions(fichier)) {
    await db.exec(instruction);
  }
}

async function principal(): Promise<void> {
  const db = new PGlite();

  console.log("\n\x1b[1mA. Migration 0007 — aller\x1b[0m");
  await db.exec(SCHEMA_AVANT);

  // Trois dossiers : identité réelle, valeur de remplissage héritée, absence
  // déjà encodée en NULL (état impossible avant 0007, possible après).
  await db.exec(`
    INSERT INTO parcel_audits (marqueur, operator_name, operator_eori, operator_country) VALUES
      ('reel',    'Coopérative Ivoire', 'CI1234567890123', 'CI'),
      ('legacy',  'Opérateur non renseigné', 'XX0000000000000', 'XX');
  `);

  await appliquer(db, "drizzle/0007_operateur_non_renseigne.sql");

  const colonnes = await db.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
    `SELECT column_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = 'parcel_audits'
        AND column_name IN ('operator_name','operator_eori','operator_country')
      ORDER BY column_name`,
  );
  verifier(
    "les trois colonnes deviennent nullables",
    colonnes.rows.every((c) => c.is_nullable === "YES"),
    colonnes.rows.map((c) => `${c.column_name}=${c.is_nullable}`).join(", "),
  );
  verifier(
    "le défaut 'FR' est retiré",
    colonnes.rows.find((c) => c.column_name === "operator_country")?.column_default === null,
    String(colonnes.rows.find((c) => c.column_name === "operator_country")?.column_default),
  );

  const apres = await db.query<{ marqueur: string; operator_eori: string | null; operator_country: string | null }>(
    `SELECT marqueur, operator_eori, operator_country FROM parcel_audits ORDER BY marqueur`,
  );
  verifier("aucune ligne n'est perdue", apres.rows.length === 2, `${apres.rows.length} ligne(s)`);
  // Comparaison par marqueur, jamais par position : l'ordre de `ORDER BY
  // marqueur` est alphabétique ('legacy' avant 'reel'), ce qui a déjà fait
  // échouer cette assertion pour une mauvaise raison.
  const parMarqueur = new Map(apres.rows.map((r) => [r.marqueur, r]));
  verifier(
    "aucune valeur n'est réécrite par la migration",
    parMarqueur.get("reel")?.operator_eori === "CI1234567890123" &&
      parMarqueur.get("reel")?.operator_country === "CI" &&
      parMarqueur.get("legacy")?.operator_eori === "XX0000000000000" &&
      parMarqueur.get("legacy")?.operator_country === "XX",
    apres.rows.map((r) => `${r.marqueur}:${r.operator_eori}/${r.operator_country}`).join(" "),
  );

  console.log("\n\x1b[1mB. Vue de reprise\x1b[0m");
  const vue = await db.query<{ relname: string; security: string }>(`
    SELECT c.relname,
           coalesce(array_to_string(c.reloptions, ','), '') AS security
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'v_parcel_audits_identite' AND n.nspname = 'public'
  `);
  verifier("la vue existe", vue.rows.length === 1);
  verifier(
    "la vue est déclarée security_invoker (elle ne contourne pas la RLS)",
    vue.rows[0]?.security.includes("security_invoker=true"),
    vue.rows[0]?.security || "option absente",
  );

  const classes = await db.query<{ operator_identity: string; n: number }>(
    `SELECT operator_identity, count(*)::int AS n FROM v_parcel_audits_identite GROUP BY 1 ORDER BY 1`,
  );
  const parClasse = Object.fromEntries(classes.rows.map((r) => [r.operator_identity, r.n]));
  verifier(
    "les trois états sont distingués",
    parClasse["declared"] === 1 && parClasse["legacy_placeholder"] === 1 && !parClasse["missing"],
    JSON.stringify(parClasse),
  );

  // Une identité absente doit être classée « missing », jamais « declared ».
  await db.exec(`
    INSERT INTO parcel_audits (marqueur, operator_name, operator_eori, operator_country)
    VALUES ('absent', NULL, NULL, NULL);
  `);
  const apresNull = await db.query<{ operator_identity: string }>(
    `SELECT operator_identity FROM v_parcel_audits_identite WHERE id = (SELECT id FROM parcel_audits WHERE marqueur='absent')`,
  );
  verifier(
    "une identité NULL est classée « missing », pas « declared »",
    apresNull.rows[0]?.operator_identity === "missing",
    String(apresNull.rows[0]?.operator_identity),
  );

  console.log("\n\x1b[1mC. Idempotence de l'aller\x1b[0m");
  let idempotence = "";
  try {
    await appliquer(db, "drizzle/0007_operateur_non_renseigne.sql");
  } catch (erreur) {
    idempotence = erreur instanceof Error ? erreur.message : String(erreur);
  }
  verifier(
    "rejouer la migration sur une base déjà migrée ne lève pas",
    idempotence === "",
    idempotence || "aucune exception",
  );

  console.log("\n\x1b[1mD. Retour arrière — il refuse d'inventer une identité\x1b[0m");
  let messageRetour = "";
  try {
    await appliquer(db, "drizzle/0007_operateur_non_renseigne.down.sql");
  } catch (erreur) {
    messageRetour = erreur instanceof Error ? erreur.message : String(erreur);
  }
  verifier(
    "le retour arrière échoue tant qu'un dossier est sans identité",
    /Retour arrière refusé/i.test(messageRetour),
    messageRetour.split("\n")[0] || "aucune exception ❌ — le rollback a inventé une identité",
  );
  verifier(
    "le message nomme les dossiers à traiter",
    /dossier\(s\) sans pays/.test(messageRetour),
    "message explicite",
  );

  // La base doit être intacte après l'échec : un ROLLBACK échoué ne détruit rien.
  const intact = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM parcel_audits`);
  verifier("aucune ligne n'a été détruite par le retour arrière refusé", intact.rows[0]?.n === 3, `${intact.rows[0]?.n} ligne(s)`);

  // Et si les dossiers sont traités explicitement, le retour arrière passe.
  await db.exec(`
    UPDATE parcel_audits
       SET operator_name = coalesce(operator_name, ''),
           operator_eori = coalesce(operator_eori, ''),
           operator_country = coalesce(operator_country, 'FR')
     WHERE operator_eori IS NULL OR operator_country IS NULL OR operator_name IS NULL;
  `);
  let retourFinal = "";
  try {
    await appliquer(db, "drizzle/0007_operateur_non_renseigne.down.sql");
  } catch (erreur) {
    retourFinal = erreur instanceof Error ? erreur.message : String(erreur);
  }
  verifier(
    "une fois les dossiers explicitement repris, le retour arrière s'applique",
    retourFinal === "",
    retourFinal || "aucune exception",
  );

  await db.close();

  console.log("\n" + "=".repeat(70));
  if (echecs === 0) {
    console.log(`\x1b[1m\x1b[32mCONTRÔLES RÉUSSIS : ${total - echecs}/${total}\x1b[0m`);
  } else {
    console.log(`\x1b[1m\x1b[31mÉCHECS : ${echecs}/${total}\x1b[0m`);
    process.exitCode = 1;
  }
  console.log("=".repeat(70));
}

principal().catch((erreur) => {
  console.error("Banc interrompu :", erreur);
  process.exitCode = 1;
});
