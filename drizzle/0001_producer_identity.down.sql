-- Contrepartie descendante de 0001_producer_identity.
-- ⚠️ Supprime les colonnes, donc les identités de producteur déjà déclarées :
--    une descente n'est pas une sauvegarde (cf. scripts/rollback.ts).
ALTER TABLE "parcel_audits" DROP COLUMN IF EXISTS "producer_name";--> statement-breakpoint
ALTER TABLE "parcel_audits" DROP COLUMN IF EXISTS "producer_country";
