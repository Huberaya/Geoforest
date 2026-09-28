CREATE TABLE commodities (code text PRIMARY KEY, label text NOT NULL);
INSERT INTO commodities VALUES ('coffee','Café'),('cocoa','Cacao'),('wood','Bois'),('rubber','Caoutchouc'),('soya','Soja'),('palm_oil','Palmier à huile'),('cattle','Bovins');
CREATE TABLE suppliers (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 reference text NOT NULL CHECK(length(reference) BETWEEN 2 AND 40), name text NOT NULL CHECK(length(name) BETWEEN 2 AND 200),
 country text CHECK(country ~ '^[A-Z]{2}$'), address text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '',
 legal_type text NOT NULL DEFAULT 'unknown' CHECK(legal_type IN ('unknown','company','cooperative','individual')),
 registration_id text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,reference)
);
CREATE INDEX suppliers_search ON suppliers(organization_id,lower(name));
CREATE TABLE supplier_contacts (
 organization_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), supplier_id uuid NOT NULL,
 name text NOT NULL, email text NOT NULL, phone text NOT NULL DEFAULT '', position text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,id), FOREIGN KEY(organization_id,supplier_id) REFERENCES suppliers(organization_id,id)
);
CREATE UNIQUE INDEX supplier_contact_email ON supplier_contacts(organization_id,supplier_id,lower(email));
CREATE TABLE products (
 organization_id uuid NOT NULL REFERENCES organizations(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 reference text NOT NULL, name text NOT NULL, hs_code text NOT NULL DEFAULT '' CHECK(hs_code='' OR hs_code ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'),
 description text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,reference)
);
CREATE TABLE product_commodities (
 organization_id uuid NOT NULL, product_id uuid NOT NULL, commodity_code text NOT NULL REFERENCES commodities(code),
 PRIMARY KEY(organization_id,product_id,commodity_code), FOREIGN KEY(organization_id,product_id) REFERENCES products(organization_id,id)
);
CREATE TABLE supplier_products (
 organization_id uuid NOT NULL,supplier_id uuid NOT NULL,product_id uuid NOT NULL,
 PRIMARY KEY(organization_id,supplier_id,product_id),
 FOREIGN KEY(organization_id,supplier_id) REFERENCES suppliers(organization_id,id),
 FOREIGN KEY(organization_id,product_id) REFERENCES products(organization_id,id)
);
CREATE TABLE supplier_collections (
 organization_id uuid NOT NULL,supplier_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 version integer NOT NULL DEFAULT 1,status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','REVIEWED','CHANGES_REQUESTED')),
 payload jsonb NOT NULL DEFAULT '{"company":{},"products":[]}', submitted_at timestamptz, reviewed_at timestamptz,
 reviewed_by uuid REFERENCES users(id), review_note text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,supplier_id,id),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,supplier_id) REFERENCES suppliers(organization_id,id)
);
CREATE UNIQUE INDEX one_working_collection ON supplier_collections(organization_id,supplier_id) WHERE status IN ('DRAFT','CHANGES_REQUESTED');
CREATE TABLE lots (
 organization_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),reference text NOT NULL,
 supplier_id uuid NOT NULL,product_id uuid NOT NULL,quantity numeric(18,6) NOT NULL CHECK(quantity>0),
 unit text NOT NULL CHECK(unit IN ('KG','T','M3','PCS')),origin_country text CHECK(origin_country ~ '^[A-Z]{2}$'),
 production_start date, production_end date,source_collection_id uuid,notes text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),archived_at timestamptz,
 PRIMARY KEY(organization_id,id), UNIQUE(organization_id,reference),
 FOREIGN KEY(organization_id,supplier_id,product_id) REFERENCES supplier_products(organization_id,supplier_id,product_id),
 FOREIGN KEY(organization_id,supplier_id,source_collection_id) REFERENCES supplier_collections(organization_id,supplier_id,id),
 CHECK(production_end IS NULL OR production_start IS NULL OR production_end>=production_start)
);
CREATE INDEX lots_supplier ON lots(organization_id,supplier_id);
CREATE TABLE supplier_imports (
 organization_id uuid NOT NULL REFERENCES organizations(id),checksum text NOT NULL,created_count integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,checksum)
);
CREATE TABLE supplier_invitations (
 organization_id uuid NOT NULL,supplier_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 token_hash text NOT NULL UNIQUE,created_by uuid NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),used_at timestamptz,revoked_at timestamptz,
 PRIMARY KEY(organization_id,supplier_id,id),
 FOREIGN KEY(organization_id,supplier_id) REFERENCES suppliers(organization_id,id)
);
CREATE TABLE supplier_sessions (
 token_hash text PRIMARY KEY,organization_id uuid NOT NULL,supplier_id uuid NOT NULL,invitation_id uuid NOT NULL,
 csrf_token text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,revoked_at timestamptz,
 FOREIGN KEY(organization_id,supplier_id,invitation_id) REFERENCES supplier_invitations(organization_id,supplier_id,id)
);
CREATE INDEX supplier_sessions_expiry ON supplier_sessions(expires_at);

CREATE FUNCTION authz.staff(org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT org=authz.current_org_id() AND authz.member_role(org) IN ('Admin','Compliance Manager','Procurement','Analyst','Viewer')
$$;
CREATE FUNCTION authz.supply_writer(org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT org=authz.current_org_id() AND authz.member_role(org) IN ('Admin','Compliance Manager','Procurement')
$$;
CREATE FUNCTION authz.supplier_reader(org uuid,supplier uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT org=authz.current_org_id() AND (authz.staff(org) OR EXISTS(SELECT 1 FROM public.memberships WHERE organization_id=org AND user_id=authz.current_user_id() AND role='Supplier' AND supplier_id=supplier))
$$;
CREATE FUNCTION authz.product_reader(org uuid,product uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT org=authz.current_org_id() AND (authz.staff(org) OR EXISTS(SELECT 1 FROM public.supplier_products sp JOIN public.memberships m ON m.organization_id=sp.organization_id AND m.supplier_id=sp.supplier_id WHERE sp.organization_id=org AND sp.product_id=product AND m.user_id=authz.current_user_id() AND m.role='Supplier'))
$$;
CREATE FUNCTION authz.portal_access(org uuid,supplier uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.supplier_sessions s JOIN public.supplier_invitations i ON (s.organization_id,s.supplier_id,s.invitation_id)=(i.organization_id,i.supplier_id,i.id)
 JOIN public.suppliers p ON (p.organization_id,p.id)=(s.organization_id,s.supplier_id)
 WHERE s.token_hash=current_setting('app.portal_session',true) AND s.organization_id=org AND s.supplier_id=supplier
 AND s.expires_at>now() AND s.revoked_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND p.archived_at IS NULL)
$$;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY suppliers_read ON suppliers FOR SELECT USING(authz.supplier_reader(organization_id,id));
CREATE POLICY suppliers_insert ON suppliers FOR INSERT WITH CHECK(authz.supply_writer(organization_id));
CREATE POLICY suppliers_update ON suppliers FOR UPDATE USING(authz.supply_writer(organization_id)) WITH CHECK(authz.supply_writer(organization_id));
ALTER TABLE supplier_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contacts_read ON supplier_contacts FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id));
CREATE POLICY contacts_write ON supplier_contacts FOR ALL USING(authz.supply_writer(organization_id)) WITH CHECK(authz.supply_writer(organization_id));
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_read ON products FOR SELECT USING(authz.product_reader(organization_id,id));
CREATE POLICY products_insert ON products FOR INSERT WITH CHECK(authz.supply_writer(organization_id));
CREATE POLICY products_update ON products FOR UPDATE USING(authz.supply_writer(organization_id)) WITH CHECK(authz.supply_writer(organization_id));
ALTER TABLE product_commodities ENABLE ROW LEVEL SECURITY;
CREATE POLICY commodities_read ON product_commodities FOR SELECT USING(authz.product_reader(organization_id,product_id));
CREATE POLICY commodities_write ON product_commodities FOR ALL USING(authz.supply_writer(organization_id)) WITH CHECK(authz.supply_writer(organization_id));
ALTER TABLE supplier_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY links_read ON supplier_products FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id));
CREATE POLICY links_write ON supplier_products FOR ALL USING(authz.supply_writer(organization_id)) WITH CHECK(authz.supply_writer(organization_id));
ALTER TABLE lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY lots_read ON lots FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id));
CREATE POLICY lots_insert ON lots FOR INSERT WITH CHECK(authz.supply_writer(organization_id));
CREATE POLICY lots_update ON lots FOR UPDATE USING(authz.supply_writer(organization_id)) WITH CHECK(authz.supply_writer(organization_id));
ALTER TABLE supplier_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY collections_read ON supplier_collections FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id) OR authz.portal_access(organization_id,supplier_id));
CREATE POLICY collections_insert ON supplier_collections FOR INSERT WITH CHECK(authz.supply_writer(organization_id) OR authz.portal_access(organization_id,supplier_id));
CREATE POLICY collections_update ON supplier_collections FOR UPDATE USING(authz.supply_writer(organization_id) OR authz.portal_access(organization_id,supplier_id)) WITH CHECK(authz.supply_writer(organization_id) OR authz.portal_access(organization_id,supplier_id));
ALTER TABLE supplier_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY imports_write ON supplier_imports FOR ALL USING(authz.supply_writer(organization_id)) WITH CHECK(authz.supply_writer(organization_id));
ALTER TABLE supplier_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitations_write ON supplier_invitations FOR ALL USING(authz.supply_writer(organization_id)) WITH CHECK(authz.supply_writer(organization_id));
ALTER TABLE supplier_sessions ENABLE ROW LEVEL SECURITY;
-- No direct session table privilege: only minimal definer functions can exchange/revoke a token.

ALTER TABLE audit_events ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE audit_events ADD COLUMN actor_kind text NOT NULL DEFAULT 'user';
ALTER TABLE audit_events ADD COLUMN supplier_actor_id uuid;
ALTER TABLE audit_events ADD CONSTRAINT audit_actor_type CHECK ((actor_kind='user' AND actor_id IS NOT NULL AND supplier_actor_id IS NULL) OR (actor_kind='supplier' AND actor_id IS NULL AND supplier_actor_id IS NOT NULL));
ALTER TABLE audit_events ADD FOREIGN KEY(organization_id,supplier_actor_id) REFERENCES suppliers(organization_id,id);
CREATE POLICY portal_audit_insert ON audit_events FOR INSERT WITH CHECK(actor_kind='supplier' AND actor_id IS NULL AND authz.portal_access(organization_id,supplier_actor_id));

CREATE FUNCTION authz.exchange_supplier_token(inv_hash text,session_hash text,csrf text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE inv public.supplier_invitations;
BEGIN
 SELECT i.* INTO inv FROM public.supplier_invitations i JOIN public.suppliers p ON(p.organization_id,p.id)=(i.organization_id,i.supplier_id)
 WHERE i.token_hash=inv_hash AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND p.archived_at IS NULL FOR UPDATE OF i;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.supplier_invitations SET used_at=now() WHERE token_hash=inv_hash;
 INSERT INTO public.supplier_sessions(token_hash,organization_id,supplier_id,invitation_id,csrf_token,expires_at)
 VALUES(session_hash,inv.organization_id,inv.supplier_id,inv.id,csrf,least(inv.expires_at,now()+interval '8 hours'));
 INSERT INTO public.audit_events(organization_id,actor_kind,supplier_actor_id,action,object_type,object_id,source)
 VALUES(inv.organization_id,'supplier',inv.supplier_id,'supplier.portal_opened','supplier',inv.supplier_id,'supplier_portal');
 DELETE FROM public.supplier_sessions WHERE expires_at<now()-interval '1 day';
 RETURN true;
END $$;
CREATE FUNCTION authz.supplier_session_info(session_hash text) RETURNS TABLE(organization_id uuid,supplier_id uuid,csrf_token text,supplier_name text,organization_name text,expires_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT s.organization_id,s.supplier_id,s.csrf_token,p.name,o.name,s.expires_at
 FROM public.supplier_sessions s JOIN public.supplier_invitations i ON(s.organization_id,s.supplier_id,s.invitation_id)=(i.organization_id,i.supplier_id,i.id)
 JOIN public.suppliers p ON(p.organization_id,p.id)=(s.organization_id,s.supplier_id) JOIN public.organizations o ON o.id=s.organization_id
 WHERE s.token_hash=session_hash AND s.expires_at>now() AND s.revoked_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND p.archived_at IS NULL
$$;
CREATE FUNCTION authz.supplier_logout(session_hash text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 UPDATE public.supplier_sessions SET revoked_at=now() WHERE token_hash=session_hash
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA authz FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA authz TO geoforest_app;
GRANT SELECT ON commodities TO geoforest_app;
GRANT SELECT,INSERT,UPDATE ON suppliers,products,lots,supplier_collections,supplier_invitations TO geoforest_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON supplier_contacts,supplier_products,product_commodities TO geoforest_app;
GRANT SELECT,INSERT ON supplier_imports TO geoforest_app;
CREATE TABLE collection_revisions (
 organization_id uuid NOT NULL,supplier_id uuid NOT NULL,collection_id uuid NOT NULL,version integer NOT NULL,
 payload jsonb NOT NULL,submitted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,supplier_id,collection_id,version),
 FOREIGN KEY(organization_id,supplier_id,collection_id) REFERENCES supplier_collections(organization_id,supplier_id,id)
);
ALTER TABLE collection_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY revisions_read ON collection_revisions FOR SELECT USING(authz.supplier_reader(organization_id,supplier_id) OR authz.portal_access(organization_id,supplier_id));
CREATE POLICY revisions_insert ON collection_revisions FOR INSERT WITH CHECK(authz.portal_access(organization_id,supplier_id));
GRANT SELECT,INSERT ON collection_revisions TO geoforest_app;
