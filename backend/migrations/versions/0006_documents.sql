CREATE TABLE documents (
 organization_id uuid NOT NULL, supplier_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 plot_id uuid, plot_revision integer, lot_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,supplier_id,id),
 FOREIGN KEY(organization_id,supplier_id) REFERENCES suppliers(organization_id,id),
 FOREIGN KEY(organization_id,supplier_id,plot_id,plot_revision) REFERENCES plot_geolocations(organization_id,supplier_id,plot_id,revision),
 FOREIGN KEY(organization_id,supplier_id,lot_id) REFERENCES lots(organization_id,supplier_id,id),
 CHECK ((plot_id IS NULL)=(plot_revision IS NULL))
);
CREATE TABLE document_versions (
 organization_id uuid NOT NULL, supplier_id uuid NOT NULL, document_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(), version integer NOT NULL CHECK(version>0), request_id uuid NOT NULL,
 input_sha256 text NOT NULL, metadata jsonb NOT NULL, expected_size integer NOT NULL CHECK(expected_size BETWEEN 1 AND 20971520),
 received_size integer NOT NULL DEFAULT 0 CHECK(received_size>=0 AND received_size<=expected_size),
 state text NOT NULL DEFAULT 'UPLOADING' CHECK(state IN ('UPLOADING','SCANNING','SCAN_PASSED','SCAN_REJECTED','SCAN_UNAVAILABLE','FORMAT_REJECTED')),
 object_id uuid, sha256 text CHECK(sha256 ~ '^[0-9a-f]{64}$'), mime text, scan_result jsonb,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 actor_id uuid REFERENCES users(id), actor_kind text NOT NULL CHECK(actor_kind IN ('user','supplier')),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour',
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,supplier_id,id), UNIQUE(organization_id,document_id,version), UNIQUE(organization_id,request_id),
 FOREIGN KEY(organization_id,supplier_id,document_id) REFERENCES documents(organization_id,supplier_id,id),
 CHECK(octet_length(metadata::text)<=8192), CHECK(octet_length(scan_result::text)<=65536),
 CHECK ((object_id IS NULL)=(sha256 IS NULL)),
 CHECK(state<>'SCAN_PASSED' OR (object_id IS NOT NULL AND received_size=expected_size AND mime IN ('application/pdf','image/jpeg','image/png') AND scan_result->>'status'='SCAN_PASSED')),
 CHECK((actor_kind='user' AND actor_id IS NOT NULL) OR (actor_kind='supplier' AND actor_id IS NULL))
);
CREATE FUNCTION authz.guard_document_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.organization_id,NEW.supplier_id,NEW.id,NEW.document_id,NEW.version,NEW.request_id,NEW.input_sha256,NEW.metadata,NEW.expected_size,NEW.actor_id,NEW.actor_kind,NEW.created_at,NEW.expires_at)
 IS DISTINCT FROM (OLD.organization_id,OLD.supplier_id,OLD.id,OLD.document_id,OLD.version,OLD.request_id,OLD.input_sha256,OLD.metadata,OLD.expected_size,OLD.actor_id,OLD.actor_kind,OLD.created_at,OLD.expires_at) THEN RAISE EXCEPTION 'immutable document metadata'; END IF;
 IF OLD.state IN ('SCAN_PASSED','SCAN_REJECTED','FORMAT_REJECTED') THEN RAISE EXCEPTION 'sealed document version'; END IF;
 IF OLD.object_id IS NOT NULL AND (NEW.object_id,NEW.sha256) IS DISTINCT FROM (OLD.object_id,OLD.sha256) THEN RAISE EXCEPTION 'immutable document bytes'; END IF;
 IF NEW.received_size<OLD.received_size OR NEW.attempts<OLD.attempts THEN RAISE EXCEPTION 'non monotonic upload'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_version_guard BEFORE UPDATE ON document_versions FOR EACH ROW EXECUTE FUNCTION authz.guard_document_version();
CREATE TABLE document_reviews (
 organization_id uuid NOT NULL, supplier_id uuid NOT NULL, version_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 decision text NOT NULL CHECK(decision IN ('ACCEPTED','REJECTED','NEEDS_INFORMATION')), note text NOT NULL CHECK(length(note) BETWEEN 10 AND 4000),
 actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,supplier_id,version_id) REFERENCES document_versions(organization_id,supplier_id,id)
);
CREATE TABLE legality_assessments (
 organization_id uuid NOT NULL, supplier_id uuid NOT NULL, lot_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 payload jsonb NOT NULL, input_sha256 text NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,supplier_id,lot_id) REFERENCES lots(organization_id,supplier_id,id),
 CHECK(octet_length(payload::text)<=60000)
);
CREATE TABLE risk_assessments (
 organization_id uuid NOT NULL, supplier_id uuid NOT NULL, lot_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 result jsonb NOT NULL, input_sha256 text NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,supplier_id,lot_id) REFERENCES lots(organization_id,supplier_id,id),
 CHECK(result @> '{"regulatory_status":"NOT_ASSESSED","human_review_required":true}'::jsonb), CHECK(octet_length(result::text)<=262144)
);
CREATE TABLE compliance_tasks (
 organization_id uuid NOT NULL, supplier_id uuid NOT NULL, lot_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 200), description text NOT NULL CHECK(length(description)<=4000),
 assigned_to uuid, due_date date NOT NULL, state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','IN_PROGRESS','RESOLVED')),
 resolution_note text NOT NULL DEFAULT '', proof_version_id uuid, version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,supplier_id,lot_id) REFERENCES lots(organization_id,supplier_id,id),
 FOREIGN KEY(organization_id,supplier_id,proof_version_id) REFERENCES document_versions(organization_id,supplier_id,id),
 FOREIGN KEY(organization_id,assigned_to) REFERENCES memberships(organization_id,user_id) ON DELETE SET NULL (assigned_to),
 CHECK(state<>'RESOLVED' OR (length(resolution_note)>=10 AND proof_version_id IS NOT NULL))
);
CREATE TABLE notification_outbox (
 organization_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), task_id uuid NOT NULL, task_version integer NOT NULL,
 recipient_id uuid NOT NULL, state text NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK(state='NOT_CONFIGURED'),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,id), UNIQUE(organization_id,task_id,task_version),
 FOREIGN KEY(organization_id,task_id) REFERENCES compliance_tasks(organization_id,id)
);
CREATE FUNCTION authz.compliance_writer(org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT org=authz.current_org_id() AND authz.member_role(org) IN ('Admin','Compliance Manager')
$$;
REVOKE ALL ON FUNCTION authz.compliance_writer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.compliance_writer(uuid) TO geoforest_app;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_read ON documents FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id) OR authz.portal_access(organization_id,supplier_id));
CREATE POLICY documents_insert ON documents FOR INSERT WITH CHECK(authz.supply_writer(organization_id) OR authz.portal_access(organization_id,supplier_id));
CREATE POLICY versions_read ON document_versions FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id) OR authz.portal_access(organization_id,supplier_id));
CREATE POLICY versions_write ON document_versions FOR INSERT WITH CHECK(authz.supply_writer(organization_id) OR authz.portal_access(organization_id,supplier_id));
CREATE POLICY versions_update ON document_versions FOR UPDATE USING(authz.supply_writer(organization_id) OR authz.portal_access(organization_id,supplier_id)) WITH CHECK(authz.supply_writer(organization_id) OR authz.portal_access(organization_id,supplier_id));
GRANT SELECT,INSERT ON documents TO geoforest_app;
GRANT SELECT,INSERT,UPDATE ON document_versions TO geoforest_app;
ALTER TABLE document_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviews_read ON document_reviews FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id) OR authz.portal_access(organization_id,supplier_id));
CREATE POLICY reviews_insert ON document_reviews FOR INSERT WITH CHECK(authz.compliance_writer(organization_id));
GRANT SELECT,INSERT ON document_reviews TO geoforest_app;
ALTER TABLE legality_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY legality_read ON legality_assessments FOR SELECT USING(authz.staff(organization_id));
CREATE POLICY legality_write ON legality_assessments FOR INSERT WITH CHECK(authz.compliance_writer(organization_id));
CREATE POLICY risk_read ON risk_assessments FOR SELECT USING(authz.staff(organization_id));
CREATE POLICY risk_write ON risk_assessments FOR INSERT WITH CHECK(authz.compliance_writer(organization_id));
GRANT SELECT,INSERT ON legality_assessments,risk_assessments TO geoforest_app;
ALTER TABLE compliance_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_read ON compliance_tasks FOR SELECT USING(authz.staff(organization_id));
CREATE POLICY tasks_write ON compliance_tasks FOR ALL USING(authz.compliance_writer(organization_id)) WITH CHECK(authz.compliance_writer(organization_id));
GRANT SELECT,INSERT,UPDATE ON compliance_tasks TO geoforest_app;
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbox_read ON notification_outbox FOR SELECT USING(authz.staff(organization_id));
CREATE POLICY outbox_insert ON notification_outbox FOR INSERT WITH CHECK(authz.compliance_writer(organization_id));
GRANT SELECT,INSERT ON notification_outbox TO geoforest_app;
CREATE INDEX document_versions_supplier ON document_versions(organization_id,supplier_id,created_at DESC,id);
CREATE INDEX document_reviews_version ON document_reviews(organization_id,version_id,created_at DESC,id);
CREATE INDEX legality_lot ON legality_assessments(organization_id,lot_id,created_at DESC,id);
CREATE INDEX risk_lot ON risk_assessments(organization_id,lot_id,created_at DESC,id);
CREATE INDEX tasks_lot ON compliance_tasks(organization_id,lot_id,state,due_date);

CREATE FUNCTION authz.document_quota(org uuid,supplier uuid) RETURNS TABLE(bytes bigint,count bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF org IS DISTINCT FROM authz.current_org_id() OR (authz.supply_writer(org) OR authz.portal_access(org,supplier)) IS NOT TRUE THEN RAISE EXCEPTION 'quota access denied'; END IF;
 RETURN QUERY SELECT COALESCE(sum(expected_size),0)::bigint,count(*) FROM public.document_versions WHERE organization_id=org;
END $$;
REVOKE ALL ON FUNCTION authz.document_quota(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.document_quota(uuid,uuid) TO geoforest_app;
