-- ---------------------------------------------------------------------------
-- 025 — Identité opérateur : l'absence reste l'absence
-- ---------------------------------------------------------------------------
-- P0 — constat du 20/10/2026.
--
--   La route `POST /api/v1/audit/parcel` fabriquait un opérateur fictif
--   lorsqu'aucune identité n'était fournie :
--
--       { name: "Opérateur non renseigné",
--         eori: "XX0000000000000",
--         country: "XX" }
--
--   puis l'export TRACES reprenait ces valeurs telles quelles. Une déclaration
--   pouvait donc désigner un opérateur qui n'existe pas, avec un EORI qui
--   n'existe pas et un pays qui n'existe pas.
--
--   Les colonnes étaient NOT NULL, avec `operator_country DEFAULT 'FR'` : une
--   identité absente ne pouvait pas être représentée, et la valeur par défaut
--   inventait un pays français. Ce script rend l'absence représentable et
--   interdit les valeurs fictives.
--
--   ⚠️ Aucune migration publiée n'est réécrite : le schéma historique reste
--   tel quel, ce script s'ajoute à la chaîne des post-migrations.
-- ---------------------------------------------------------------------------

-- 1. Une identité non déclarée est un état valide : colonnes nullables, et
--    plus aucune valeur de pays par défaut.
alter table parcel_audits alter column operator_name drop not null;
alter table parcel_audits alter column operator_eori drop not null;
alter table parcel_audits alter column operator_country drop not null;
alter table parcel_audits alter column operator_country drop default;

-- 2. Données historiques : normalisation de la casse, puis effacement des
--    sentinelles fabriquées — jamais remplacées par une autre valeur inventée.
--
--    Une valeur réelle en minuscules n'est pas une identité fictive : elle est
--    normalisée avant le contrôle de format, pas supprimée.
update parcel_audits
   set operator_name = btrim(operator_name),
       operator_eori = upper(btrim(operator_eori)),
       operator_country = upper(btrim(operator_country))
 where (operator_name is not null and operator_name <> btrim(operator_name))
    or (operator_eori is not null and operator_eori <> upper(btrim(operator_eori)))
    or (operator_country is not null and operator_country <> upper(btrim(operator_country)));

--    Le cas « opérateur anonyme » de l'ancienne route porte le triplet
--    complet ; il est recognisé par son EORI sentinelle et remis à NULL.
update parcel_audits
   set operator_name = null,
       operator_eori = null,
       operator_country = null
 where operator_eori = 'XX0000000000000';

--    Les autres champs sont traités séparément : un nom réel est conservé
--    même si le pays ou l'EORI manque, et inversement. On n'efface que ce qui
--    est fictif ou invalide.
update parcel_audits
   set operator_name = null
 where operator_name is not null
   and (
     char_length(btrim(operator_name)) < 2
     or lower(btrim(operator_name)) in (
       'opérateur non renseigné', 'operateur non renseigne',
       'non renseigné', 'non renseigne', 'inconnu', 'unknown', 'n/a', 'na', '-'
     )
   );

update parcel_audits
   set operator_eori = null
 where operator_eori is not null
   and (
     operator_eori !~ '^[A-Z]{2}[A-Z0-9]{1,15}$'
     or operator_eori like 'XX%'
     or operator_eori ~ '^[A-Z]{2}0+$'
   );

update parcel_audits
   set operator_country = null
 where operator_country is not null
   and (
     operator_country !~ '^[A-Z]{2}$'
     or operator_country = 'XX'
   );

-- 3. Interdiction, au niveau du moteur, de réintroduire une valeur fictive.
--    Le contrôle applicatif peut être contourné par une route oubliée ; une
--    contrainte de table, non.
alter table parcel_audits drop constraint if exists parcel_audits_identite_operateur_valide;
alter table parcel_audits add constraint parcel_audits_identite_operateur_valide check (
  (
    operator_name is null
    or (
      char_length(btrim(operator_name)) between 2 and 200
      and lower(btrim(operator_name)) not in (
        'opérateur non renseigné', 'operateur non renseigne',
        'non renseigné', 'non renseigne', 'inconnu', 'unknown', 'n/a', 'na', '-'
      )
    )
  )
  and (
    operator_eori is null
    or (
      operator_eori ~ '^[A-Z]{2}[A-Z0-9]{1,15}$'
      and operator_eori not like 'XX%'
      and operator_eori !~ '^[A-Z]{2}0+$'
    )
  )
  and (
    operator_country is null
    or (operator_country ~ '^[A-Z]{2}$' and operator_country <> 'XX')
  )
);

comment on column parcel_audits.operator_name is
  'NULL = identité non déclarée. Jamais de nom fictif (contrainte 025).';
comment on column parcel_audits.operator_eori is
  'NULL = EORI non déclaré. Jamais de sentinelle XX… (contrainte 025).';
comment on column parcel_audits.operator_country is
  'NULL = pays non déclaré. Jamais de pays par défaut (contrainte 025).';

-- ---------------------------------------------------------------------------
-- 4. Produits : même règle, autre table.
-- ---------------------------------------------------------------------------
--   `gf_products.country_of_origin` portait `DEFAULT 'FR'`. Tout produit créé
--   sans pays devenait donc français, silencieusement.
alter table gf_products alter column country_of_origin drop default;
alter table gf_products alter column country_of_origin drop not null;

update gf_products
   set country_of_origin = upper(btrim(country_of_origin))
 where country_of_origin is not null
   and country_of_origin <> upper(btrim(country_of_origin));

update gf_products
   set country_of_origin = null
 where country_of_origin is not null
   and (country_of_origin !~ '^[A-Z]{2}$' or country_of_origin = 'XX');

alter table gf_products drop constraint if exists gf_products_country_of_origin_valide;
alter table gf_products add constraint gf_products_country_of_origin_valide check (
  country_of_origin is null
  or (country_of_origin ~ '^[A-Z]{2}$' and country_of_origin <> 'XX')
);

comment on column gf_products.country_of_origin is
  'NULL = origine non déclarée. Jamais de pays par défaut (contrainte 025).';
