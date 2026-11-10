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
    'gf_documents','gf_document_versions','gf_due_diligence_statements','gf_compliance_tasks','gf_audit_logs',
    'gf_idempotence',
    'parcel_audits'
  ];
begin
  foreach t in array tables
  loop
    execute format('alter table %I enable row level security', t);
    -- ⚠️ Sans `force`, la RLS est ignorée pour le **propriétaire** de la
    --   table : une application qui se connecterait avec le rôle propriétaire
    --   verrait toutes les organisations. Avec `force`, le propriétaire est
    --   soumis aux politiques comme n'importe qui.
    --   ⚠️ Ce que `force` ne fait pas : un rôle portant `BYPASSRLS` — c'est
    --   le cas de `neondb_owner` sur Neon — contourne la RLS même forcée,
    --   mesure du 02/10/2026. Le cloisonnement ne tient donc que si
    --   l'application se connecte avec un rôle sans `BYPASSRLS` : c'est ce
    --   que contrôle `src/db/controle-role.ts` au démarrage du serveur.
    execute format('alter table %I force row level security', t);
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

-- ---------------------------------------------------------------------------
-- Rôle applicatif : créé ici, configuré hors dépôt
-- ---------------------------------------------------------------------------
/**
 * ⚠️ P1-10b — pourquoi il n'y a AUCUN mot de passe dans ce fichier.
 *
 * Ce script créait le rôle ainsi :
 *     create role geoforest_app login password '…en clair…';
 * La valeur est volontairement expurgée de ce commentaire : la recopier
 * reviendrait à la publier une seconde fois. Le dépôt est public, donc le
 * mot de passe du rôle applicatif — celui avec lequel l'application se
 * connecte à la base — l'a été, et il demeure dans l'historique git.
 *
 * Deux conséquences, aucune n'étant négociable :
 *   1. ce mot de passe est désormais considéré comme **public** : il est
 *      changé à la main sur chaque environnement (docs/DEPLOYMENT_VERCEL.md,
 *      § « Rôle applicatif »). Une rotation rend la fuite sans effet ;
 *      effacer la ligne ne l'aurait pas retirée de l'historique ;
 *   2. un secret ne s'écrit jamais dans un fichier versionné. Le rôle est
 *      donc créé **sans mot de passe et sans capacité de connexion** : en
 *      développement l'application se connecte en superutilisateur, et sur
 *      les environnements hébergés le mot de passe est posé par
 *      l'exploitant, une seule fois, avec `alter role … password '…'`.
 */
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'geoforest_app') then
    create role geoforest_app nologin;
  end if;

  -- ⚠️ Un rôle qui porte l'attribut `BYPASSRLS` contourne la RLS sur
  --   **toutes** les tables, y compris avec `force row level security` —
  --   mesuré sur PostgreSQL 18 le 02/10/2026. Le cloisonnement multi-tenant
  --   serait alors décoratif.
  --
  -- ⚠️ Mais `alter role … nobypassrls` exige que **l'auteur** de la commande
  --   porte lui-même `BYPASSRLS`, ou soit superutilisateur — mesuré sur
  --   PostgreSQL 16.2 le 19/10/2026, sur un rôle de migration propriétaire de
  --   la base, sans cet attribut :
  --       ERROR: permission denied to alter role
  --       DETAIL: Only roles with the BYPASSRLS attribute may change the
  --               BYPASSRLS attribute.
  --   L'instruction échouait donc **même quand le rôle applicatif n'avait déjà
  --   pas l'attribut**, c'est-à-dire dans le cas où il n'y avait rien à faire.
  --   Comme le script s'exécute en une seule transaction, l'échec annulait
  --   toute la post-migration — politiques RLS comprises — en laissant le
  --   schéma migré mais **non cloisonné**, et un simple `exit 1` pour seul
  --   signal. L'ordre n'est désormais exécuté que s'il y a réellement quelque
  --   chose à corriger ; l'invariant est ensuite **vérifié**, et son échec est
  --   franc. La garantie est identique, l'exigence de privilège disparaît.
  if exists (
    select 1 from pg_roles where rolname = 'geoforest_app' and rolbypassrls
  ) then
    execute 'alter role geoforest_app nobypassrls';
  end if;

  if exists (
    select 1 from pg_roles where rolname = 'geoforest_app' and rolbypassrls
  ) then
    raise exception
      'geoforest_app porte encore BYPASSRLS : le cloisonnement serait décoratif.';
  end if;
end $$;

-- ⚠️ Le nom de la base était écrit en dur (« app_db »). Le script s'exécute
--   après CHAQUE migration et sur CHAQUE environnement : sur Neon la base
--   s'appelle « neondb », et l'ordre échouait — constaté le 01/10/2026, la
--   migration s'arrêtait juste après l'application des six migrations, RLS
--   non posée. Le nom est donc résolu à l'exécution.
do $connexion$
begin
  execute format('grant connect on database %I to geoforest_app', current_database());
end $connexion$;
grant usage on schema public to geoforest_app;

-- ⚠️ Créer une table n'est pas un besoin de l'application : c'est le rôle
--   d'administration qui migre. Une application qui peut créer des tables
--   peut en créer hors de tout cloisonnement, et la RLS ne s'applique qu'aux
--   tables sur lesquelles elle a été posée.
revoke create on schema public from geoforest_app;

-- Droits courants : lire, créer, modifier. **Jamais** supprimer.
-- ⚠️ Ce script accordait INSERT, SELECT, UPDATE **et DELETE** sur toutes les
--   tables, `gf_organizations` et `gf_users` comprises : le rôle applicatif
--   pouvait détruire physiquement une organisation ou un compte. Constaté le
--   02/10/2026 sur l'environnement Neon. Le retrait de `DELETE` ci-dessous
--   porte sur toutes nos tables, sans liste : une liste s'oublie au premier
--   ajout, et c'est exactement ainsi que deux tables étaient passées au
--   travers.
grant select, insert, update on all tables in schema public to geoforest_app;
grant usage, select on all sequences in schema public to geoforest_app;

-- Mêmes droits pour les objets créés plus tard : sans ces deux ordres, une
-- table ajoutée au schéma serait invisible de l'application — ou lui rendrait
-- la suppression possible sans que personne ne l'ait décidé.
alter default privileges in schema public grant select, insert, update on tables to geoforest_app;
alter default privileges in schema public grant usage, select on sequences to geoforest_app;

-- ---------------------------------------------------------------------------
-- Colonnes d'authentification : hors de portée du rôle applicatif
-- ---------------------------------------------------------------------------
-- ⚠️ Défaut constaté le 19/10/2026, en recette PostgreSQL serveur.
--
--   `grant select, insert, update on all tables` porte sur la **table** : il
--   couvre donc toutes ses colonnes, y compris `password_hash`, `mfa_secret`
--   et `mfa_recovery_codes`. La RLS limitait bien la lecture à l'organisation
--   courante, mais elle ne limitait pas les **colonnes** : sous le rôle
--   applicatif, une injection SQL — même accidentelle — dans le contexte d'un
--   tenant pouvait lire les condensats de mot de passe et les secrets TOTP de
--   ses propres utilisateurs. C'est la même donnée que celle exposée par
--   `auth_user_by_email` (V10), à une autre échelle : un tenant au lieu de
--   tous, mais sans qu'aucun usage légitime ne le justifie.
--
--   Aucune requête applicative ne lit ces colonnes avec la connexion de
--   tenant : l'authentification, le MFA et le changement de mot de passe
--   passent tous par la connexion d'administration (`src/db/admin.ts`), parce
--   qu'ils ont lieu avant qu'une organisation ne soit connue. Vérifié par
--   recherche : chaque `from(users)` du dépôt importe `dbAdmin as db`.
--
--   Le privilège de table est donc retiré, puis remplacé par une liste
--   explicite de colonnes. Une colonne ajoutée plus tard ne sera **pas**
--   lisible par l'application tant que personne ne l'aura décidé : l'oubli
--   produit une erreur, pas une fuite. `select * from gf_users` échoue
--   désormais sous ce rôle — c'est voulu.
revoke select on gf_users from geoforest_app;
grant select (
  id, organization_id, email, name, role, status,
  created_at, updated_at, password_updated_at, token_version,
  last_login_at, failed_logins, locked_until
) on gf_users to geoforest_app;

grant execute on function current_org() to geoforest_app;
grant execute on function auth_user_by_email(text) to geoforest_app;
grant execute on function auth_user_by_id(uuid) to geoforest_app;

-- Aucune de nos tables ne doit rester destructible par l'application.
do $$
declare
  t text;
begin
  for t in
    select tablename
      from pg_tables
     where schemaname = 'public'
       and (tablename like 'gf\_%%' or tablename = 'parcel_audits')
  loop
    execute format('revoke delete, truncate on %I from geoforest_app', t);
  end loop;
end $$;

-- `gf_sessions` et `gf_login_attempts` : hors RLS (justification en tête de
-- fichier), mais soumises au même retrait de `DELETE` que les tables métier.
-- ⚠️ Le code les vidait par suppression : `clearLoginFailures()` exécutait un
--   `delete`. Sous le rôle applicatif, l'instruction aurait été refusée et la
--   **connexion aurait échoué**. Elle remet désormais le compteur à zéro
--   (`update`) ; le nettoyage des fenêtres périmées passe par
--   `scripts/purge-retention.ts`, seul habilité à supprimer.
revoke all on gf_sessions, gf_login_attempts from geoforest_app;
grant select, insert, update on gf_sessions, gf_login_attempts to geoforest_app;

-- ⚠️ `gf_idempotence` reste soumise au retrait de `DELETE`, comme toutes les
--   autres tables. Le mécanisme d'idempotence n'a donc **pas le droit de
--   supprimer** ses propres enregistrements : il périme la ligne par `update`
--   et reprend une place périmée par `insert … on conflict do update`, ce qui
--   est atomique et ne exige aucun droit de destruction. Une exception avait
--   été accordée le 04/10/2026 puis retirée le jour même : le contrôle de
--   démarrage (`scripts/controle-role.ts`) l'a refusée, à juste titre — la
--   règle « l'application ne peut rien détruire » ne souffre pas d'exception
--   tacite.

-- Journal de vérification
select c.relname as table, c.relrowsecurity as rls_active, c.relforcerowsecurity as forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
 order by 1;
