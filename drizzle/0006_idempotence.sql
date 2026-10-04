CREATE TABLE "gf_idempotence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"utilisateur_id" uuid,
	"portee" text NOT NULL,
	"cle" text NOT NULL,
	"empreinte_corps" text NOT NULL,
	"etat" text NOT NULL,
	"statut_http" integer,
	"type_contenu" text,
	"corps_reponse" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"expire_le" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_gf_idempotence_portee_cle" UNIQUE("organization_id","portee","cle")
);
--> statement-breakpoint
CREATE INDEX "idx_gf_idempotence_expiration" ON "gf_idempotence" USING btree ("expire_le");