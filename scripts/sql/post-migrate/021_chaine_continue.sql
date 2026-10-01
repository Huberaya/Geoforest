-- ===========================================================================
-- 021 — Chaîne d'audit : dire ce qui manque
--
-- ⚠️ Pourquoi ce complément.
--   `verifier_chaine_audit` signalait une rupture sans dire **quelle** ligne
--   avait disparu : l'exploitant apprenait que « quelque chose » manquait,
--   sans pouvoir répondre à la seule question qui compte — combien, et entre
--   quels rangs ? Une alarme qu'on ne peut pas qualifier est une alarme qu'on
--   finit par ignorer.
--
-- ⚠️ Ce que ce complément ne fait PAS, et qu'il faut savoir.
--   Le numéro de séquence est **global** à toutes les organisations : deux
--   organisations se partagent la même numérotation, et les trous entre deux
--   rangs d'une même organisation sont donc normaux. On ne peut pas déduire
--   « il manque les rangs 12 à 14 » d'un simple écart de numéros. En revanche,
--   on peut déduire la plage manquante **à l'intérieur** de la chaîne d'une
--   organisation : ce sont les rangs situés entre le dernier rang connu et le
--   rang de la ligne dont le condensat ne correspond plus. C'est ce que
--   l'anomalie rapporte désormais.
--
-- ⚠️ Limite assumée, et non levée ici.
--   La suppression de la **dernière** ligne d'une organisation ne rompt aucune
--   chaîne : aucune ligne ne pointe vers elle. Aucun chaînage par condensat ne
--   peut la détecter. Trois protections s'y opposent, toutes vérifiées :
--     · le rôle applicatif n'a plus le privilège `DELETE` (éprouvé) ;
--     · un déclencheur refuse toute suppression, privilège ou non (éprouvé) ;
--     · le journal n'est consultable qu'en lecture.
--   Une protection complète supposerait un **ancrage externe** — publier
--   périodiquement le dernier numéro et son condensat dans un registre
--   indépendant. Ce dispositif n'existe pas ici : ⚪ non implémenté.
--
-- Application :
--   psql "$DATABASE_URL_ADMIN" -f scripts/sql/post-migrate/021_chaine_continue.sql
-- ===========================================================================


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
  precedent_sequence bigint := null;
  plage text;
begin
  for r in
    select * from gf_audit_logs
     where organization_id is not distinct from p_organization_id
     order by sequence
  loop
    if precedent_lu is distinct from r.hash_precedent then
      -- ⚠️ La plage manquante est calculée ici, et annoncée : c'est la
      --   différence entre « votre journal a un trou » et « les écritures
      --   comprises entre les rangs 41 et 57 ne sont plus là ».
      if precedent_sequence is not null and r.sequence > precedent_sequence + 1 then
        plage := format('rangs %s à %s', precedent_sequence + 1, r.sequence - 1);
      else
        plage := format('rang %s', coalesce(precedent_sequence, r.sequence));
      end if;

      return query select r.sequence,
                          'rupture_de_chaine'::text,
                          coalesce(precedent_lu, '(aucun)') || ' · ' || plage,
                          coalesce(r.hash_precedent, '(aucun)');
    end if;

    if gf_audit_empreinte(r, r.hash_precedent) is distinct from r.hash then
      return query select r.sequence, 'ligne_altérée'::text,
                          coalesce(gf_audit_empreinte(r, r.hash_precedent), ''), coalesce(r.hash, '');
    end if;

    precedent_lu := r.hash;
    precedent_sequence := r.sequence;
  end loop;
end $$;

grant execute on function verifier_chaine_audit(uuid) to geoforest_app;
