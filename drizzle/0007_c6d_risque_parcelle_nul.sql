ALTER TABLE "parcel_audits" ALTER COLUMN "risk_level" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "risk_level" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ADD COLUMN "country_statut" text DEFAULT 'RESOLU' NOT NULL;