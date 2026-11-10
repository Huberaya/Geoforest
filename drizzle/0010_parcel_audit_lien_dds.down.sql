-- Retour arrière de la migration 0010 (rattachement analyse → dossier de diligence).
-- `plot_id` n'est pas touché : il appartient à 0008_c7_audit_plot_link.
drop index if exists "idx_parcel_audits_dds";--> statement-breakpoint
alter table "parcel_audits" drop constraint if exists "fk_gf_parcel_audits_dds_tenant";--> statement-breakpoint
alter table "parcel_audits" drop column if exists "due_diligence_id";
