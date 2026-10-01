-- ===========================================================================
-- 022 — Politiques RLS et suppression logique : le cloisonnement empêchait
--       de marquer une ligne supprimée
--
-- ⚠️ Défaut constaté sur l'instance, pas supposé.
--   Le chantier P1-10 a remplacé la politique de cloisonnement par une
--   politique unique `for all` portant `deleted_at is null` dans sa clause
--   `using`. Conséquence mesurée : toute tentative de marquer une ligne
--   supprimée échouait —
--
--       ERROR:  new row violates row-level security policy for table "gf_documents"
--
--   et `DELETE /api/v1/documents/:id` répondait donc **500**. La suppression
--   logique était impossible, alors que tous les autres contrôles du chantier
--   étaient au vert : `verifier_chaine_audit` rendait 0 anomalie, le
--   déclencheur append-only refusait bien les modifications, et le rôle
--   applicatif n'avait plus le droit de suppression. Aucun de ces contrôles
--   n'exerçait le seul chemin qui comptait : marquer une ligne.
--
-- ⚠️ Mécanisme, établi par reproduction minimale sur PostgreSQL 17.11.
--   Lors d'un `UPDATE`, PostgreSQL applique à la **nouvelle** ligne non
--   seulement la clause `with check` des politiques `for update`, mais
--   **aussi la clause `using` des politiques `for select`**. Verifié :
--     · `select` avec `deleted_at is null` + `update` quelles que soient ses
--       clauses        → ÉCHEC, y compris avec `with check (true)` ;
--     · `select` sans  `deleted_at`        + `update` avec `deleted_at is null`
--       dans `using`   → SUCCÈS ;
--     · déclencheur `before update` écrivant `deleted_at` → ÉCHEC également :
--       le contrôle porte sur la ligne après déclencheur.
--   Autrement dit : **une politique qui masque les lignes effacées interdit
--   de les effacer.** Le cloisonnement et la suppression logique ont des
--   besoins contradictoires qu'aucune combinaison de politiques ne peut
--   satisfaire — il faut écrire la marque par une voie qui n'est pas soumise
--   à ces politiques.
--
-- ⚠️ Solution retenue, et pourquoi celle-là.
--   Une fonction `security definer`, qui s'exécute avec les droits du
--   propriétaire et n'est donc pas soumise à la sécurité par ligne sur ces
--   tables. Elle rétablit elle-même, explicitement, le cloisonnement que la
--   sécurité par ligne ne peut plus contrôler : la ligne n'est marquée que si
--   son organisation est celle du contexte. C'est le prix de la solution, et
--   il est assumé : la garantie quitte le moteur pour entrer dans dix lignes
--   de SQL relues et éprouvées — au lieu d'être perdue.
--
--   Deux autres voies ont été écartées après essai :
--     · filtrer les lignes effacées dans l'application — une requête finit
--       toujours par oublier la clause, et c'est justement celle-là qui
--       affichera un fournisseur effacé dans un total ;
--     · renommer chaque table et exposer une vue filtrante du même nom —
--       correct, mais au prix d'un renommage de sept tables et d'un schéma
--       applicatif qui ne manipule plus des tables.
--
-- Application :
--   psql "$DATABASE_URL_ADMIN" -f scripts/sql/post-migrate/022_politiques_suppression_logique.sql
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Une politique par commande
--
-- ⚠️ La politique `for all` est remplacée par quatre politiques distinctes,
--   non parce que `for all` était en cause — l'essai l'a montré, une
--   politique `for update` seule échoue pareillement — mais parce que les
--   quatre commandes n'ont pas le même besoin, et que les confondre a
--   précisément empêché de voir le défaut.
-- ---------------------------------------------------------------------------
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
    execute format('drop policy if exists tenant_isolation_lecture on %I', t);
    execute format('drop policy if exists tenant_isolation_ecriture on %I', t);
    execute format('drop policy if exists tenant_isolation_maj on %I', t);
    execute format('drop policy if exists tenant_isolation_retrait on %I', t);

    -- Lire : une ligne effacée n'existe plus.
    execute format($p$
      create policy tenant_isolation_lecture on %I
        for select
        using (organization_id = current_org()
               and current_org() is not null
               and deleted_at is null)$p$, t);

    -- Créer : dans son organisation, et nulle part ailleurs.
    execute format($p$
      create policy tenant_isolation_ecriture on %I
        for insert
        with check (organization_id = current_org()
                    and current_org() is not null)$p$, t);

    -- Modifier : la ligne doit être vivante AVANT — on ne ranime pas une ligne
    -- supprimée — et rester dans l'organisation APRÈS.
    execute format($p$
      create policy tenant_isolation_maj on %I
        for update
        using (organization_id = current_org()
               and current_org() is not null
               and deleted_at is null)
        with check (organization_id = current_org()
                    and current_org() is not null)$p$, t);

    -- Supprimer physiquement : interdit par ailleurs (privilège révoqué en
    -- 020), et de toute façon borné aux lignes vivantes.
    execute format($p$
      create policy tenant_isolation_retrait on %I
        for delete
        using (organization_id = current_org()
               and current_org() is not null
               and deleted_at is null)$p$, t);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Marquer une ligne supprimée — la seule voie d'écriture de `deleted_at`
-- ---------------------------------------------------------------------------
create or replace function gf_marquer_suppression(
  p_table regclass,
  p_id uuid,
  p_acteur text default 'systeme'
) returns jsonb
language plpgsql
security definer
-- ⚠️ `search_path` figé : sans lui, une fonction `security definer` est
--   détournable par quiconque peut créer un objet dans un schéma du chemin de
--   recherche. Ce n'est pas une précaution de style.
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
  v_ligne jsonb;
begin
  -- ⚠️ Le cloisonnement est rétabli ici, à la main, puisque la sécurité par
  --   ligne ne s'applique plus : la fonction s'exécute comme propriétaire.
  --   Sans contexte d'organisation, rien n'est marqué — jamais « toutes les
  --   organisations ».
  v_org := nullif(current_setting('app.current_org', true), '')::uuid;
  if v_org is null then
    raise exception 'Contexte d''organisation absent : aucune suppression ne peut être marquée.';
  end if;

  -- ⚠️ Liste fermée. Passer un nom de table arbitraire à une fonction
  --   `security definer` qui construit du SQL est la porte ouverte à tout ;
  --   la liste est donc explicite, et le nom vient d'un `regclass` validé par
  --   le moteur avant d'être interpolé.
  if p_table::text not in (
    'gf_suppliers','gf_products','gf_shipments','gf_plots',
    'gf_documents','gf_due_diligence_statements','gf_compliance_tasks'
  ) then
    raise exception 'Table % non gérée par la suppression logique.', p_table::text;
  end if;

  execute format(
    'update %s set deleted_at = now(), deleted_by = $1
      where id = $2
        and organization_id = $3
        and deleted_at is null
      returning to_jsonb(%s)',
    p_table::text, p_table::text)
  into v_ligne
  using p_acteur, p_id, v_org;

  -- ⚠️ `null` est un résultat, pas une erreur : soit la ligne n'existe pas,
  --   soit elle appartient à une autre organisation, soit elle est déjà
  --   marquée. Les trois cas sont indistinguables de l'extérieur, et c'est
  --   voulu — répondre « existe mais pas à vous » renseignerait.
  return v_ligne;
end $$;

revoke all on function gf_marquer_suppression(regclass, uuid, text) from public;
grant execute on function gf_marquer_suppression(regclass, uuid, text) to geoforest_app;


-- ---------------------------------------------------------------------------
-- 3. Contrôle d'application
--
-- ⚠️ Ce bloc existe parce que le défaut corrigé ici n'a été découvert qu'en
--   exerçant le produit. Un contrôle qui se contentait de lire les politiques
--   n'aurait rien vu. Celui-ci **tente réellement** de marquer une ligne, sur
--   chaque table, avec le rôle applicatif et dans le périmètre d'une
--   organisation réelle, puis remet la ligne en état.
--
-- ⚠️ Le changement de rôle n'est pas facultatif : la sécurité par ligne
--   n'est pas appliquée au propriétaire. Exécuté en tant que `postgres`, ce
--   contrôle réussirait toujours — et ne contrôlerait donc rien.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  org uuid;
  id_ uuid;
  marque jsonb;
  tables text[] := array[
    'gf_suppliers','gf_products','gf_shipments','gf_plots',
    'gf_documents','gf_due_diligence_statements','gf_compliance_tasks'
  ];
begin
  foreach t in array tables
  loop
    execute format('select organization_id, id from %I where deleted_at is null limit 1', t)
       into org, id_;

    if org is null then
      raise notice '% — aucune ligne vivante à éprouver, contrôle reporté au produit', t;
      continue;
    end if;

    perform set_config('app.current_org', org::text, true);

    begin
      execute 'set local role geoforest_app';
      execute format('select gf_marquer_suppression(%L::regclass, %L::uuid, %L)', t, id_, 'controle-migration')
         into marque;
      execute 'reset role';

      if marque is null then
        raise exception 'Aucune ligne marquée sur % alors qu''une ligne vivante existe.', t;
      end if;

      -- Remise en état : la ligne doit redevenir exactement ce qu'elle était.
      execute format(
        $p$update %I set deleted_at = null, deleted_by = null where id = %L$p$, t, id_);

      raise notice '% — suppression logique possible (ligne % marquée, puis remise en état)', t, id_;
    exception
      when others then
        execute 'reset role';
        raise exception 'La suppression logique est IMPOSSIBLE sur % : %. Corriger avant d''aller plus loin.', t, sqlerrm;
    end;
  end loop;
end $$;
