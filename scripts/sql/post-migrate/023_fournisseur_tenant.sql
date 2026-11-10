-- ===========================================================================
-- 023 — Compte fournisseur : le lien vers la fiche producteur ne traverse
--       jamais deux organisations (chantier 6, « parcours fournisseur »).
--
-- Une contrainte de clé étrangère simple (supplier_id → gf_suppliers.id) ne
-- suffit pas : un compte de l'organisation A pourrait pointer vers une fiche
-- de l'organisation B. La clé composite (supplier_id, organization_id) l'interdit
-- au niveau de la base, quel que soit le code applicatif.
--
-- Idempotent : rejouer le script ne change rien. Appliqué après les migrations
-- par scripts/migrate.ts, dans l'ordre du nom de fichier.
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_gf_users_supplier_tenant'
  ) THEN
    ALTER TABLE gf_users
      ADD CONSTRAINT fk_gf_users_supplier_tenant
      FOREIGN KEY (supplier_id, organization_id)
      REFERENCES gf_suppliers (id, organization_id);
  END IF;
END
$$;
