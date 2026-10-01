-- ---------------------------------------------------------------------------
-- P1-10 — Traçabilité opposable
-- ---------------------------------------------------------------------------
-- Trois propriétés, obtenues par la base elle-même et non par une convention
-- de code qu'une route pourrait oublier :
--
--   1. **le journal est append-only** — ni modification ni suppression, par
--      un déclencheur ET par une révocation de privilège ;
--   2. **le journal est inviolable de façon décelable** — chaque ligne porte
--      le condensat de la précédente ;
--   3. **aucune ligne métier n'est jamais détruite** — la suppression est
--      logique, et le privilège DELETE est retiré au rôle applicatif.
--
-- ⚠️ Pourquoi la base et pas seulement le code. Une règle qui n'existe que
--   dans le code est une règle qu'une nouvelle route peut ignorer sans que rien
--   ne le signale : le prochain `DELETE` écrit dans six mois effacera des
--   preuves, et personne ne le verra avant le contrôle. Ici, l'oubli produit
--   une erreur, pas un silence.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Chaîne de hachage
-- ---------------------------------------------------------------------------

/**
 * Condensat d'une ligne du journal.
 *
 * ⚠️ `details::text`, `avant::text` et `apres::text` sont employés
 * volontairement : la représentation textuelle d'un `jsonb` est canonique
 * (clés ordonnées, espaces normalisés), là où l'objet JSON lui-même ne
 * garantit pas l'ordre des clés. Un hachage calculé sur une sérialisation
 * non canonique différerait d'une lecture à l'autre, et la vérification
 * signalerait une altération qui n'a jamais eu lieu.
 */
create or replace function gf_audit_empreinte(r gf_audit_logs, p_precedent text)
  returns text
  language sql stable as $$
  select encode(
    sha256(convert_to(
      coalesce(p_precedent, '') || '|' ||
      r.sequence::text || '|' ||
      to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
      coalesce(r.organization_id::text, '') || '|' ||
      coalesce(r.user_email, '') || '|' ||
      coalesce(r.action, '') || '|' ||
      coalesce(r.entity_type, '') || '|' ||
      coalesce(r.entity_id, '') || '|' ||
      coalesce(r.details::text, '') || '|' ||
      coalesce(r.avant::text, '') || '|' ||
      coalesce(r.apres::text, '') || '|' ||
      coalesce(r.acteur_id::text, '') || '|' ||
      coalesce(r.request_id::text, ''),
      'UTF8')),
    'hex')
$$;

create or replace function gf_audit_chainer() returns trigger
  language plpgsql as $$
declare
  precedent text;
begin
  -- ⚠️ Verrou de transaction propre à l'organisation : deux écritures
  --   concurrentes liraient sinon le même « dernier condensat » et
  --   produiraient deux lignes se réclamant du même prédécesseur. La chaîne
  --   serait alors techniquement valide et sémantiquement fausse — le pire
  --   des deux mondes, car aucune vérification ne la détecterait.
  perform pg_advisory_xact_lock(hashtext('gf_audit_logs:' || coalesce(new.organization_id::text, '∅')));

  select hash into precedent
    from gf_audit_logs
   where organization_id is not distinct from new.organization_id
   order by sequence desc
   limit 1;

  new.hash_precedent := precedent;
  new.hash := gf_audit_empreinte(new, precedent);
  return new;
end $$;

drop trigger if exists trg_gf_audit_logs_chaine on gf_audit_logs;
create trigger trg_gf_audit_logs_chaine
  before insert on gf_audit_logs
  for each row execute function gf_audit_chainer();

-- ---------------------------------------------------------------------------
-- 2. Append-only
-- ---------------------------------------------------------------------------

create or replace function gf_audit_refuser_modification() returns trigger
  language plpgsql as $$
begin
  raise exception
    'Journal d''audit non modifiable : toute altération est interdite par construction (P1-10).'
    using errcode = '42501',
          hint = 'Une correction se consigne par une nouvelle ligne, jamais par une modification.';
end $$;

drop trigger if exists trg_gf_audit_logs_append_only on gf_audit_logs;
create trigger trg_gf_audit_logs_append_only
  before update or delete on gf_audit_logs
  for each row execute function gf_audit_refuser_modification();

-- ⚠️ Le déclencheur interdit la modification ; la révocation la rend
--   impossible même si le déclencheur venait à être désactivé. Les deux
--   niveaux sont volontairement redondants : une protection unique finit
--   toujours par être contournée, souvent par celui-là même qui l'a posée,
--   pour « faire passer une correction urgente ».
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'geoforest_app') then
    execute 'revoke update, delete on gf_audit_logs from geoforest_app';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Vérification de la chaîne
-- ---------------------------------------------------------------------------

/**
 * Vérifie la chaîne d'une organisation.
 *
 * Renvoie une ligne par anomalie. Une chaîne saine ne renvoie **rien** :
 * c'est un résultat vide qui est une bonne nouvelle, ce qui est suffisamment
 * rare pour être précisé.
 *
 * ⚠️ La vérification relit les condensats, elle ne les recalcule pas à
 *   l'identique par confiance : c'est précisément l'écart entre le condensat
 *   stocké et le condensat recalculé qui constitue la preuve d'altération.
 */
create or replace function verifier_chaine_audit(p_organization_id uuid)
  returns table (sequence bigint, anomalie text, attendu text, trouve text)
  language plpgsql as $$
declare
  -- ⚠️ `r` doit être du type de la table, pas `record` : `gf_audit_empreinte`
  --   attend une ligne `gf_audit_logs`, et PostgreSQL refuse de convertir un
  --   `record` en type composite nommé. L'erreur ne se voyait qu'à
  --   l'exécution, c'est-à-dire au premier contrôle — le pire moment.
  r gf_audit_logs;
  precedent_lu text := null;
begin
  for r in
    select * from gf_audit_logs
     where organization_id is not distinct from p_organization_id
     order by sequence
  loop
    if precedent_lu is distinct from r.hash_precedent then
      return query select r.sequence, 'rupture_de_chaine'::text,
                          coalesce(precedent_lu, '(aucun)'), coalesce(r.hash_precedent, '(aucun)');
    end if;
    if gf_audit_empreinte(r, r.hash_precedent) is distinct from r.hash then
      return query select r.sequence, 'ligne_altérée'::text,
                          coalesce(gf_audit_empreinte(r, r.hash_precedent), ''), coalesce(r.hash, '');
    end if;
    precedent_lu := r.hash;
  end loop;
end $$;

grant execute on function verifier_chaine_audit(uuid) to geoforest_app;

-- ---------------------------------------------------------------------------
-- 4. Suppression logique — le produit ne voit plus les lignes effacées
-- ---------------------------------------------------------------------------

/**
 * Politique de cloisonnement, complétée : une ligne marquée supprimée n'est
 * plus visible par l'application.
 *
 * ⚠️ Le filtre est posé **dans la politique RLS** et non dans les requêtes.
 *   Un filtre écrit dans chaque requête finit par en oublier une — et c'est
 *   justement la requête oubliée qui affichera un fournisseur effacé dans un
 *   total. Ici, l'oubli est impossible.
 *
 * ⚠️ Corollaire assumé : l'application ne peut plus relire une ligne
 *   supprimée. Ce n'est pas une limitation, c'est la propriété cherchée. La
 *   purge et les contrôles passent par le rôle d'administration.
 */
do $$
declare
  t text;
  tables text[] := array[
    'gf_suppliers','gf_products','gf_shipments','gf_plots',
    'gf_documents','gf_due_diligence_statements','gf_compliance_tasks'
  ];
begin
  foreach t in array tables
  loop
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($p$
      create policy tenant_isolation on %I
        for all
        using (organization_id = current_org() and current_org() is not null and deleted_at is null)
        with check (organization_id = current_org() and current_org() is not null)
    $p$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Aucune destruction physique
-- ---------------------------------------------------------------------------

/**
 * Le rôle applicatif perd le droit de supprimer physiquement une ligne métier.
 *
 * ⚠️ Une preuve détruite ne se reconstitue pas : ni le journal, ni la chaîne
 *   de hachage, ni une sauvegarde ne rendent une ligne effacée par
 *   l'application. Le retrait du privilège transforme une erreur de code en
 *   erreur de base — bruyante, immédiate, et impossible à ignorer.
 *
 * ⚠️ Ce que ce retrait ne fait PAS : il n'empêche pas la purge légale. Celle-
 *   ci s'exécute avec le rôle d'administration (`scripts/purge-retention.ts`),
 *   hors du périmètre applicatif, et elle est elle-même journalisée.
 */
do $$
declare
  t text;
  tables text[] := array[
    'gf_suppliers','gf_products','gf_shipments','gf_plots','gf_documents',
    'gf_due_diligence_statements','gf_compliance_tasks','gf_document_versions','parcel_audits'
  ];
begin
  if exists (select 1 from pg_roles where rolname = 'geoforest_app') then
    foreach t in array tables
    loop
      execute format('revoke delete on %I from geoforest_app', t);
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Amorçage de la chaîne sur l'historique existant
-- ---------------------------------------------------------------------------

/**
 * Rejoue la chaîne sur les lignes écrites avant cette migration.
 *
 * ⚠️ Sans ce rejeu, l'historique resterait non chaîné : la vérification
 *   signalerait des centaines d'anomalies,on prendrait l'habitude de les voir,
 *   et le jour où une altération réelle surviendrait elle se fondrait dans le
 *   bruit. Une alerte qu'on a appris à ignorer ne protège plus de rien.
 *
 * ⚠️ Le déclencheur d'interdiction de modification est désactivé le temps de
 *   l'opération. C'est la seule porte de sortie volontaire, et elle est
 *   explicitement réservée à cette migration, exécutée par l'administrateur :
 *   le role applicatif, lui, reste privé du droit de mise à jour.
 */
do $$
declare
  r record;
  precedent text := null;
begin
  if not exists (select 1 from gf_audit_logs where hash is null) then
    return;
  end if;

  alter table gf_audit_logs disable trigger trg_gf_audit_logs_append_only;

  for r in
    select id from gf_audit_logs order by organization_id nulls first, sequence
  loop
    update gf_audit_logs l
       set hash_precedent = precedent,
           hash = gf_audit_empreinte(l, precedent)
     where l.id = r.id;
    select hash into precedent from gf_audit_logs where id = r.id;
  end loop;

  alter table gf_audit_logs enable trigger trg_gf_audit_logs_append_only;

  raise notice 'Chaîne d''audit amorcée sur % ligne(s) d''historique.',
    (select count(*) from gf_audit_logs);
end $$;

-- ---------------------------------------------------------------------------
-- Journal de vérification
-- ---------------------------------------------------------------------------
select c.relname as table,
       c.relrowsecurity as rls_active,
       (select count(*) from pg_trigger tg where tg.tgrelid = c.oid and not tg.tgisinternal) as declencheurs
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
 order by 1;
