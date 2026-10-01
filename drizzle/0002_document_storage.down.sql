-- Contrepartie descendante de 0002_document_storage.
-- ⚠️ Supprime l'historique des versions et les métadonnées de stockage.
--    Les objets écrits sur le support ne sont PAS effacés par cette descente :
--    une migration ne doit pas détruire des pièces justificatives. Leur retrait
--    relève d'une opération d'exploitation explicite.
DROP TABLE IF EXISTS "gf_document_versions";--> statement-breakpoint
ALTER TABLE "gf_documents" DROP COLUMN IF EXISTS "storage_key";--> statement-breakpoint
ALTER TABLE "gf_documents" DROP COLUMN IF EXISTS "sha256";--> statement-breakpoint
ALTER TABLE "gf_documents" DROP COLUMN IF EXISTS "size_bytes";--> statement-breakpoint
ALTER TABLE "gf_documents" DROP COLUMN IF EXISTS "mime_detected";--> statement-breakpoint
ALTER TABLE "gf_documents" DROP COLUMN IF EXISTS "mime_declared";--> statement-breakpoint
ALTER TABLE "gf_documents" DROP COLUMN IF EXISTS "version";--> statement-breakpoint
ALTER TABLE "gf_documents" DROP COLUMN IF EXISTS "scan_status";--> statement-breakpoint
ALTER TABLE "gf_documents" DROP COLUMN IF EXISTS "scan_detail";--> statement-breakpoint
ALTER TABLE "gf_documents" DROP COLUMN IF EXISTS "scan_moteur";--> statement-breakpoint
ALTER TABLE "gf_documents" DROP COLUMN IF EXISTS "uploaded_by";
