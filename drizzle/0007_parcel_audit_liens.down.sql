drop index if exists "idx_parcel_audits_plot";--> statement-breakpoint
drop index if exists "idx_parcel_audits_dds";--> statement-breakpoint
alter table "parcel_audits" drop constraint if exists "fk_gf_parcel_audits_dds_tenant";--> statement-breakpoint
alter table "parcel_audits" drop constraint if exists "fk_gf_parcel_audits_plot_tenant";--> statement-breakpoint
alter table "parcel_audits" drop column if exists "due_diligence_id";--> statement-breakpoint
alter table "parcel_audits" drop column if exists "plot_id";
