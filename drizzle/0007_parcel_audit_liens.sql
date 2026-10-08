ALTER TABLE "parcel_audits" ADD COLUMN "plot_id" uuid;--> statement-breakpoint
ALTER TABLE "parcel_audits" ADD COLUMN "due_diligence_id" uuid;--> statement-breakpoint
ALTER TABLE "parcel_audits" ADD CONSTRAINT "fk_gf_parcel_audits_plot_tenant" FOREIGN KEY ("plot_id","organization_id") REFERENCES "public"."gf_plots"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcel_audits" ADD CONSTRAINT "fk_gf_parcel_audits_dds_tenant" FOREIGN KEY ("due_diligence_id","organization_id") REFERENCES "public"."gf_due_diligence_statements"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_parcel_audits_dds" ON "parcel_audits" USING btree ("organization_id","due_diligence_id");--> statement-breakpoint
CREATE INDEX "idx_parcel_audits_plot" ON "parcel_audits" USING btree ("organization_id","plot_id");