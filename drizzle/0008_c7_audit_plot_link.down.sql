-- Retour arrière de C7 (lien analyse ↔ parcelle).
--
-- ⚠️ Aucune donnée n'est à combler, et c'est délibéré.
--
--    La colonne ajoutée est NULLABLE et n'a jamais eu de valeur par défaut :
--    supprimer la colonne ne perd donc que le lien, jamais un fait. Un retour
--    arrière qui écraserait `parcel_reference` pour reconstituer une
--    convention de nommage inventerait une information que la base n'a pas
--    eue.
--
--    Ce qu'on perd exactement : la possibilité de savoir sur quelle parcelle
--    une analyse a porté. `parcel_reference`, le texte libre saisi par
--    l'utilisateur, reste en place — il était déjà là avant, et il ne
--    désignait rien de vérifiable.

drop index if exists "idx_parcel_audits_plot";--> statement-breakpoint
alter table "parcel_audits" drop constraint if exists "fk_parcel_audits_plot_tenant";--> statement-breakpoint
alter table "parcel_audits" drop column if exists "plot_id";
