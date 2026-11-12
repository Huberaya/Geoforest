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
  SELECT rolsuper OR rolcreaterole INTO can_manage_roles
    FROM pg_roles WHERE rolname = current_user;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geoforest_migrator') THEN
    IF NOT coalesce(can_manage_roles, false) THEN
      RAISE EXCEPTION
        'P0 RLS : % ne peut pas créer le rôle technique geoforest_migrator (CREATEROLE requis).',
        current_user;
    END IF;
    -- Base vierge : créer un rôle technique sans connexion. Il ne reçoit
    -- aucun privilège applicatif et reste sans membre après ce script.
    EXECUTE 'CREATE ROLE geoforest_migrator NOLOGIN';
    PERFORM set_config('geoforest.p0_created_migrator_role', 'true', true);
  ELSE
    PERFORM set_config('geoforest.p0_created_migrator_role', 'false', true);
  END IF;
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

-- PostGIS est fourni par Neon (propriétaire cloud_admin, grantor neon_superuser).
-- Retirer les droits d'écriture hérités sans casser les lectures de référence :
-- PUBLIC conserve SELECT sur spatial_ref_sys / geometry_columns / geography_columns.
-- Neon interdit SET ROLE vers neon_superuser : les rôles administrateurs
-- héritent néanmoins de ses privilèges WITH GRANT OPTION. PostgreSQL permet
-- donc au membre d'effectuer REVOKE, enregistré sous le grantor détenteur.
DO $postgis_acl$
DECLARE
  obj record;
BEGIN
  IF to_regrole('neon_superuser') IS NOT NULL THEN
    FOR obj IN
      SELECT DISTINCT c.relname, c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(
          CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END,
          c.relowner
        ))) a
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
         AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'geoforest_app')
         AND a.grantor = (SELECT oid FROM pg_roles WHERE rolname = 'neon_superuser')
    LOOP
      IF obj.relkind = 'S' THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE %I FROM geoforest_app', obj.relname);
      ELSE
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM geoforest_app', obj.relname);
      END IF;
    END LOOP;
  END IF;
END
$postgis_acl$;

GRANT USAGE ON SCHEMA public TO geoforest_app;
REVOKE CREATE ON SCHEMA public FROM geoforest_app;

-- Allowlist explicite : 14 tables métier, SELECT/INSERT/UPDATE, jamais DELETE/TRUNCATE.
-- gf_sessions reste exclusivement accessible à la connexion d'administration :
-- tous les usages applicatifs passent par dbAdmin. gf_login_attempts est global
-- (hors RLS), mais ses droits sont limités aux quatre colonnes du compteur.
GRANT SELECT, INSERT, UPDATE ON
  gf_organizations,
  gf_idempotence,
  gf_suppliers,
  gf_products,
  gf_shipments,
  gf_plots,
  gf_documents,
  gf_due_diligence_statements,
  gf_compliance_tasks,
  gf_document_versions,
  parcel_audits
TO geoforest_app;

-- Cadence globale de connexion : droits limités aux colonnes strictement utilisées.
REVOKE ALL PRIVILEGES ON gf_login_attempts FROM geoforest_app;
GRANT SELECT (window_key, attempts, first_attempt_at, last_attempt_at),
      INSERT (window_key, attempts, first_attempt_at, last_attempt_at),
      UPDATE (attempts, first_attempt_at, last_attempt_at)
  ON gf_login_attempts TO geoforest_app;

-- Le journal est append-only : ne jamais réaccorder UPDATE après 020.
GRANT SELECT, INSERT ON gf_audit_logs TO geoforest_app;

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
    'gf_organizations','gf_users','gf_login_attempts',
    'gf_idempotence','gf_suppliers','gf_products','gf_shipments','gf_plots',
    'gf_documents','gf_document_versions','gf_due_diligence_statements',
    'gf_compliance_tasks','gf_audit_logs','parcel_audits',
    'gf_audit_logs_sequence_seq'
  ];
  fuite record;
BEGIN
  SELECT c.relname INTO fuite
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
     AND NOT (
       c.relname = ANY(allowlist)
       OR c.relname = 'v_parcel_audits_identite'
       OR c.relname IN ('spatial_ref_sys', 'geometry_columns', 'geography_columns')
     )
     AND (
       has_table_privilege('geoforest_app', c.oid, 'SELECT')
       OR has_table_privilege('geoforest_app', c.oid, 'INSERT')
       OR has_table_privilege('geoforest_app', c.oid, 'UPDATE')
       OR has_table_privilege('geoforest_app', c.oid, 'DELETE')
       OR has_table_privilege('geoforest_app', c.oid, 'TRUNCATE')
       OR has_table_privilege('geoforest_app', c.oid, 'REFERENCES')
       OR has_table_privilege('geoforest_app', c.oid, 'TRIGGER')
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
  -- Les sessions ne sont utilisées que par la connexion d'administration.
  IF has_table_privilege('geoforest_app', 'public.gf_sessions', 'SELECT')
     OR has_table_privilege('geoforest_app', 'public.gf_sessions', 'INSERT')
     OR has_table_privilege('geoforest_app', 'public.gf_sessions', 'UPDATE')
     OR has_table_privilege('geoforest_app', 'public.gf_sessions', 'DELETE')
     OR has_table_privilege('geoforest_app', 'public.gf_sessions', 'TRUNCATE')
     OR has_table_privilege('geoforest_app', 'public.gf_sessions', 'REFERENCES')
     OR has_table_privilege('geoforest_app', 'public.gf_sessions', 'TRIGGER') THEN
    RAISE EXCEPTION 'P0 RLS : gf_sessions doit rester inaccessible au rôle applicatif.';
  END IF;

  -- Le compteur global n'expose que les colonnes nécessaires à l'UPSERT atomique.
  IF has_table_privilege('geoforest_app', 'public.gf_login_attempts', 'SELECT')
     OR has_table_privilege('geoforest_app', 'public.gf_login_attempts', 'INSERT')
     OR has_table_privilege('geoforest_app', 'public.gf_login_attempts', 'UPDATE')
     OR has_table_privilege('geoforest_app', 'public.gf_login_attempts', 'DELETE')
     OR has_table_privilege('geoforest_app', 'public.gf_login_attempts', 'TRUNCATE')
     OR has_table_privilege('geoforest_app', 'public.gf_login_attempts', 'REFERENCES')
     OR has_table_privilege('geoforest_app', 'public.gf_login_attempts', 'TRIGGER')
     OR has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'id', 'SELECT')
     OR has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'id', 'INSERT')
     OR has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'window_key', 'UPDATE') THEN
    RAISE EXCEPTION 'P0 RLS : gf_login_attempts expose des droits plus larges que les colonnes du compteur.';
  END IF;
  IF NOT has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'window_key', 'SELECT')
     OR NOT has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'window_key', 'INSERT')
     OR NOT has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'attempts', 'SELECT')
     OR NOT has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'attempts', 'INSERT')
     OR NOT has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'attempts', 'UPDATE')
     OR NOT has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'first_attempt_at', 'SELECT')
     OR NOT has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'first_attempt_at', 'INSERT')
     OR NOT has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'first_attempt_at', 'UPDATE')
     OR NOT has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'last_attempt_at', 'SELECT')
     OR NOT has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'last_attempt_at', 'INSERT')
     OR NOT has_column_privilege('geoforest_app', 'public.gf_login_attempts', 'last_attempt_at', 'UPDATE') THEN
    RAISE EXCEPTION 'P0 RLS : les droits minimaux de cadence sont incomplets.';
  END IF;

  -- Les objets de référence PostGIS peuvent rester lisibles, jamais modifiables.
  IF to_regclass('public.spatial_ref_sys') IS NOT NULL AND (
    NOT has_table_privilege('geoforest_app', 'public.spatial_ref_sys', 'SELECT')
    OR has_table_privilege('geoforest_app', 'public.spatial_ref_sys', 'INSERT')
    OR has_table_privilege('geoforest_app', 'public.spatial_ref_sys', 'UPDATE')
    OR has_table_privilege('geoforest_app', 'public.spatial_ref_sys', 'DELETE')
    OR has_table_privilege('geoforest_app', 'public.spatial_ref_sys', 'TRUNCATE')
  ) THEN
    RAISE EXCEPTION 'P0 RLS : spatial_ref_sys doit être en lecture seule.';
  END IF;
  IF to_regclass('public.geometry_columns') IS NOT NULL AND (
    NOT has_table_privilege('geoforest_app', 'public.geometry_columns', 'SELECT')
    OR has_table_privilege('geoforest_app', 'public.geometry_columns', 'INSERT')
    OR has_table_privilege('geoforest_app', 'public.geometry_columns', 'UPDATE')
    OR has_table_privilege('geoforest_app', 'public.geometry_columns', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'P0 RLS : geometry_columns doit être en lecture seule.';
  END IF;
  IF to_regclass('public.geography_columns') IS NOT NULL AND (
    NOT has_table_privilege('geoforest_app', 'public.geography_columns', 'SELECT')
    OR has_table_privilege('geoforest_app', 'public.geography_columns', 'INSERT')
    OR has_table_privilege('geoforest_app', 'public.geography_columns', 'UPDATE')
    OR has_table_privilege('geoforest_app', 'public.geography_columns', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'P0 RLS : geography_columns doit être en lecture seule.';
  END IF;

  IF NOT has_sequence_privilege('geoforest_app', 'public.gf_audit_logs_sequence_seq', 'USAGE')
     OR NOT has_sequence_privilege('geoforest_app', 'public.gf_audit_logs_sequence_seq', 'SELECT')
     OR has_sequence_privilege('geoforest_app', 'public.gf_audit_logs_sequence_seq', 'UPDATE') THEN
    RAISE EXCEPTION 'P0 RLS : la séquence du journal doit être USAGE/SELECT uniquement.';
  END IF;

  IF has_table_privilege('geoforest_app', 'public.gf_audit_logs', 'UPDATE')
     OR has_table_privilege('geoforest_app', 'public.gf_audit_logs', 'DELETE')
     OR has_table_privilege('geoforest_app', 'public.gf_audit_logs', 'TRUNCATE') THEN
    RAISE EXCEPTION 'P0 RLS : le journal d''audit doit rester strictement append-only.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
     WHERE n.nspname = 'public'
       AND d.defaclacl::text LIKE '%geoforest_app%'
  ) THEN
    RAISE EXCEPTION 'P0 RLS : un privilège par défaut accorde encore des droits à geoforest_app.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(allowlist) AS t(table_name)
     WHERE has_table_privilege('geoforest_app', format('public.%I', t.table_name), 'DELETE')
        OR has_table_privilege('geoforest_app', format('public.%I', t.table_name), 'TRUNCATE')
  ) THEN
    RAISE EXCEPTION 'P0 RLS : une table de l''allowlist reste destructible par geoforest_app.';
  END IF;
  IF has_table_privilege('geoforest_app', 'public.v_parcel_audits_identite', 'INSERT')
     OR has_table_privilege('geoforest_app', 'public.v_parcel_audits_identite', 'UPDATE')
     OR has_table_privilege('geoforest_app', 'public.v_parcel_audits_identite', 'DELETE') THEN
    RAISE EXCEPTION 'P0 RLS : v_parcel_audits_identite doit rester en lecture seule.';
  END IF;
END
$assertions$;
