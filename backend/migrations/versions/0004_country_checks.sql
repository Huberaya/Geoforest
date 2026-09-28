CREATE TABLE country_checks (
 organization_id uuid NOT NULL,supplier_id uuid NOT NULL,plot_id uuid NOT NULL,revision integer NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),request_id uuid NOT NULL,input_sha256 text NOT NULL,
 result jsonb NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id),UNIQUE(organization_id,request_id),
 FOREIGN KEY(organization_id,supplier_id,plot_id,revision) REFERENCES plot_geolocations(organization_id,supplier_id,plot_id,revision),
 CHECK(result @> '{"regulatory_status":"NOT_ASSESSED","country_verified":false,"human_review_required":true}'::jsonb)
);
CREATE INDEX country_checks_plot ON country_checks(organization_id,plot_id,revision,created_at DESC,id);
ALTER TABLE country_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY country_checks_read ON country_checks FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id));
CREATE POLICY country_checks_insert ON country_checks FOR INSERT WITH CHECK(authz.supply_writer(organization_id));
GRANT SELECT,INSERT ON country_checks TO geoforest_app;
