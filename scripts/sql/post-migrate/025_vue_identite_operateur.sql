-- Lot A — la vue de reprise `v_parcel_audits_identite` est en LECTURE SEULE.
--
-- Pourquoi ce fichier existe, et pourquoi il est séparé de `010`.
--
-- `010_row_level_security.sql` accorde `select, insert, update on all tables`
-- au rôle applicatif. Une vue est traitée comme une table par ce `GRANT
-- … ON ALL TABLES` : `geoforest_app` reçoit donc INSERT et UPDATE sur une vue
-- qui n'est pas modifiable. L'erreur n'apparaîtrait qu'à l'exécution, chez
-- l'appelant, au lieu d'échouer à la conception.
--
-- 010 est un script **publié et déjà appliqué** : le modifier reviendrait à
-- changer rétroactivement ce qui a tourné sur les environnements existants.
-- Ce fichier est donc un ajout, appliqué après, et idempotent : il révoque des
-- droits et ne touche à aucune donnée.
--
-- ⚠️ `security_invoker = true` (posé par la migration 0009) est indispensable
-- au même titre : sans lui, la vue s'exécuterait avec les droits de son
-- propriétaire et **contournerait la RLS** de `parcel_audits`.
DO $vue$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views
     WHERE schemaname = 'public' AND viewname = 'v_parcel_audits_identite'
  ) AND EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'geoforest_app'
  ) THEN
    EXECUTE 'revoke insert, update, delete, truncate on v_parcel_audits_identite from geoforest_app';
    RAISE NOTICE 'v_parcel_audits_identite : droits d''écriture révoqués à geoforest_app';
  ELSE
    RAISE NOTICE 'v_parcel_audits_identite ou geoforest_app absent : rien à révoquer';
  END IF;
END $vue$;
