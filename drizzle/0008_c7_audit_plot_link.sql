ALTER TABLE "parcel_audits" ADD COLUMN "plot_id" uuid;--> statement-breakpoint
ALTER TABLE "parcel_audits" ADD CONSTRAINT "fk_parcel_audits_plot_tenant" FOREIGN KEY ("plot_id","organization_id") REFERENCES "public"."gf_plots"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_parcel_audits_plot" ON "parcel_audits" USING btree ("plot_id");