-- 0010 — rattachement de l'analyse (parcel_audits) au dossier de diligence.
--
-- Historique : la branche de la PR #11 portait ce rattachement dans une
-- migration « 0007_parcel_audit_liens » qui ajoutait AUSSI `plot_id`, sa clé
-- composite et l'index `idx_parcel_audits_plot`. Entre-temps, `main` (PR #18)
-- a livré `plot_id` par `0008_c7_audit_plot_link` (clé `fk_parcel_audits_plot_tenant`,
-- index `idx_parcel_audits_plot` sur `plot_id`). Cette migration ne reprend donc
-- que ce qui manque encore : `due_diligence_id`, sa clé composite tenant-safe et
-- son index. Pas de `ON DELETE SET NULL` : sur une clé composite il remettrait
-- aussi `organization_id` à NULL (colonne NOT NULL).
ALTER TABLE "parcel_audits" ADD COLUMN "due_diligence_id" uuid;--> statement-breakpoint
ALTER TABLE "parcel_audits" ADD CONSTRAINT "fk_gf_parcel_audits_dds_tenant" FOREIGN KEY ("due_diligence_id","organization_id") REFERENCES "public"."gf_due_diligence_statements"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_parcel_audits_dds" ON "parcel_audits" USING btree ("organization_id","due_diligence_id");
