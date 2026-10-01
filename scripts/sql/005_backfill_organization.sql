-- ---------------------------------------------------------------------------
-- P0-02 — Reprise des données existantes avant passage en NOT NULL
-- ---------------------------------------------------------------------------
-- Les lignes créées avant le cloisonnement ont organization_id NULL.
-- Elles sont rattachées à l'organisation de référence et le sont de façon
-- tracée : ce script est idempotent et journalise ce qu'il modifie.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_nb  bigint;
  t     text;
begin
  select id into v_org from gf_organizations where slug = 'geoforest-agro' limit 1;

  if v_org is null then
    raise exception 'Organisation de référence introuvable : exécuter d abord "npm run seed:auth".';
  end if;

  foreach t in array array[
    'gf_users','gf_suppliers','gf_products','gf_shipments','gf_plots','gf_documents',
    'gf_due_diligence_statements','gf_compliance_tasks','gf_audit_logs','parcel_audits'
  ]
  loop
    execute format('update %I set organization_id = $1 where organization_id is null', t)
      using v_org;
    get diagnostics v_nb = row_count;
    if v_nb > 0 then
      raise notice 'reprise % : % ligne(s) rattachée(s) à %', t, v_nb, v_org;
    end if;
  end loop;
end $$;
