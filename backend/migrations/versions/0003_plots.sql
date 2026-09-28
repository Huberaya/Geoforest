CREATE TABLE plots (
 organization_id uuid NOT NULL, supplier_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 reference text NOT NULL, version integer NOT NULL DEFAULT 1, current_revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,supplier_id,id), UNIQUE(organization_id,reference),
 FOREIGN KEY(organization_id,supplier_id) REFERENCES suppliers(organization_id,id)
);
CREATE TABLE plot_geolocations (
 organization_id uuid NOT NULL,supplier_id uuid NOT NULL,plot_id uuid NOT NULL,revision integer NOT NULL,
 payload jsonb NOT NULL, geom geometry(Geometry,4326) NOT NULL, analysis jsonb NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN ('STAFF','IMPORT','SUPPLIER_PORTAL')),
 source_id uuid, actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,supplier_id,plot_id,revision),
 FOREIGN KEY(organization_id,supplier_id,plot_id) REFERENCES plots(organization_id,supplier_id,id),
 CHECK(GeometryType(geom) IN ('POINT','POLYGON','MULTIPOLYGON') AND ST_IsValid(geom) AND NOT ST_IsEmpty(geom))
);
ALTER TABLE plots ADD FOREIGN KEY(organization_id,supplier_id,id,current_revision)
 REFERENCES plot_geolocations(organization_id,supplier_id,plot_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX plot_geometry_gist ON plot_geolocations USING gist(geom);
CREATE INDEX plots_supplier ON plots(organization_id,supplier_id);
ALTER TABLE lots ADD UNIQUE(organization_id,supplier_id,id);
CREATE TABLE lot_plots (
 organization_id uuid NOT NULL,supplier_id uuid NOT NULL,lot_id uuid NOT NULL,plot_id uuid NOT NULL,revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),actor_id uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(organization_id,lot_id,plot_id),
 FOREIGN KEY(organization_id,supplier_id,lot_id) REFERENCES lots(organization_id,supplier_id,id),
 FOREIGN KEY(organization_id,supplier_id,plot_id,revision) REFERENCES plot_geolocations(organization_id,supplier_id,plot_id,revision)
);
CREATE TABLE plot_imports (
 organization_id uuid NOT NULL,supplier_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(), checksum text NOT NULL,
 source_sha256 text NOT NULL, file_format text NOT NULL, source_text text NOT NULL, created_ids jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),actor_id uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,supplier_id,checksum),
 FOREIGN KEY(organization_id,supplier_id) REFERENCES suppliers(organization_id,id)
);
CREATE TABLE plot_proposals (
 organization_id uuid NOT NULL,supplier_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),version integer NOT NULL DEFAULT 1,
 payload jsonb NOT NULL,analysis jsonb NOT NULL,status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','CHANGES_REQUESTED','ACCEPTED')),
 review_note text NOT NULL DEFAULT '',reviewed_by uuid REFERENCES users(id),adopted_plot_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),submitted_at timestamptz,
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,supplier_id,id),
 FOREIGN KEY(organization_id,supplier_id) REFERENCES suppliers(organization_id,id),
 FOREIGN KEY(organization_id,supplier_id,adopted_plot_id) REFERENCES plots(organization_id,supplier_id,id)
);
CREATE TABLE plot_proposal_revisions (
 organization_id uuid NOT NULL,supplier_id uuid NOT NULL,proposal_id uuid NOT NULL,version integer NOT NULL,
 payload jsonb NOT NULL,analysis jsonb NOT NULL,submitted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,supplier_id,proposal_id,version),
 FOREIGN KEY(organization_id,supplier_id,proposal_id) REFERENCES plot_proposals(organization_id,supplier_id,id)
);
ALTER TABLE plots ENABLE ROW LEVEL SECURITY;
CREATE POLICY plots_read ON plots FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id));
CREATE POLICY plots_insert ON plots FOR INSERT WITH CHECK(authz.supply_writer(organization_id));
CREATE POLICY plots_update ON plots FOR UPDATE USING(authz.supply_writer(organization_id)) WITH CHECK(authz.supply_writer(organization_id));
ALTER TABLE plot_geolocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY geolocations_read ON plot_geolocations FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id));
CREATE POLICY geolocations_insert ON plot_geolocations FOR INSERT WITH CHECK(authz.supply_writer(organization_id));
ALTER TABLE lot_plots ENABLE ROW LEVEL SECURITY;
CREATE POLICY lot_plots_read ON lot_plots FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id));
CREATE POLICY lot_plots_write ON lot_plots FOR ALL USING(authz.supply_writer(organization_id)) WITH CHECK(authz.supply_writer(organization_id));
ALTER TABLE plot_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY imports_plot_read ON plot_imports FOR SELECT USING(authz.supply_writer(organization_id));
CREATE POLICY imports_plot_insert ON plot_imports FOR INSERT WITH CHECK(authz.supply_writer(organization_id));
ALTER TABLE plot_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY proposals_read ON plot_proposals FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id) OR authz.portal_access(organization_id,supplier_id));
CREATE POLICY proposals_insert ON plot_proposals FOR INSERT WITH CHECK(authz.portal_access(organization_id,supplier_id));
CREATE POLICY proposals_update ON plot_proposals FOR UPDATE USING(authz.supply_writer(organization_id) OR authz.portal_access(organization_id,supplier_id)) WITH CHECK(authz.supply_writer(organization_id) OR authz.portal_access(organization_id,supplier_id));
ALTER TABLE plot_proposal_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY proposal_revisions_read ON plot_proposal_revisions FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id) OR authz.portal_access(organization_id,supplier_id));
CREATE POLICY proposal_revisions_insert ON plot_proposal_revisions FOR INSERT WITH CHECK(authz.portal_access(organization_id,supplier_id));
GRANT SELECT,INSERT,UPDATE ON plots,plot_proposals TO geoforest_app;
GRANT SELECT,INSERT ON plot_geolocations,plot_imports,plot_proposal_revisions TO geoforest_app;
GRANT SELECT,INSERT,DELETE ON lot_plots TO geoforest_app;
