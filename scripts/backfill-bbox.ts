/**
 * Remplit les cadres englobants des parcelles historiques.
 *
 * Sécurité : ce script est une opération d'écriture administrative. Il exige
 * DATABASE_URL_ADMIN et refuse tout rôle qui ne possède ni SUPERUSER ni
 * BYPASSRLS. Il ne retombe jamais sur DATABASE_URL (rôle applicatif).
 *
 * --essai compte les lignes éligibles sans écrire.
 * --recalculer recalcule les quatre bornes de toutes les parcelles.
 *
 * Le traitement est idempotent : sans --recalculer, toute ligne dont au moins
 * une des quatre bornes est NULL est recalculée. Les lignes complètes restent
 * intactes. Chaque UPDATE est comptabilisé via RETURNING.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { Pool } from "pg";
import { bboxDeGeometrie } from "../src/lib/eudr/chevauchement";

const url = process.env.DATABASE_URL_ADMIN;
if (!url) {
  console.error("🔴 DATABASE_URL_ADMIN est obligatoire. DATABASE_URL est volontairement refusé.");
  process.exit(1);
}

const essai = process.argv.includes("--essai");
const recalculer = process.argv.includes("--recalculer");
const LOT = 200;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const identite = await pool.query<{
      role_name: string;
      is_superuser: boolean;
      bypass_rls: boolean;
    }>(`
      SELECT r.rolname AS role_name,
             r.rolsuper AS is_superuser,
             r.rolbypassrls AS bypass_rls
        FROM pg_roles r
       WHERE r.rolname = current_user
    `);

    const role = identite.rows[0];
    if (!role || (!role.is_superuser && !role.bypass_rls)) {
      throw new Error(
        `Rôle PostgreSQL "${role?.role_name ?? "inconnu"}" insuffisant : SUPERUSER ou BYPASSRLS requis.`,
      );
    }

    console.log(`Connexion administrative vérifiée : ${role.role_name} (SUPERUSER=${role.is_superuser}, BYPASSRLS=${role.bypass_rls})`);

    const filtre = recalculer
      ? ""
      : "WHERE bbox_min_lon IS NULL OR bbox_min_lat IS NULL OR bbox_max_lon IS NULL OR bbox_max_lat IS NULL";

    const total = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM gf_plots ${filtre}`,
    );
    const attendu = Number(total.rows[0]?.n ?? "0");
    console.log(`Parcelles à traiter : ${attendu}${recalculer ? " (recalcul complet)" : " (au moins une borne manquante)"}`);

    let lues = 0;
    let remplies = 0;
    let sansSurface = 0;
    let dernier: string | null = null;

    for (;;) {
      const page: { rows: Array<{ id: string; geometry: unknown }> } = await pool.query<{ id: string; geometry: unknown }>(
        `SELECT id, geometry
           FROM gf_plots
          WHERE (${recalculer
            ? "true"
            : "bbox_min_lon IS NULL OR bbox_min_lat IS NULL OR bbox_max_lon IS NULL OR bbox_max_lat IS NULL"})
            AND ($1::uuid IS NULL OR id > $1::uuid)
          ORDER BY id
          LIMIT $2`,
        [dernier, LOT],
      );
      if (page.rows.length === 0) break;

      for (const ligne of page.rows as Array<{ id: string; geometry: unknown }>) {
        lues += 1;
        dernier = ligne.id;
        const bbox = bboxDeGeometrie(ligne.geometry);
        if (!bbox) {
          sansSurface += 1;
          continue;
        }

        if (essai) {
          remplies += 1; // nombre de géométries calculables, sans écriture
          continue;
        }

        const update = await pool.query<{ id: string }>(
          `UPDATE gf_plots
              SET bbox_min_lon = $2, bbox_min_lat = $3,
                  bbox_max_lon = $4, bbox_max_lat = $5
            WHERE id = $1
              AND (${recalculer
                ? "true"
                : "bbox_min_lon IS NULL OR bbox_min_lat IS NULL OR bbox_max_lon IS NULL OR bbox_max_lat IS NULL"})
          RETURNING id`,
          [ligne.id, bbox[0], bbox[1], bbox[2], bbox[3]],
        );
        remplies += update.rowCount ?? update.rows.length;
      }
      if (page.rows.length < LOT) break;
    }

    if (essai) {
      console.log(`[ESSAI] Calculs BBOX possibles : ${remplies} · sans surface : ${sansSurface} · lignes examinées : ${lues}`);
      if (lues !== attendu || remplies + sansSurface !== lues) {
        throw new Error("Essai non concluant : les compteurs ne concordent pas.");
      }
      console.log("✅ Essai terminé, aucune écriture effectuée.");
      return;
    }

    const restant = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM gf_plots WHERE bbox_min_lon IS NULL OR bbox_min_lat IS NULL OR bbox_max_lon IS NULL OR bbox_max_lat IS NULL",
    );
    const nonTraitees = Number(restant.rows[0]?.n ?? "0");

    console.log(`Lues : ${lues} · mises à jour confirmées : ${remplies} · sans surface : ${sansSurface} · bornes encore incomplètes : ${nonTraitees}`);

    if (lues !== attendu || remplies + sansSurface !== lues || nonTraitees > 0) {
      throw new Error("Contrôle final non satisfait : les compteurs ne concordent pas ou des bornes restent incomplètes.");
    }
    console.log("✅ Backfill terminé et compteurs vérifiés.");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("🔴 Backfill impossible :", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
