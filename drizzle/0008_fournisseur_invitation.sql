ALTER TABLE "gf_users" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "gf_users" ADD COLUMN "invitation_token_hash" text;--> statement-breakpoint
ALTER TABLE "gf_users" ADD COLUMN "invitation_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gf_users" ADD CONSTRAINT "gf_users_supplier_id_gf_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."gf_suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gf_users_invitation" ON "gf_users" USING btree ("invitation_token_hash");--> statement-breakpoint
-- Comptes « supplier » sans fiche rattachée (3 comptes actifs en base de test) : la contrainte
-- ci-dessous les refuserait. Ils sont mis en quarantaine : suspendus et ramenés au rôle viewer,
-- sans suppression. Un administrateur peut les rattacher ensuite à une fiche.
UPDATE "gf_users" SET "role" = 'viewer', "status" = 'suspended' WHERE "role" = 'supplier' AND "supplier_id" IS NULL;--> statement-breakpoint
ALTER TABLE "gf_users" ADD CONSTRAINT "ck_gf_users_lien_fournisseur" CHECK ((role = 'supplier') = (supplier_id IS NOT NULL));