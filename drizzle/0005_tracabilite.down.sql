-- Retour arrière de la migration 0005 (traçabilité : chaîne de condensats du
-- journal, suppression logique, méthode d'analyse des dossiers).
--
-- ⚠️ Cette descente **supprime des colonnes**, donc des données : condensats
--   du journal d'audit, marques de suppression logique, provenance des
--   analyses. Elle refuse dès qu'une de ces colonnes porte une information,
--   car la perdre casserait la chaîne de preuve que 0005 a introduite. Sur
--   une base où elles sont vides (déploiement raté, juste après la montée),
--   elle remet le schéma à l'état 0004.
-- ⚠️ Les scripts de sûreté 020/021/022 (déclencheurs d'append-only, chaîne
--   continue, politiques de suppression logique) dépendent de ces colonnes :
--   ils sont retirés d'abord, sinon les `drop column` échouent ou laissent des
--   déclencheurs orphelins. Ils seront rejoués par `npm run db:migrate`.
DO $garde$
DECLARE
  condensats bigint;
  supprimees bigint;
  analyses   bigint;
BEGIN
  SELECT count(*) INTO condensats FROM "gf_audit_logs" WHERE "hash" IS NOT NULL OR "hash_precedent" IS NOT NULL;
  SELECT (SELECT count(*) FROM "gf_suppliers" WHERE "deleted_at" IS NOT NULL)
       + (SELECT count(*) FROM "gf_products" WHERE "deleted_at" IS NOT NULL)
       + (SELECT count(*) FROM "gf_shipments" WHERE "deleted_at" IS NOT NULL)
       + (SELECT count(*) FROM "gf_plots" WHERE "deleted_at" IS NOT NULL)
       + (SELECT count(*) FROM "gf_documents" WHERE "deleted_at" IS NOT NULL)
       + (SELECT count(*) FROM "gf_due_diligence_statements" WHERE "deleted_at" IS NOT NULL)
       + (SELECT count(*) FROM "gf_compliance_tasks" WHERE "deleted_at" IS NOT NULL)
    INTO supprimees;
  SELECT count(*) INTO analyses FROM "parcel_audits" WHERE "analysis_method" <> 'non_renseignee';
  IF condensats > 0 OR supprimees > 0 OR analyses > 0 THEN
    RAISE EXCEPTION 'Retour arrière refusé : % ligne(s) de journal scellée(s), % ligne(s) en suppression logique, % analyse(s) avec méthode consignée. Ces colonnes portent des preuves : les retirer les détruirait. Restaurer une sauvegarde plutôt que descendre.', condensats, supprimees, analyses;
  END IF;
END
$garde$;
--> statement-breakpoint
-- Les politiques de 022 (lecture/maj/retrait) filtrent sur deleted_at : elles
-- sont remplacées par la politique unique de 010 (tenant_isolation, sans
-- suppression logique), que 010 recréera à l'identique au prochain migrate.
-- La RLS reste activée et forcée pendant toute l'opération : à aucun moment
-- une table n'est lisible hors périmètre.
DO $politiques$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'gf_suppliers','gf_products','gf_shipments','gf_plots',
    'gf_documents','gf_due_diligence_statements','gf_compliance_tasks'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_lecture ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_ecriture ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_maj ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_retrait ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL USING (organization_id = current_org() AND current_org() IS NOT NULL) WITH CHECK (organization_id = current_org() AND current_org() IS NOT NULL)', t);
  END LOOP;
END
$politiques$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_gf_audit_logs_append_only ON "gf_audit_logs";--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_gf_audit_logs_chaine ON "gf_audit_logs";--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_gf_audit_logs_sceller ON "gf_audit_logs";--> statement-breakpoint
ALTER TABLE "gf_audit_logs" DROP CONSTRAINT IF EXISTS "uq_gf_audit_logs_org_sequence";--> statement-breakpoint
ALTER TABLE "gf_audit_logs" DROP COLUMN IF EXISTS "hash";--> statement-breakpoint
ALTER TABLE "gf_audit_logs" DROP COLUMN IF EXISTS "hash_precedent";--> statement-breakpoint
ALTER TABLE "gf_audit_logs" DROP COLUMN IF EXISTS "sequence";--> statement-breakpoint
ALTER TABLE "gf_audit_logs" DROP COLUMN IF EXISTS "request_id";--> statement-breakpoint
ALTER TABLE "gf_audit_logs" DROP COLUMN IF EXISTS "acteur_role";--> statement-breakpoint
ALTER TABLE "gf_audit_logs" DROP COLUMN IF EXISTS "acteur_id";--> statement-breakpoint
ALTER TABLE "gf_audit_logs" DROP COLUMN IF EXISTS "apres";--> statement-breakpoint
ALTER TABLE "gf_audit_logs" DROP COLUMN IF EXISTS "avant";--> statement-breakpoint
ALTER TABLE "parcel_audits" DROP COLUMN IF EXISTS "analysis_limits";--> statement-breakpoint
ALTER TABLE "parcel_audits" DROP COLUMN IF EXISTS "analysis_params";--> statement-breakpoint
ALTER TABLE "parcel_audits" DROP COLUMN IF EXISTS "analysis_version";--> statement-breakpoint
ALTER TABLE "parcel_audits" DROP COLUMN IF EXISTS "analysis_method";--> statement-breakpoint
ALTER TABLE "gf_compliance_tasks" DROP COLUMN IF EXISTS "deleted_by";--> statement-breakpoint
ALTER TABLE "gf_compliance_tasks" DROP COLUMN IF EXISTS "deleted_at";--> statement-breakpoint
ALTER TABLE "gf_documents" DROP COLUMN IF EXISTS "deleted_by";--> statement-breakpoint
ALTER TABLE "gf_documents" DROP COLUMN IF EXISTS "deleted_at";--> statement-breakpoint
ALTER TABLE "gf_due_diligence_statements" DROP COLUMN IF EXISTS "deleted_by";--> statement-breakpoint
ALTER TABLE "gf_due_diligence_statements" DROP COLUMN IF EXISTS "deleted_at";--> statement-breakpoint
ALTER TABLE "gf_plots" DROP COLUMN IF EXISTS "deleted_by";--> statement-breakpoint
ALTER TABLE "gf_plots" DROP COLUMN IF EXISTS "deleted_at";--> statement-breakpoint
ALTER TABLE "gf_products" DROP COLUMN IF EXISTS "deleted_by";--> statement-breakpoint
ALTER TABLE "gf_products" DROP COLUMN IF EXISTS "deleted_at";--> statement-breakpoint
ALTER TABLE "gf_shipments" DROP COLUMN IF EXISTS "deleted_by";--> statement-breakpoint
ALTER TABLE "gf_shipments" DROP COLUMN IF EXISTS "deleted_at";--> statement-breakpoint
ALTER TABLE "gf_suppliers" DROP COLUMN IF EXISTS "deleted_by";--> statement-breakpoint
ALTER TABLE "gf_suppliers" DROP COLUMN IF EXISTS "deleted_at";
