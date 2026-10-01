-- ---------------------------------------------------------------------------
-- P0-02 — Cloisonnement multi-tenant : RLS PostgreSQL
-- ---------------------------------------------------------------------------
-- Stratégie : chaque table métier porte organization_id (NOT NULL) ; une
-- politique unique n'autorise que les lignes de l'organisation posée dans
-- app.current_org pour la transaction en cours.
--
-- Failles volontairement exclues du périmètre RLS (et pourquoi) :
--   • gf_sessions, gf_login_attempts : infrastructure d'authentification,
--     interrogée AVANT qu'une organisation ne soit connue. Aucune route n'y
--     donne accès ; les jetons y sont stockés hachés.
--   • gf_users : soumise à la RLS, mais l'authentification passe par deux
--     fonctions SECURITY DEFINER très étroites (recherche par e-mail / par id).
-- ---------------------------------------------------------------------------

-- Fonction de contexte : NULL si non posée ⇒ politiques non satisfaites ⇒
-- aucune ligne visible. Le cloisonnement échoue donc fermé.
create or replace function current_org() returns uuid
  language sql stable as $$
  select nullif(current_setting('app.current_org', true), '')::uuid
$$;

-- Accès maîtrisé à gf_users hors contexte de tenant (connexion).
create or replace function auth_user_by_email(p_email text)
  returns gf_users
  language sql security definer set search_path = public, pg_temp as $$
  select * from gf_users where lower(email) = lower(p_email) limit 1
$$;

create or replace function auth_user_by_id(p_id uuid)
  returns gf_users
  language sql security definer set search_path = public, pg_temp as $$
  select * from gf_users where id = p_id limit 1
$$;

do $$
declare
  t text;
  tables text[] := array[
    'gf_organizations','gf_users','gf_suppliers','gf_products','gf_shipments','gf_plots',
    'gf_documents','gf_due_diligence_statements','gf_compliance_tasks','gf_audit_logs',
    'parcel_audits'
  ];
begin
  foreach t in array tables
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);

    if t = 'gf_organizations' then
      execute format($policy$
        create policy tenant_isolation on %I
          for all
          using (id = current_org())
          with check (id = current_org())
      $policy$, t);
    else
      execute format($policy$
        create policy tenant_isolation on %I
          for all
          using (organization_id = current_org() and current_org() is not null)
          with check (organization_id = current_org() and current_org() is not null)
      $policy$, t);
    end if;
  end loop;
end $$;

-- L'application se connecte avec un rôle non propriétaire :
-- la RLS s'applique donc à elle (elle est ignorée pour le propriétaire).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'geoforest_app') then
    create role geoforest_app login password 'geoforest_app_dev';
  end if;
end $$;

grant connect on database app_db to geoforest_app;
grant usage on schema public to geoforest_app;
grant select, insert, update, delete on all tables in schema public to geoforest_app;
grant usage, select on all sequences in schema public to geoforest_app;
alter default privileges in schema public grant select, insert, update, delete on tables to geoforest_app;

grant execute on function current_org() to geoforest_app;
grant execute on function auth_user_by_email(text) to geoforest_app;
grant execute on function auth_user_by_id(uuid) to geoforest_app;

revoke all on gf_sessions, gf_login_attempts from geoforest_app;
grant select, insert, update on gf_sessions, gf_login_attempts to geoforest_app;

-- Journal de vérification
select c.relname as table, c.relrowsecurity as rls_active, c.relforcerowsecurity as forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
 order by 1;
