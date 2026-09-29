CREATE TABLE diligence_dossiers (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 current_revision integer NOT NULL CHECK(current_revision>0), created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,id)
);
CREATE TABLE diligence_revisions (
 organization_id uuid NOT NULL, dossier_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 request_id uuid NOT NULL, input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[0-9a-f]{64}$'),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 160), declaration jsonb NOT NULL, snapshot jsonb NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'), snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','INTERNALLY_VALIDATED','INTERNALLY_WITHDRAWN')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,dossier_id,revision), UNIQUE(organization_id,request_id),
 FOREIGN KEY(organization_id,dossier_id) REFERENCES diligence_dossiers(organization_id,id),
 CHECK(octet_length(declaration::text)<=65536), CHECK(octet_length(snapshot::text)<=2500000)
);
ALTER TABLE diligence_dossiers ADD FOREIGN KEY(organization_id,id,current_revision)
 REFERENCES diligence_revisions(organization_id,dossier_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE diligence_decisions (
 organization_id uuid NOT NULL, dossier_id uuid NOT NULL, revision integer NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(), request_id uuid NOT NULL, input_sha256 text NOT NULL,
 action text NOT NULL CHECK(action IN ('SUBMIT_FOR_REVIEW','REQUEST_CHANGES','VALIDATE_INTERNALLY','WITHDRAW_INTERNALLY')),
 previous_state text NOT NULL, new_state text NOT NULL, revision_version integer NOT NULL,
 note text NOT NULL CHECK(length(note) BETWEEN 10 AND 4000), acknowledged boolean NOT NULL,
 checks jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,request_id), UNIQUE(organization_id,dossier_id,revision,revision_version),
 FOREIGN KEY(organization_id,dossier_id,revision) REFERENCES diligence_revisions(organization_id,dossier_id,revision),
 CHECK(octet_length(checks::text)<=100000)
);
CREATE FUNCTION authz.guard_diligence_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'state'-'version') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'version') THEN RAISE EXCEPTION 'immutable diligence revision'; END IF;
 IF NEW.version<>OLD.version+1 OR NOT (
 (OLD.state='DRAFT' AND NEW.state='IN_REVIEW') OR
 (OLD.state='IN_REVIEW' AND NEW.state IN ('CHANGES_REQUESTED','INTERNALLY_VALIDATED','INTERNALLY_WITHDRAWN')) OR
 (OLD.state='INTERNALLY_VALIDATED' AND NEW.state='INTERNALLY_WITHDRAWN')
 ) THEN RAISE EXCEPTION 'invalid diligence transition'; END IF;
 IF NEW.state<>'IN_REVIEW' AND NOT authz.compliance_writer(NEW.organization_id) THEN RAISE EXCEPTION 'reviewer required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER diligence_revision_guard BEFORE UPDATE ON diligence_revisions FOR EACH ROW EXECUTE FUNCTION authz.guard_diligence_revision();
CREATE FUNCTION authz.guard_diligence_dossier() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'current_revision') IS DISTINCT FROM (to_jsonb(OLD)-'current_revision') OR NEW.current_revision<>OLD.current_revision+1 THEN RAISE EXCEPTION 'immutable dossier identity or invalid revision'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER diligence_dossier_guard BEFORE UPDATE ON diligence_dossiers FOR EACH ROW EXECUTE FUNCTION authz.guard_diligence_dossier();
ALTER TABLE diligence_dossiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE diligence_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE diligence_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY dossier_read ON diligence_dossiers FOR SELECT USING(authz.staff(organization_id));
CREATE POLICY dossier_write ON diligence_dossiers FOR INSERT WITH CHECK(authz.supply_writer(organization_id) AND created_by=authz.current_user_id());
CREATE POLICY dossier_update ON diligence_dossiers FOR UPDATE USING(authz.supply_writer(organization_id)) WITH CHECK(authz.supply_writer(organization_id));
CREATE POLICY revision_read ON diligence_revisions FOR SELECT USING(authz.staff(organization_id));
CREATE POLICY revision_write ON diligence_revisions FOR INSERT WITH CHECK(authz.supply_writer(organization_id) AND created_by=authz.current_user_id() AND state='DRAFT' AND version=1);
CREATE POLICY revision_update ON diligence_revisions FOR UPDATE USING(authz.supply_writer(organization_id)) WITH CHECK(authz.supply_writer(organization_id));
CREATE POLICY decision_read ON diligence_decisions FOR SELECT USING(authz.staff(organization_id));
CREATE POLICY decision_write ON diligence_decisions FOR INSERT WITH CHECK(authz.supply_writer(organization_id) AND actor_id=authz.current_user_id() AND (action='SUBMIT_FOR_REVIEW' OR authz.compliance_writer(organization_id)));
GRANT SELECT,INSERT,UPDATE ON diligence_dossiers,diligence_revisions TO geoforest_app;
GRANT SELECT,INSERT ON diligence_decisions TO geoforest_app;
CREATE INDEX diligence_recent ON diligence_dossiers(organization_id,created_at DESC,id);
-- Row-lock one's own membership without granting membership mutation to readers.
CREATE FUNCTION authz.lock_diligence_member(org uuid) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE member text;
BEGIN
 IF org IS NULL OR org IS DISTINCT FROM authz.current_org_id() OR authz.current_user_id() IS NULL THEN RAISE EXCEPTION 'member context required'; END IF;
 SELECT role INTO member FROM public.memberships WHERE organization_id=org AND user_id=authz.current_user_id() FOR SHARE;
 IF member IS NULL OR member NOT IN ('Admin','Compliance Manager','Procurement','Analyst','Viewer') THEN RAISE EXCEPTION 'staff membership required'; END IF;
 RETURN member;
END $$;
REVOKE ALL ON FUNCTION authz.lock_diligence_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.lock_diligence_member(uuid) TO geoforest_app;
