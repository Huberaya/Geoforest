CREATE TABLE forest_analyses (
 organization_id uuid NOT NULL, supplier_id uuid NOT NULL, plot_id uuid NOT NULL, revision integer NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL, input_sha256 text NOT NULL,
 result jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,request_id),
 FOREIGN KEY(organization_id,supplier_id,plot_id,revision) REFERENCES plot_geolocations(organization_id,supplier_id,plot_id,revision),
 CHECK (result @> '{"regulatory_status":"NOT_ASSESSED","human_review_required":true}'::jsonb),
 CHECK (octet_length(result::text) <= 8388608),
 CHECK (input_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX forest_analyses_plot ON forest_analyses(organization_id,plot_id,revision,created_at DESC,id);
ALTER TABLE forest_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY forest_analyses_read ON forest_analyses FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id));
CREATE POLICY forest_analyses_insert ON forest_analyses FOR INSERT WITH CHECK(authz.supply_writer(organization_id));
GRANT SELECT,INSERT ON forest_analyses TO geoforest_app;
