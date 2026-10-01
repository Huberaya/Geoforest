ALTER TABLE "gf_audit_logs" ADD COLUMN "avant" jsonb;--> statement-breakpoint
ALTER TABLE "gf_audit_logs" ADD COLUMN "apres" jsonb;--> statement-breakpoint
ALTER TABLE "gf_audit_logs" ADD COLUMN "acteur_id" uuid;--> statement-breakpoint
ALTER TABLE "gf_audit_logs" ADD COLUMN "acteur_role" text;--> statement-breakpoint
ALTER TABLE "gf_audit_logs" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "gf_audit_logs" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "gf_audit_logs" ADD COLUMN "hash_precedent" text;--> statement-breakpoint
ALTER TABLE "gf_audit_logs" ADD COLUMN "hash" text;--> statement-breakpoint
ALTER TABLE "gf_compliance_tasks" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gf_compliance_tasks" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "gf_due_diligence_statements" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gf_due_diligence_statements" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "parcel_audits" ADD COLUMN "analysis_method" text DEFAULT 'non_renseignee' NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ADD COLUMN "analysis_version" text;--> statement-breakpoint
ALTER TABLE "parcel_audits" ADD COLUMN "analysis_params" jsonb;--> statement-breakpoint
ALTER TABLE "parcel_audits" ADD COLUMN "analysis_limits" jsonb;--> statement-breakpoint
ALTER TABLE "gf_plots" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gf_plots" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "gf_products" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gf_products" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "gf_shipments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gf_shipments" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "gf_suppliers" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gf_suppliers" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "gf_audit_logs" ADD CONSTRAINT "uq_gf_audit_logs_org_sequence" UNIQUE("organization_id","sequence");