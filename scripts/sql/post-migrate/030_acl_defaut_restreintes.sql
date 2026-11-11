-- P0 — les droits par défaut ne doivent jamais s'étendre aux tables héritées.
--
-- 010 est conservé pour compatibilité historique et accorde encore des droits
-- par défaut au rôle applicatif. Ce correctif post-migration annule ces ACL
-- pour le rôle qui exécute les migrations. Les droits des tables GeoForest
-- existantes sont vérifiés/réaccordés par le runner de migration ; les tables
-- hors schéma sont nettoyées séparément sous leur rôle propriétaire.
DO $droits$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geoforest_app') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM geoforest_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM geoforest_app';
    RAISE NOTICE 'ACL par défaut public : droits geoforest_app révoqués pour le rôle créateur courant';
  END IF;
END
$droits$;
