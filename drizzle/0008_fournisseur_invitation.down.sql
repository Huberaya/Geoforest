-- Retour arrière de la migration 0008 (comptes fournisseurs invités).
--
-- ⚠️ Refuse tant qu'un compte est rattaché à une fiche fournisseur ou porte
--   une invitation : retirer `supplier_id` couperait le lien que la
--   contrainte `ck_gf_users_lien_fournisseur` garantit, et le compte « supplier »
--   deviendrait un compte sans périmètre. Ces comptes sont à traiter
--   explicitement avant (reprise produit), pas à désosser par une descente.
-- ⚠️ La mise en quarantaine faite par 0008 (comptes « supplier » sans fiche
--   ramenés à viewer/suspended) n'est **pas** annulée : on ne sait pas, pour
--   un compte donné, quel était son état avant — et le journal d'audit en
--   garde la trace.
DO $garde$
DECLARE
  rattaches bigint;
  invites   bigint;
BEGIN
  SELECT count(*) INTO rattaches FROM "gf_users" WHERE "supplier_id" IS NOT NULL;
  SELECT count(*) INTO invites   FROM "gf_users" WHERE "invitation_token_hash" IS NOT NULL OR "invitation_expires_at" IS NOT NULL;
  IF rattaches > 0 OR invites > 0 THEN
    RAISE EXCEPTION 'Retour arrière refusé : % compte(s) rattaché(s) à un fournisseur, % invitation(s) en cours. Détachez ou clôturez ces comptes explicitement avant de descendre.', rattaches, invites;
  END IF;
END
$garde$;
--> statement-breakpoint
ALTER TABLE "gf_users" DROP CONSTRAINT IF EXISTS "ck_gf_users_lien_fournisseur";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_gf_users_invitation";--> statement-breakpoint
ALTER TABLE "gf_users" DROP CONSTRAINT IF EXISTS "gf_users_supplier_id_gf_suppliers_id_fk";--> statement-breakpoint
ALTER TABLE "gf_users" DROP COLUMN IF EXISTS "invitation_expires_at";--> statement-breakpoint
ALTER TABLE "gf_users" DROP COLUMN IF EXISTS "invitation_token_hash";--> statement-breakpoint
ALTER TABLE "gf_users" DROP COLUMN IF EXISTS "supplier_id";
