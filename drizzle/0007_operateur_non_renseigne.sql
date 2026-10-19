-- P2-15 — l'identité de l'opérateur devient facultative.
--
-- Les trois colonnes étaient NOT NULL, avec 'FR' en défaut pour le pays, et la
-- route d'audit fabriquait un EORI « XX0000000000000 » quand aucune identité
-- n'était fournie. Ce triplet a la forme d'une identité réelle et traverse
-- l'historique puis l'export : il doit pouvoir valoir « non renseigné », ce que
-- NULL exprime, et rien d'autre.
--
-- Aucune donnée existante n'est réécrite par cette migration : les dossiers
-- historiques portant la valeur de remplissage restent tels quels et sont
-- signalés par la vue `v_parcel_audits_identite` (voir plus bas), afin que la
-- reprise soit une décision explicite et non un effet de bord.
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_eori" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_country" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_country" DROP DEFAULT;--> statement-breakpoint
-- Vue de reprise, strictement en lecture : elle classe les dossiers existants
-- sans en modifier aucun.
--
--   declared          : identité réellement fournie
--   legacy_placeholder: valeur de remplissage héritée du code antérieur
--   missing           : identité absente
--
-- ⚠️ La reprise des lignes `legacy_placeholder` est laissée à une décision
--    produit : on ne sait pas, pour un dossier donné, si l'opérateur était
--    réellement inconnu ou si la valeur a masqué une saisie perdue. Les
--    réécrire d'office effacerait cette incertitude ; les laisser telles quelles
--    sans les signaler la perpétuerait. La vue rend la liste visible.
-- ⚠️ `security_invoker = true` n'est pas décoratif. Une vue s'exécute par
--   défaut avec les droits de son **propriétaire** et ignore la RLS de la table
--   sous-jacente : cette vue aurait exposé les audits de toutes les
--   organisations à n'importe quel rôle ayant SELECT. Avec `security_invoker`,
--   les politiques de `parcel_audits` s'appliquent à l'appelant.
CREATE OR REPLACE VIEW "v_parcel_audits_identite" WITH (security_invoker = true) AS
SELECT
  "id",
  "created_at",
  "operator_name",
  "operator_eori",
  "operator_country",
  CASE
    WHEN "operator_eori" IS NULL THEN 'missing'
    WHEN "operator_eori" = 'XX0000000000000' THEN 'legacy_placeholder'
    ELSE 'declared'
  END AS "operator_identity"
FROM "parcel_audits";
