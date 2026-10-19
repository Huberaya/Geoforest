-- Retour arrière de P2-15.
--
-- ⚠️ Il échouera si des lignes ont été enregistrées sans identité : c'est
-- volontaire. Réintroduire NOT NULL exigerait d'inventer une identité pour ces
-- dossiers, exactement ce que la migration corrige. La reprise doit être
-- traitée explicitement avant tout retour arrière.
DROP VIEW IF EXISTS "v_parcel_audits_identite";--> statement-breakpoint
-- ⚠️ P3-02 — cette ligne écrivait `operator_country = 'FR'` pour toutes les
--   lignes sans pays. Elle contredisait le commentaire ci-dessus : le retour
--   arrière **réussissait** en fabriquant un pays, ce que la migration
--   s'interdit. Un rollback qui invente une donnée est pire qu'un rollback qui
--   refuse.
--   On refuse donc explicitement, et on nomme ce qu'il faut traiter.
DO $garde$
DECLARE
  sans_pays bigint;
  sans_eori bigint;
  sans_nom bigint;
BEGIN
  SELECT count(*) INTO sans_pays FROM "parcel_audits" WHERE "operator_country" IS NULL;
  SELECT count(*) INTO sans_eori FROM "parcel_audits" WHERE "operator_eori" IS NULL;
  SELECT count(*) INTO sans_nom  FROM "parcel_audits" WHERE "operator_name"  IS NULL;

  IF sans_pays > 0 OR sans_eori > 0 OR sans_nom > 0 THEN
    RAISE EXCEPTION
      'Retour arrière refusé : % dossier(s) sans pays, % sans EORI, % sans nom. Réintroduire NOT NULL exigerait d''inventer une identité. Traitez ces dossiers explicitement (reprise produit) avant de revenir en arrière.',
      sans_pays, sans_eori, sans_nom;
  END IF;
END $garde$;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_country" SET DEFAULT 'FR';--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_country" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_eori" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_name" SET NOT NULL;
