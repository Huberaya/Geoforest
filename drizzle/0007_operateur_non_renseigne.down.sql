-- Retour arrière de P2-15.
--
-- ⚠️ Il échouera si des lignes ont été enregistrées sans identité : c'est
-- volontaire. Réintroduire NOT NULL exigerait d'inventer une identité pour ces
-- dossiers, exactement ce que la migration corrige. La reprise doit être
-- traitée explicitement avant tout retour arrière.
DROP VIEW IF EXISTS "v_parcel_audits_identite";--> statement-breakpoint
UPDATE "parcel_audits" SET "operator_country" = 'FR' WHERE "operator_country" IS NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_country" SET DEFAULT 'FR';--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_country" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_eori" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_name" SET NOT NULL;
