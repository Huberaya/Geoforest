-- ---------------------------------------------------------------------------
-- 023 — Retrait des fonctions d'authentification du rôle applicatif
-- ---------------------------------------------------------------------------
-- ⚠️ Défaut corrigé, mesuré le 19/10/2026 sur le schéma réel.
--
--   `010_row_level_security.sql` crée deux fonctions `SECURITY DEFINER` :
--
--     auth_user_by_email(text) → gf_users
--     auth_user_by_id(uuid)    → gf_users
--
--   Elles renvoient la **ligne entière** de `gf_users`, donc le condensat de
--   mot de passe, le secret TOTP et les condensats des codes de secours. Étant
--   `SECURITY DEFINER`, elles s'exécutent avec les droits du propriétaire et
--   **échappent à la RLS** : depuis le rôle applicatif, dans le contexte d'une
--   organisation, `auth_user_by_email('autre@exemple.test')` renvoyait la ligne
--   d'un compte d'une autre organisation.
--
--   Aucune route ne les appelle : l'authentification passe par la connexion
--   d'administration (`src/db/admin.ts`), justement parce qu'elle a lieu avant
--   qu'une organisation ne soit connue. Ces fonctions n'étaient donc qu'une
--   surface d'attaque : toute injection SQL, même accidentelle, devenait une
--   lecture inter-tenant des identifiants.
--
--   Comme PostgreSQL accorde `EXECUTE` à `PUBLIC` par défaut sur toute
--   fonction, il ne suffit pas de ne pas les accorder : il faut les retirer.
--
-- Ce que cela ne casse pas : la connexion, qui n'emprunte pas ces fonctions.
-- Ce que cela protège : le rôle applicatif ne peut plus lire les secrets d'un
--   compte, ni franchir le cloisonnement par une fonction privilégiée.
-- ---------------------------------------------------------------------------

revoke all on function auth_user_by_email(text) from public;
revoke all on function auth_user_by_email(text) from geoforest_app;

revoke all on function auth_user_by_id(uuid) from public;
revoke all on function auth_user_by_id(uuid) from geoforest_app;

-- Contrôle : les fonctions doivent rester appelables par le propriétaire (la
-- connexion d'administration), sinon l'authentification serait cassée.
do $$
begin
  if not has_function_privilege(current_user, 'auth_user_by_email(text)', 'execute') then
    raise exception 'auth_user_by_email n''est plus exécutable par le rôle d''administration.';
  end if;
  if exists (
    select 1
      from information_schema.routine_privileges
     where routine_schema = 'public'
       and routine_name in ('auth_user_by_email', 'auth_user_by_id')
       and grantee in ('PUBLIC', 'geoforest_app')
  ) then
    raise exception 'Une fonction d''authentification reste accessible à un rôle non prévu.';
  end if;
end $$;
