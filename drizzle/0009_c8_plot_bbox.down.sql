-- Retour arrière de C8 (cadre englobant des parcelles).
--
-- ⚠️ Aucune donnée n'est à reconstituer, et c'est délibéré.
--
--    Les quatre colonnes sont NULLABLES et ne portent aucune information
--    nouvelle : la borne se recalcule à partir de `geometry`, qui reste en
--    place. Les supprimer ne perd donc qu'un cache, jamais un fait.
--
--    Ce qu'on perd exactement : la détection de chevauchement redevient un
--    parcours complet des géométries à chaque saisie — c'est-à-dire lente, donc
--    en pratique désactivée. Le chevauchement n'était de toute façon pas
--    détecté avant C8.

alter table "gf_plots" drop column if exists "bbox_max_lat";--> statement-breakpoint
alter table "gf_plots" drop column if exists "bbox_max_lon";--> statement-breakpoint
alter table "gf_plots" drop column if exists "bbox_min_lat";--> statement-breakpoint
alter table "gf_plots" drop column if exists "bbox_min_lon";
