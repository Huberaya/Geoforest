import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PGlite } from "@electric-sql/pglite";

const RACINE = fileURLToPath(new URL("../../", import.meta.url));

/** Applique les migrations Drizzle, puis les scripts post-migration. */
export async function appliquerMigrations(client: PGlite): Promise<void> {
  const dossierDrizzle = join(RACINE, "drizzle");
  const fichiers = readdirSync(dossierDrizzle)
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
    .sort();

  for (const fichier of fichiers) {
    const contenu = readFileSync(join(dossierDrizzle, fichier), "utf8");
    for (const instruction of contenu.split("--> statement-breakpoint")) {
      if (instruction.trim()) await client.exec(instruction);
    }
  }

  const dossierPost = join(RACINE, "scripts", "sql", "post-migrate");
  for (const fichier of readdirSync(dossierPost).filter((f) => f.endsWith(".sql")).sort()) {
    // Les scripts sont écrits pour `psql` : les méta-commandes (`\set`, `\if`)
    // n'ont pas de sens pour PGlite et sont retirées ligne à ligne.
    const contenu = readFileSync(join(dossierPost, fichier), "utf8")
      .split("\n")
      .filter((ligne) => !ligne.trimStart().startsWith("\\"))
      .join("\n");
    await client.exec(contenu);
  }
}

export const ORG_A = "11111111-1111-4111-8111-111111111111";
export const ORG_B = "22222222-2222-4222-8222-222222222222";

export const USER_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
export const USER_B = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";

export const SUPPLIER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const SUPPLIER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export const PLOT_A = "aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa";
export const PLOT_B = "bbbbbbbb-5555-4555-8555-bbbbbbbbbbbb";

export const DOC_A = "aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa";
export const DOC_B = "bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb";

export const DDS_A = "aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa";
export const DDS_B = "bbbbbbbb-7777-4777-8777-bbbbbbbbbbbb";

export const AUDIT_A = "aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa";
export const AUDIT_B = "bbbbbbbb-8888-4888-8888-bbbbbbbbbbbb";

/** Deux organisations complètes, avec une ligne de chaque table métier. */
export async function semerDeuxTenants(client: PGlite): Promise<void> {
  await client.exec(`
    insert into gf_organizations (id, name, slug, country)
    values
      ('${ORG_A}', 'Organisation A', 'org-a', 'FR'),
      ('${ORG_B}', 'Organisation B', 'org-b', 'BE');

    insert into gf_users (id, organization_id, email, name, role, status, token_version)
    values
      ('${USER_A}', '${ORG_A}', 'a@exemple.test', 'Utilisateur A', 'viewer', 'active', 0),
      ('${USER_B}', '${ORG_B}', 'b@exemple.test', 'Utilisateur B', 'viewer', 'active', 0);

    insert into gf_suppliers
      (id, organization_id, name, country, commodity, completeness_score, risk_level, status, plots_count)
    values
      ('${SUPPLIER_A}', '${ORG_A}', 'Fournisseur A', 'FR', 'coffee', 10, 'STANDARD', 'ACTIVE', 1),
      ('${SUPPLIER_B}', '${ORG_B}', 'Fournisseur B', 'BE', 'cocoa', 10, 'STANDARD', 'ACTIVE', 1);

    insert into gf_plots
      (id, organization_id, supplier_id, name, commodity, country_code, geometry, geometry_type,
       area_ha, vertex_count, centroid_lon, centroid_lat, status)
    values
      ('${PLOT_A}', '${ORG_A}', '${SUPPLIER_A}', 'Parcelle A', 'coffee', 'FR',
       '{"type":"Point","coordinates":[1,2]}'::jsonb, 'Point', 1, 1, 1, 2, 'PENDING'),
      ('${PLOT_B}', '${ORG_B}', '${SUPPLIER_B}', 'Parcelle B', 'cocoa', 'BE',
       '{"type":"Point","coordinates":[3,4]}'::jsonb, 'Point', 1, 1, 3, 4, 'PENDING');

    insert into gf_documents
      (id, organization_id, supplier_id, plot_id, title, category, file_name, status)
    values
      ('${DOC_A}', '${ORG_A}', '${SUPPLIER_A}', '${PLOT_A}', 'Document A', 'LAND_TENURE', 'a.pdf', 'TO_VERIFY'),
      ('${DOC_B}', '${ORG_B}', '${SUPPLIER_B}', '${PLOT_B}', 'Document B', 'LAND_TENURE', 'b.pdf', 'TO_VERIFY');

    insert into gf_due_diligence_statements
      (id, organization_id, reference, title, commodity, supplier_id, status)
    values
      ('${DDS_A}', '${ORG_A}', 'DDS-A', 'Dossier A', 'coffee', '${SUPPLIER_A}', 'DRAFT'),
      ('${DDS_B}', '${ORG_B}', 'DDS-B', 'Dossier B', 'cocoa', '${SUPPLIER_B}', 'DRAFT');

    insert into parcel_audits
      (id, organization_id, operator_name, operator_eori, commodity, hs_code, harvest_date,
       geometry, geometry_type, area_ha, vertex_count, centroid_lon, centroid_lat,
       country_code, status, validation)
    values
      ('${AUDIT_A}', '${ORG_A}', 'Opérateur A', 'FR123456789', 'coffee', '0901', '2026-01-01',
       '{"type":"Point","coordinates":[1,2]}'::jsonb, 'Point', 1, 1, 1, 2, 'FR', 'COMPLIANT', '{}'::jsonb),
      ('${AUDIT_B}', '${ORG_B}', 'Opérateur B', 'BE987654321', 'cocoa', '1801', '2026-01-01',
       '{"type":"Point","coordinates":[3,4]}'::jsonb, 'Point', 1, 1, 3, 4, 'BE', 'COMPLIANT', '{}'::jsonb);
  `);
}

/**
 * Exécute une opération sous le rôle applicatif, dans une transaction dont le
 * contexte de tenant est posé — exactement ce que fait `withTenant()`.
 */
export async function avecTenant<T>(
  client: PGlite,
  organisation: string | null,
  operation: (tx: PGlite) => Promise<T>,
): Promise<T> {
  return client.transaction(async (tx) => {
    if (organisation) {
      await tx.exec(`select set_config('app.current_org', '${organisation}', true)`);
    } else {
      // Contexte volontairement absent : la RLS doit renvoyer zéro ligne.
      await tx.exec(`select set_config('app.current_org', '', true)`);
    }
    return operation(tx as unknown as PGlite);
  });
}
