/**
 * Remplit `bbox_min_lon/lat`, `bbox_max_lon/lat` des parcelles créées avant C8.
 *
 * ⚠️ Pourquoi ce script est nécessaire, et pourquoi il n'est PAS une migration.
 *
 *   Les quatre colonnes sont NULLABLES : une parcelle antérieure à C8 n'a pas
 *   de cadre englobant. Or le pré-filtre de détection de chevauchement écarte
 *   en SQL toute parcelle dont la borne est nulle (`bbox_min_lon is not null`).
 *   Sans remplissage, les parcelles existantes seraient **invisibles** à la
 *   détection : on croirait le contrôle en place alors qu'il ne voit que les
 *   parcelles créées après le déploiement.
 *
 *   Ce n'est pas une migration SQL parce que le calcul demande le même code que
 *   le produit (`bboxDeGeometrie`), et que dupliquer cette logique en SQL est
 *   exactement la façon dont deux verdicts finissent par diverger. Le
 *   remplissage est donc idempotent, rejouable, et utilise la fonction de
 *   référence.
 *
 * ⚠️ Idempotent : une parcelle qui a déjà une borne est laissée intacte, sauf
 *   `--recalculer`, qui refait tout. Un script qui écrase des valeurs à chaque
 *   exécution est un script qu'on n'ose plus lancer.
 *
 * Usage :
 *   npm run db:backfill-bbox              # lecture + écriture des manquantes
 *   npm run db:backfill-bbox -- --essai   # compte sans écrire
 *   npm run db:backfill-bbox -- --recalculer
 *
 * Sortie : 0 si tout est rempli, 1 en cas d'échec.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { Pool } from "pg";

import { bboxDeGeometrie } from "../src/lib/eudr/chevauchement";

const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
if (!url) {
  console.error("🔴 DATABASE_URL_ADMIN (ou DATABASE_URL) n'est pas défini.");
  process.exit(1);
}

const essai = process.argv.includes("--essai");
const recalculer = process.argv.includes("--recalculer");

/** Taille de lot : borne la mémoire, et rend l'interruption sans gravité. */
const LOT = 200;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const total = await pool.query<{ n: string }>("select count(*)::text as n from gf_plots");
    console.log(`Parcelles : ${total.rows[0].n}`);

    let lues = 0;
    let remplies = 0;
    let illisibles = 0;
    let dernier: string | null = null;

    for (;;) {
      const filtre = recalculer ? "" : "and bbox_min_lon is null";
      const page: { rows: Array<{ id: string; geometry: unknown }> } = await pool.query<{ id: string; geometry: unknown }>(
        `select id, geometry from gf_plots
          where true ${filtre}
            and ($1::uuid is null or id > $1::uuid)
          order by id
          limit $2`,
        [dernier, LOT],
      );
      if (page.rows.length === 0) break;

      for (const ligne of page.rows) {
        lues += 1;
        dernier = ligne.id;
        const bbox = bboxDeGeometrie(ligne.geometry);
        if (!bbox) {
          // Une géométrie sans anneau exploitable (point seul, ou tracé
          // illisible) n'a pas de surface : elle ne peut pas se recouvrir.
          // La laisser nulle est correct — et le script le compte, pour que le
          // chiffre soit visible plutôt que silencieux.
          illisibles += 1;
          continue;
        }
        if (!essai) {
          await pool.query(
            `update gf_plots
                set bbox_min_lon = $2, bbox_min_lat = $3, bbox_max_lon = $4, bbox_max_lat = $5
              where id = $1`,
            [ligne.id, bbox[0], bbox[1], bbox[2], bbox[3]],
          );
        }
        remplies += 1;
      }
      if (page.rows.length < LOT) break;
    }

    console.log(
      `${essai ? "[essai] " : ""}lues : ${lues} · ${essai ? "à remplir" : "remplies"} : ${remplies} · sans surface : ${illisibles}`,
    );
    if (illisibles > 0) {
      console.log(
        "⚠️ Les parcelles « sans surface » (point seul) ne participent pas à la détection\n" +
          "   de chevauchement : un point n'a pas de surface à recouvrir.",
      );
    }
    if (!essai && remplies > 0) {
      console.log("✅ Cadres englobants à jour.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("🔴 Remplissage impossible :", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
