CREATE TABLE "gf_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"user_email" text DEFAULT 'system' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gf_compliance_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"diligence_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"severity" text DEFAULT 'MEDIUM' NOT NULL,
	"status" text DEFAULT 'TO_HANDLE' NOT NULL,
	"assignee" text,
	"due_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gf_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"supplier_id" uuid,
	"plot_id" uuid,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text,
	"file_size" integer DEFAULT 0,
	"expiry_date" text,
	"status" text DEFAULT 'TO_VERIFY' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gf_due_diligence_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"commodity" text NOT NULL,
	"supplier_id" uuid,
	"product_id" uuid,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"risk_level" text DEFAULT 'STANDARD' NOT NULL,
	"completeness_score" integer DEFAULT 0 NOT NULL,
	"plots_count" integer DEFAULT 0 NOT NULL,
	"total_area_ha" double precision DEFAULT 0 NOT NULL,
	"net_weight_kg" double precision DEFAULT 0 NOT NULL,
	"traces_payload_json" jsonb,
	"traces_reference" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_gf_dds_tenant" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "gf_login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"window_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"first_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gf_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"eori" text,
	"country" text DEFAULT 'FR' NOT NULL,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gf_organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "parcel_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operator_name" text NOT NULL,
	"operator_eori" text NOT NULL,
	"operator_country" text DEFAULT 'FR' NOT NULL,
	"operator_address" text,
	"commodity" text NOT NULL,
	"hs_code" text NOT NULL,
	"harvest_date" text NOT NULL,
	"parcel_reference" text,
	"geometry" jsonb NOT NULL,
	"geometry_type" text NOT NULL,
	"area_ha" double precision DEFAULT 0 NOT NULL,
	"vertex_count" integer DEFAULT 0 NOT NULL,
	"centroid_lon" double precision DEFAULT 0 NOT NULL,
	"centroid_lat" double precision DEFAULT 0 NOT NULL,
	"country_code" text DEFAULT 'XX' NOT NULL,
	"country_risk" text DEFAULT 'STANDARD' NOT NULL,
	"compliant" boolean,
	"loss_year" integer,
	"confidence_score" double precision,
	"analysis_source" text DEFAULT 'unavailable' NOT NULL,
	"analysis_probative" boolean DEFAULT false NOT NULL,
	"analysis_evidence" jsonb,
	"risk_level" text DEFAULT 'STANDARD' NOT NULL,
	"status" text NOT NULL,
	"validation" jsonb NOT NULL,
	"satellite" jsonb,
	"draft_reference" text,
	"draft_generated_at" timestamp with time zone,
	"transmission_status" text DEFAULT 'NOT_TRANSMITTED' NOT NULL,
	"transmitted_at" timestamp with time zone,
	"transmission_ack" jsonb
);
--> statement-breakpoint
CREATE TABLE "gf_plots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"supplier_id" uuid,
	"name" text NOT NULL,
	"reference" text,
	"commodity" text NOT NULL,
	"country_code" text DEFAULT 'XX' NOT NULL,
	"geometry" jsonb NOT NULL,
	"geometry_type" text NOT NULL,
	"area_ha" double precision DEFAULT 0 NOT NULL,
	"vertex_count" integer DEFAULT 0 NOT NULL,
	"centroid_lon" double precision DEFAULT 0 NOT NULL,
	"centroid_lat" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"risk_level" text DEFAULT 'STANDARD' NOT NULL,
	"loss_year" integer,
	"confidence_score" double precision DEFAULT 0,
	"last_audit_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_gf_plots_tenant" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "gf_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"commodity" text NOT NULL,
	"hs_code" text NOT NULL,
	"country_of_origin" text DEFAULT 'FR' NOT NULL,
	"annual_volume_kg" double precision DEFAULT 0,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_gf_products_tenant" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "gf_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gf_sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "gf_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"supplier_id" uuid,
	"product_id" uuid,
	"reference" text NOT NULL,
	"net_weight_kg" double precision DEFAULT 0 NOT NULL,
	"harvest_date" text NOT NULL,
	"customs_declaration_ref" text,
	"status" text DEFAULT 'IN_PREPARATION' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_gf_shipments_tenant" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "gf_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"eori" text,
	"country" text DEFAULT 'CI' NOT NULL,
	"commodity" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"completeness_score" integer DEFAULT 0 NOT NULL,
	"risk_level" text DEFAULT 'STANDARD' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"plots_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_gf_suppliers_tenant" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "gf_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'compliance_officer' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"password_hash" text,
	"password_updated_at" timestamp with time zone,
	"token_version" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"mfa_secret" text,
	"mfa_enabled_at" timestamp with time zone,
	"mfa_recovery_codes" jsonb,
	CONSTRAINT "gf_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "gf_audit_logs" ADD CONSTRAINT "gf_audit_logs_organization_id_gf_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."gf_organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_compliance_tasks" ADD CONSTRAINT "gf_compliance_tasks_organization_id_gf_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."gf_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_compliance_tasks" ADD CONSTRAINT "gf_compliance_tasks_diligence_id_gf_due_diligence_statements_id_fk" FOREIGN KEY ("diligence_id") REFERENCES "public"."gf_due_diligence_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_compliance_tasks" ADD CONSTRAINT "fk_gf_tasks_dds_tenant" FOREIGN KEY ("diligence_id","organization_id") REFERENCES "public"."gf_due_diligence_statements"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD CONSTRAINT "gf_documents_organization_id_gf_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."gf_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD CONSTRAINT "gf_documents_supplier_id_gf_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."gf_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD CONSTRAINT "gf_documents_plot_id_gf_plots_id_fk" FOREIGN KEY ("plot_id") REFERENCES "public"."gf_plots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD CONSTRAINT "fk_gf_documents_supplier_tenant" FOREIGN KEY ("supplier_id","organization_id") REFERENCES "public"."gf_suppliers"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_documents" ADD CONSTRAINT "fk_gf_documents_plot_tenant" FOREIGN KEY ("plot_id","organization_id") REFERENCES "public"."gf_plots"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_due_diligence_statements" ADD CONSTRAINT "gf_due_diligence_statements_organization_id_gf_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."gf_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_due_diligence_statements" ADD CONSTRAINT "gf_due_diligence_statements_supplier_id_gf_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."gf_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_due_diligence_statements" ADD CONSTRAINT "gf_due_diligence_statements_product_id_gf_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."gf_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_due_diligence_statements" ADD CONSTRAINT "fk_gf_dds_supplier_tenant" FOREIGN KEY ("supplier_id","organization_id") REFERENCES "public"."gf_suppliers"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_due_diligence_statements" ADD CONSTRAINT "fk_gf_dds_product_tenant" FOREIGN KEY ("product_id","organization_id") REFERENCES "public"."gf_products"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcel_audits" ADD CONSTRAINT "parcel_audits_organization_id_gf_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."gf_organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_plots" ADD CONSTRAINT "gf_plots_organization_id_gf_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."gf_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_plots" ADD CONSTRAINT "gf_plots_supplier_id_gf_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."gf_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_plots" ADD CONSTRAINT "fk_gf_plots_supplier_tenant" FOREIGN KEY ("supplier_id","organization_id") REFERENCES "public"."gf_suppliers"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_products" ADD CONSTRAINT "gf_products_organization_id_gf_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."gf_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_sessions" ADD CONSTRAINT "gf_sessions_user_id_gf_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."gf_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_shipments" ADD CONSTRAINT "gf_shipments_organization_id_gf_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."gf_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_shipments" ADD CONSTRAINT "gf_shipments_supplier_id_gf_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."gf_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_shipments" ADD CONSTRAINT "gf_shipments_product_id_gf_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."gf_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_shipments" ADD CONSTRAINT "fk_gf_shipments_supplier_tenant" FOREIGN KEY ("supplier_id","organization_id") REFERENCES "public"."gf_suppliers"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_shipments" ADD CONSTRAINT "fk_gf_shipments_product_tenant" FOREIGN KEY ("product_id","organization_id") REFERENCES "public"."gf_products"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_suppliers" ADD CONSTRAINT "gf_suppliers_organization_id_gf_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."gf_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gf_users" ADD CONSTRAINT "gf_users_organization_id_gf_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."gf_organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gf_audit_logs_org" ON "gf_audit_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gf_audit_logs_created_at" ON "gf_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_gf_audit_logs_org_created" ON "gf_audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gf_tasks_org" ON "gf_compliance_tasks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gf_tasks_org_created" ON "gf_compliance_tasks" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gf_documents_org" ON "gf_documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gf_documents_org_created" ON "gf_documents" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gf_dds_org" ON "gf_due_diligence_statements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gf_dds_org_created" ON "gf_due_diligence_statements" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gf_login_attempts_key" ON "gf_login_attempts" USING btree ("window_key");--> statement-breakpoint
CREATE INDEX "idx_gf_organizations_slug" ON "gf_organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_parcel_audits_created_at" ON "parcel_audits" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_parcel_audits_org_created" ON "parcel_audits" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gf_plots_org" ON "gf_plots" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gf_plots_org_created" ON "gf_plots" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gf_products_org" ON "gf_products" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gf_products_org_created" ON "gf_products" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gf_sessions_user" ON "gf_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_gf_sessions_family" ON "gf_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "idx_gf_sessions_hash" ON "gf_sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "idx_gf_shipments_org" ON "gf_shipments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gf_shipments_org_created" ON "gf_shipments" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gf_suppliers_org" ON "gf_suppliers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gf_suppliers_org_created" ON "gf_suppliers" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_gf_users_org" ON "gf_users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_gf_users_email" ON "gf_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_gf_users_org_email" ON "gf_users" USING btree ("organization_id","email");