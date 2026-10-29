-- ---------------------------------------------------------------------------
-- 024 — Une seule fenêtre par clé de cadence
-- ---------------------------------------------------------------------------
-- ⚠️ Défaut corrigé.
--
--   `gf_login_attempts.window_key` n'avait **aucune contrainte d'unicité**.
--   Le comptage se faisait en deux temps (lire, puis écrire) : deux requêtes
--   simultanées pouvaient insérer deux lignes pour la même clé, chacune
--   repartant de zéro. La limite se déclenchait alors plus tard que prévu —
--   voire jamais, si les essais étaient assez espacés pour retomber sur des
--   lignes différentes.
--
--   L'unicité permet désormais un comptage **atomique** en une seule
--   instruction : `insert … on conflict (window_key) do update`. PostgreSQL
--   sérialise les écritures sur la ligne, sans verrou applicatif et sans
--   transaction interactive — ce qui compte aussi pour les environnements où
--   une transaction ouverte immobilise la connexion.
--
--   Le dédoublonnage préalable est nécessaire : sur une base existante, la
--   création de l'index échouerait sur les clés déjà dupliquées. On conserve la
--   ligne la plus récente (celle qui porte le décompte en cours) et on cumule
--   son compteur avec celui des doublons, pour ne pas **alléger** une fenêtre
--   en cours de blocage — ce serait affaiblir une protection en la corrigeant.
-- ---------------------------------------------------------------------------

do $$
begin
  with cumul as (
    select window_key,
           max(last_attempt_at) as derniere,
           sum(attempts)::int    as total,
           min(first_attempt_at) as debut
      from gf_login_attempts
     group by window_key
    having count(*) > 1
  )
  update gf_login_attempts a
     set attempts = c.total,
         first_attempt_at = c.debut,
         last_attempt_at = c.derniere
    from cumul c
   where a.window_key = c.window_key
     and a.last_attempt_at = c.derniere;

  delete from gf_login_attempts a
   using gf_login_attempts b
   where a.window_key = b.window_key
     and a.ctid < b.ctid;
end $$;

create unique index if not exists uq_gf_login_attempts_cle
  on gf_login_attempts (window_key);

-- Contrôle : l'index doit exister et être unique, sinon le comptage atomique
-- retomberait silencieusement sur un comportement non garanti.
do $$
begin
  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'gf_login_attempts'
       and indexname = 'uq_gf_login_attempts_cle'
       and indexdef ilike '%unique%'
  ) then
    raise exception 'L''index unique sur gf_login_attempts(window_key) est absent.';
  end if;
end $$;
