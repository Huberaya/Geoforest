CREATE SCHEMA authz;
REVOKE ALL ON SCHEMA authz FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issuer text NOT NULL, subject text NOT NULL,
 email text NOT NULL CHECK(length(email)<=320), display_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(issuer,subject)
);
CREATE INDEX users_email ON users(lower(email));
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), csrf_token text NOT NULL,
 acr text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 revoked_at timestamptz
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
 created_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE TABLE memberships (
 organization_id uuid NOT NULL REFERENCES organizations(id), user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('Admin','Compliance Manager','Procurement','Analyst','Viewer','Supplier')),
 supplier_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,user_id),
 CHECK ((role='Supplier') = (supplier_id IS NOT NULL))
);
CREATE INDEX memberships_user ON memberships(user_id);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, object_type text NOT NULL,
 object_id uuid NOT NULL, previous_value jsonb, new_value jsonb,
 source text NOT NULL DEFAULT 'application', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_tenant_date ON audit_events(organization_id,created_at DESC,id);
CREATE TABLE rate_buckets (key text PRIMARY KEY, window_start timestamptz NOT NULL, hits integer NOT NULL);

CREATE FUNCTION authz.current_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('app.user_id',true),'')::uuid
$$;
CREATE FUNCTION authz.current_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('app.organization_id',true),'')::uuid
$$;
CREATE FUNCTION authz.member_role(org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path = pg_catalog,public AS $$
 SELECT role FROM public.memberships WHERE organization_id=org AND user_id=authz.current_user_id()
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
-- Owner remains the separate migrator; the app role is never an owner and cannot bypass RLS.
CREATE POLICY org_read ON organizations FOR SELECT USING (authz.member_role(id) IS NOT NULL);
CREATE POLICY org_write ON organizations FOR UPDATE
 USING (id=authz.current_org_id() AND authz.member_role(id)='Admin')
 WITH CHECK (id=authz.current_org_id() AND authz.member_role(id)='Admin');
CREATE POLICY member_read ON memberships FOR SELECT USING (
 user_id=authz.current_user_id() OR
 (organization_id=authz.current_org_id() AND authz.member_role(organization_id)='Admin')
);
CREATE POLICY member_insert ON memberships FOR INSERT WITH CHECK (
 organization_id=authz.current_org_id() AND authz.member_role(organization_id)='Admin'
);
CREATE POLICY member_update ON memberships FOR UPDATE USING (
 organization_id=authz.current_org_id() AND authz.member_role(organization_id)='Admin'
) WITH CHECK (organization_id=authz.current_org_id() AND authz.member_role(organization_id)='Admin');
CREATE POLICY member_delete ON memberships FOR DELETE USING (
 organization_id=authz.current_org_id() AND authz.member_role(organization_id)='Admin'
);
CREATE POLICY audit_read ON audit_events FOR SELECT USING (
 organization_id=authz.current_org_id() AND authz.member_role(organization_id) IN ('Admin','Compliance Manager')
);
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK (
 organization_id=authz.current_org_id() AND actor_id=authz.current_user_id()
 AND authz.member_role(organization_id) IS NOT NULL
);

CREATE FUNCTION authz.create_organization(org_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = pg_catalog,public AS $$
DECLARE org uuid; uid uuid := authz.current_user_id();
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=uid) THEN
  RAISE EXCEPTION 'Authenticated identity required';
 END IF;
 INSERT INTO public.organizations(name) VALUES(org_name) RETURNING id INTO org;
 INSERT INTO public.memberships(organization_id,user_id,role) VALUES(org,uid,'Admin');
 INSERT INTO public.audit_events(organization_id,actor_id,action,object_type,object_id,new_value)
 VALUES(org,uid,'organization.created','organization',org,jsonb_build_object('name',org_name));
 RETURN org;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA authz FROM PUBLIC;
GRANT USAGE ON SCHEMA public,authz TO geoforest_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA authz TO geoforest_app;
GRANT SELECT,INSERT,UPDATE ON users,sessions,rate_buckets TO geoforest_app;
GRANT DELETE ON sessions,rate_buckets TO geoforest_app;
GRANT SELECT,UPDATE ON organizations TO geoforest_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON memberships TO geoforest_app;
GRANT SELECT,INSERT ON audit_events TO geoforest_app;

GRANT SELECT ON alembic_version TO geoforest_app;
