-- Retour arrière de la migration 0010 (pays d'origine du produit facultatif).
--
-- ⚠️ Refuse tant qu'un produit est sans pays d'origine : réintroduire
--   NOT NULL / DEFAULT 'FR' exigerait d'inventer un pays — exactement le défaut
--   que 0010 (et le script 025) supprime. Même principe que 0009.
DO $garde$
DECLARE
  sans_pays bigint;
BEGIN
  SELECT count(*) INTO sans_pays FROM "gf_products" WHERE "country_of_origin" IS NULL;
  IF sans_pays > 0 THEN
    RAISE EXCEPTION 'Retour arrière refusé : % produit(s) sans pays d''origine. Réintroduire NOT NULL exigerait d''inventer un pays. Traitez ces produits explicitement (reprise produit).', sans_pays;
  END IF;
END
$garde$;
ALTER TABLE "gf_products" ALTER COLUMN "country_of_origin" SET NOT NULL;
ALTER TABLE "gf_products" ALTER COLUMN "country_of_origin" SET DEFAULT 'FR';
