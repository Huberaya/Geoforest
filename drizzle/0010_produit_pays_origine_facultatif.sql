-- 0010 — gf_products.country_of_origin devient facultatif, sans défaut.
--
-- ⚠️ Ce changement était déjà appliqué par le script de sûreté
--   scripts/sql/post-migrate/025_identite_operateur.sql (un produit créé sans
--   pays d'origine recevait « FR » en silence), et src/db/schema.ts le
--   décrivait déjà ainsi. Seul l'historique Drizzle (snapshot 0009) n'en
--   savait rien : `drizzle-kit generate` régénérait ces deux ordres à chaque
--   appel. Cette migration les consigne, pour que le journal corresponde à la
--   base. Les deux ordres sont sans effet sur une base où 025 est déjà passé.
ALTER TABLE "gf_products" ALTER COLUMN "country_of_origin" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "gf_products" ALTER COLUMN "country_of_origin" DROP NOT NULL;
