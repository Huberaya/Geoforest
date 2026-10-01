-- ⚠️ Intervention manuelle sur une migration générée, et pourquoi.
-- drizzle-kit émet les contraintes après les colonnes, dans l'ordre des
-- tables. La clé étrangère composite de `gf_document_versions` exige que
-- la paire (id, organization_id) de `gf_documents` soit unique — or
-- l'unicité était émise APRÈS la clé, ce qui faisait échouer la migration.
-- L'ordre a donc été corrigé à la main. Toute régénération de ce fichier
-- reproduirait le défaut : le vérifier après un `db:generate`.
CREATE TABLE "gf_document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"mime_detected" text NOT NULL,
	"mime_declared" text,
	"scan_status" text DEFAULT 'NOT_SCANNED' NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gf_documents" ADD COLUMN "storage_key" text;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD COLUMN "mime_detected" text;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD COLUMN "mime_declared" text;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD COLUMN "scan_status" text DEFAULT 'NOT_SCANNED' NOT NULL;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD COLUMN "scan_detail" text;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD COLUMN "scan_moteur" text;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "gf_document_versions" ADD CONSTRAINT "gf_document_versions_organization_id_gf_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."gf_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_document_versions" ADD CONSTRAINT "gf_document_versions_document_id_gf_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."gf_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD CONSTRAINT "uq_gf_documents_tenant" UNIQUE("id","organization_id");
ALTER TABLE "gf_document_versions" ADD CONSTRAINT "fk_gf_doc_versions_document_tenant" FOREIGN KEY ("document_id","organization_id") REFERENCES "public"."gf_documents"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gf_doc_versions_org" ON "gf_document_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gf_doc_versions_document" ON "gf_document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_gf_doc_versions_doc_version" ON "gf_document_versions" USING btree ("document_id","version");--> statement-breakpoint
