-- P0 — privilèges SQL strictement limités au schéma GeoForest.
--
-- 010 est historique et reste inchangé. Ce script, exécuté après lui à chaque
-- db:migrate, retire les droits des rôles propriétaires sur les objets hérités
-- et reconstruit une allowlist explicite. Aucune table ni donnée n'est supprimée.
--
-- Les objets hérités sont détenus par geoforest_migrator. PostgreSQL ne permet
-- pas à neondb_owner de révoquer directement les ACL accordées par ce rôle.
-- On endosse temporairement geoforest_migrator, sans laisser d'appartenance
-- persistante. Les options de membership préexistantes sont préservées.

DO $membership$
DECLARE
  can_set_role boolean;
  can_manage_roles boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geoforest_migrator') THEN
    RAISE EXCEPTION 'P0 RLS : rôle geoforest_migrator absent ; révocation sûre impossible.';
  END IF;

  SELECT rolsuper OR rolcreaterole INTO can_manage_roles
    FROM pg_roles WHERE rolname = current_user;
  IF NOT coalesce(can_manage_roles, false) THEN
    RAISE EXCEPTION 'P0 RLS : % ne peut pas endosser temporairement geoforest_migrator (CREATEROLE requis).', current_user;
  END IF;

  SELECT coalesce(bool_or(m.set_option), false)
    INTO can_set_role
    FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    JOIN pg_roles granted_role ON granted_role.oid = m.roleid
   WHERE member_role.rolname = session_user
     AND granted_role.rolname = 'geoforest_migrator';

  IF NOT can_set_role THEN
    EXECUTE format(
      'GRANT geoforest_migrator TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
      session_user
    );
    PERFORM set_config('geoforest.p0_added_migrator_membership', 'true', true);
  ELSE
    PERFORM set_config('geoforest.p0_added_migrator_membership', 'false', true);
  END IF;
END
$membership$;

SET ROLE geoforest_migrator;

-- Révoquer tous les droits accordés par le propriétaire historique, y compris
-- sur les tables sans organization_id et les séquences.
DO $migrator_acl$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
       AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM geoforest_app', obj.relname);
  END LOOP;

  FOR obj IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
       AND c.relkind = 'S'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %I FROM geoforest_app', obj.relname);
  END LOOP;

  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM geoforest_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM geoforest_app;
END
$migrator_acl$;

RESET ROLE;

-- Ne retirer que l'appartenance temporaire créée par ce script. Une éventuelle
-- appartenance antérieure accordée par un autre grantor reste intacte.
DO $restore_membership$
BEGIN
  IF current_setting('geoforest.p0_added_migrator_membership', true) = 'true' THEN
    EXECUTE format('REVOKE geoforest_migrator FROM %I', session_user);
  END IF;
END
$restore_membership$;

-- Révoquer ensuite les droits accordés par le rôle d'administration courant.
DO $admin_acl$
DECLARE
  obj record;
BEGIN
  FOR obj IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
       AND c.relkind IN ('r', 'p', 'v', 'm')
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM geoforest_app', obj.relname);
  END LOOP;

  FOR obj IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
       AND c.relkind = 'S'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %I FROM geoforest_app', obj.relname);
  END LOOP;

  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM geoforest_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL PRIVILEGES ON SEQUENCES FROM geoforest_app;
END
$admin_acl$;

GRANT USAGE ON SCHEMA public TO geoforest_app;
REVOKE CREATE ON SCHEMA public FROM geoforest_app;

-- Allowlist explicite : 14 tables, SELECT/INSERT/UPDATE, jamais DELETE/TRUNCATE.
GRANT SELECT, INSERT, UPDATE ON
  gf_organizations,
  gf_sessions,
  gf_login_attempts,
  gf_idempotence,
  gf_suppliers,
  gf_products,
  gf_shipments,
  gf_plots,
  gf_documents,
  gf_due_diligence_statements,
  gf_compliance_tasks,
  gf_audit_logs,
  gf_document_versions,
  parcel_audits
TO geoforest_app;

-- gf_users : écriture applicative, lecture limitée aux colonnes non secrètes.
GRANT INSERT, UPDATE ON gf_users TO geoforest_app;
GRANT SELECT (
  id, organization_id, email, name, role, status,
  created_at, updated_at, password_updated_at, token_version,
  last_login_at, failed_logins, locked_until
) ON gf_users TO geoforest_app;

-- Seule séquence applicative actuelle (journal d'audit).
GRANT USAGE, SELECT ON SEQUENCE gf_audit_logs_sequence_seq TO geoforest_app;

-- La vue de reprise reste consultable, mais non modifiable.
GRANT SELECT ON v_parcel_audits_identite TO geoforest_app;

-- Assertions bloquantes : un défaut de privilège fait échouer db:migrate.
DO $assertions$
DECLARE
  allowlist text[] := ARRAY[
    'gf_organizations','gf_users','gf_sessions','gf_login_attempts',
    'gf_idempotence','gf_suppliers','gf_products','gf_shipments','gf_plots',
    'gf_documents','gf_document_versions','gf_due_diligence_statements',
    'gf_compliance_tasks','gf_audit_logs','parcel_audits'
  ];
  fuite record;
BEGIN
  SELECT c.relname INTO fuite
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'v', 'm')
     AND c.relowner IN (
       (SELECT oid FROM pg_roles WHERE rolname = current_user),
       (SELECT oid FROM pg_roles WHERE rolname = 'geoforest_migrator')
     )
     AND NOT (c.relname = ANY(allowlist) OR c.relname = 'v_parcel_audits_identite')
     AND (
       has_table_privilege('geoforest_app', c.oid, 'SELECT')
       OR has_table_privilege('geoforest_app', c.oid, 'INSERT')
       OR has_table_privilege('geoforest_app', c.oid, 'UPDATE')
       OR has_table_privilege('geoforest_app', c.oid, 'DELETE')
       OR has_table_privilege('geoforest_app', c.oid, 'TRUNCATE')
     )
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'P0 RLS : geoforest_app conserve un privilège inattendu sur public.%', fuite.relname;
  END IF;

  IF has_table_privilege('geoforest_app', 'public.gf_users', 'SELECT') THEN
    RAISE EXCEPTION 'P0 RLS : SELECT table-level interdit sur gf_users.';
  END IF;
  IF has_column_privilege('geoforest_app', 'public.gf_users', 'password_hash', 'SELECT')
     OR has_column_privilege('geoforest_app', 'public.gf_users', 'mfa_secret', 'SELECT')
     OR has_column_privilege('geoforest_app', 'public.gf_users', 'mfa_recovery_codes', 'SELECT') THEN
    RAISE EXCEPTION 'P0 RLS : une colonne sensible de gf_users reste lisible.';
  END IF;
  IF NOT has_column_privilege('geoforest_app', 'public.gf_users', 'email', 'SELECT') THEN
    RAISE EXCEPTION 'P0 RLS : gf_users.email doit rester lisible.';
  END IF;
  IF has_table_privilege('geoforest_app', 'public.gf_audit_logs', 'DELETE')
     OR has_table_privilege('geoforest_app', 'public.gf_audit_logs', 'TRUNCATE') THEN
    RAISE EXCEPTION 'P0 RLS : le journal d''audit ne doit pas être destructible.';
  END IF;
  IF has_table_privilege('geoforest_app', 'public.v_parcel_audits_identite', 'INSERT')
     OR has_table_privilege('geoforest_app', 'public.v_parcel_audits_identite', 'UPDATE')
     OR has_table_privilege('geoforest_app', 'public.v_parcel_audits_identite', 'DELETE') THEN
    RAISE EXCEPTION 'P0 RLS : v_parcel_audits_identite doit rester en lecture seule.';
  END IF;
END
$assertions$;
