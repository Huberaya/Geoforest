-- Lot A — l'identité de l'opérateur devient facultative.
--
-- ⚠️ Pourquoi cette migration existe.
--
-- `parcel_audits.operator_name`, `operator_eori` et `operator_country` étaient
-- `NOT NULL`, et `operator_country` portait `DEFAULT 'FR'`. La route d'audit
-- remplaçait tout opérateur absent par un triplet de remplissage :
--
--     name  = 'Opérateur non renseigné'
--     eori  = 'XX0000000000000'
--     pays  = 'XX'
--
-- Ce triplet a la forme d'une identité réelle. Une fois écrit en base, plus
-- rien ne le distingue d'une identité véritablement déclarée : il traverse
-- l'historique, puis l'export, et le dossier part en déclaration en paraissant
-- complet.
--
-- `NULL` exprime « non renseigné », et rien d'autre. Aucune valeur par défaut
-- n'est conservée : un pays inventé (`FR`) pour tout opérateur silencieux est
-- exactement le défaut que cette migration supprime.
--
-- ⚠️ Aucune donnée existante n'est réécrite. Les dossiers hérités portant la
-- valeur de remplissage restent tels quels et sont **signalés** par la vue
-- `v_parcel_audits_identite` ci-dessous : leur reprise est une décision
-- explicite, pas un effet de bord.

ALTER TABLE "parcel_audits" ALTER COLUMN "operator_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_eori" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_country" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_country" DROP NOT NULL;

-- Vue de reprise, strictement en lecture : elle classe les dossiers existants
-- sans en modifier aucun.
--
--   declared           : identité réellement fournie
--   legacy_placeholder : valeur de remplissage héritée du code antérieur
--   missing            : identité absente
--
-- ⚠️ `security_invoker = true` n'est pas décoratif. Une vue s'exécute par
-- défaut avec les droits de son **propriétaire** et ignore la RLS de la table
-- sous-jacente : cette vue aurait exposé les audits de toutes les
-- organisations à n'importe quel rôle disposant de SELECT. Avec
-- `security_invoker`, les politiques de `parcel_audits` s'appliquent à
-- l'appelant. (Option disponible depuis PostgreSQL 15 ; le projet cible 16.)
--
-- Le vocabulaire est identique à `classerIdentiteOperateur()` (TypeScript) et
-- à `classer_identite_operateur()` (Python) : trois implémentations d'une même
-- règle doivent nommer les mêmes états, sinon l'écart ne se voit qu'en
-- production.
CREATE OR REPLACE VIEW "v_parcel_audits_identite" WITH (security_invoker = true) AS
SELECT
  "id",
  "organization_id",
  "created_at",
  "operator_name",
  "operator_eori",
  "operator_country",
  CASE
    WHEN "operator_eori" IS NULL OR btrim("operator_eori") = '' THEN 'missing'
    WHEN upper(btrim("operator_eori")) = 'XX0000000000000' THEN 'legacy_placeholder'
    WHEN "operator_name" IS NULL OR length(btrim("operator_name")) < 2 THEN 'missing'
    ELSE 'declared'
  END AS "operator_identity"
FROM "parcel_audits";
