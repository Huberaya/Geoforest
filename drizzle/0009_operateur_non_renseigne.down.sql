-- Retour arrière de la migration 0009 (identité de l'opérateur facultative).
--
-- ⚠️ Ce retour arrière **échoue volontairement** tant qu'un dossier est sans
-- identité. Réintroduire `NOT NULL` exigerait d'inventer une identité pour ces
-- dossiers — c'est-à-dire de recréer exactement le défaut que la migration
-- supprime.
--
-- Une version antérieure de ce fichier écrivait
-- `UPDATE parcel_audits SET operator_country = 'FR' WHERE … IS NULL`
-- en prétendant échouer : elle réussissait en fabriquant un pays. Un retour
-- arrière qui invente une donnée est pire qu'un retour arrière qui refuse.
--
-- Le message nomme les dossiers à traiter. La reprise est une décision
-- produit : on ne sait pas, pour un dossier donné, si l'opérateur était
-- réellement inconnu ou si la saisie a été perdue.
-- ⚠️ La garde passe **avant** toute modification de schéma. Sinon, un retour
--   arrière refusé laisserait la vue supprimée et les colonnes toujours
--   facultatives : un état que plus aucune version du code ne sait lire.
--   Mesuré : appliqué instruction par instruction (comme `psql`), l'ordre
--   inverse laissait effectivement la vue détruite.
--   `scripts/rollback.ts` envoie le fichier en une seule requête simple, donc
--   dans une transaction implicite ; cette garde reste la seconde barrière,
--   celle qui protège un opérateur lançant le fichier à la main.
DO $garde$
DECLARE
  sans_pays bigint;
  sans_eori bigint;
  sans_nom  bigint;
BEGIN
  SELECT count(*) INTO sans_pays FROM "parcel_audits" WHERE "operator_country" IS NULL;
  SELECT count(*) INTO sans_eori FROM "parcel_audits" WHERE "operator_eori"    IS NULL;
  SELECT count(*) INTO sans_nom  FROM "parcel_audits" WHERE "operator_name"    IS NULL;

  IF sans_pays > 0 OR sans_eori > 0 OR sans_nom > 0 THEN
    RAISE EXCEPTION
      'Retour arrière refusé : % dossier(s) sans pays, % sans EORI, % sans nom. Réintroduire NOT NULL exigerait d''inventer une identité. Traitez ces dossiers explicitement (reprise produit) avant de revenir en arrière.',
      sans_pays, sans_eori, sans_nom;
  END IF;
END $garde$;--> statement-breakpoint

DROP VIEW IF EXISTS "v_parcel_audits_identite";--> statement-breakpoint

ALTER TABLE "parcel_audits" ALTER COLUMN "operator_country" SET DEFAULT 'FR';--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_country" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_eori" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_name" SET NOT NULL;
