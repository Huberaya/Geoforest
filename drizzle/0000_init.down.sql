-- ---------------------------------------------------------------------------
-- P1-04 — Migration descendante de la migration initiale
-- ---------------------------------------------------------------------------
-- Convention : `drizzle/<tag>.sql` descend, `drizzle/<tag>.down.sql` remonte.
-- `npm run db:rollback` applique la descendante de la dernière migration
-- enregistrée, puis la désenregistre.
--
-- ⚠️ Une migration descendante n'est PAS une sauvegarde : elle supprime les
-- tables et leur contenu. La procédure de retour arrière en production est
-- d'abord une restauration de sauvegarde, la migration descendante ne servant
-- qu'à remettre le schéma en cohérence avec la version de code redéployée.
-- ---------------------------------------------------------------------------

drop table if exists "parcel_audits" cascade;
drop table if exists "gf_audit_logs" cascade;
drop table if exists "gf_compliance_tasks" cascade;
drop table if exists "gf_due_diligence_statements" cascade;
drop table if exists "gf_documents" cascade;
drop table if exists "gf_plots" cascade;
drop table if exists "gf_shipments" cascade;
drop table if exists "gf_products" cascade;
drop table if exists "gf_suppliers" cascade;
drop table if exists "gf_login_attempts" cascade;
drop table if exists "gf_sessions" cascade;
drop table if exists "gf_users" cascade;
drop table if exists "gf_organizations" cascade;

-- Fonctions et rôle créés par le script de cloisonnement : la remontée d'une
-- base vide doit laisser un schéma public réellement vide.
drop function if exists auth_user_by_email(text) cascade;
drop function if exists auth_user_by_id(uuid) cascade;
drop function if exists current_org() cascade;
