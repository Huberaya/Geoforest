-- CANDIDATE ONLY: not in Alembic's versions directory; no automatic cloud application.
-- Prerequisite: administrator provisions geoforest_document_worker NOLOGIN,
-- NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS (see runbook).
ALTER TABLE public.document_versions
 ADD COLUMN storage_backend text NOT NULL DEFAULT 'local' CHECK(storage_backend IN ('local','s3')),
 ADD COLUMN storage_version text CHECK(storage_version IS NULL OR (length(storage_version) BETWEEN 1 AND 1024 AND storage_version<>'null')),
 ADD CONSTRAINT versioned_s3_object CHECK (
   (storage_backend='local' AND storage_version IS NULL) OR
   (storage_backend='s3' AND ((object_id IS NULL)=(storage_version IS NULL))));
CREATE FUNCTION authz.guard_document_storage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.storage_backend IS DISTINCT FROM OLD.storage_backend OR
    (OLD.object_id IS NOT NULL AND NEW.storage_version IS DISTINCT FROM OLD.storage_version)
 THEN RAISE EXCEPTION 'immutable storage reference'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_storage_guard BEFORE UPDATE ON public.document_versions
 FOR EACH ROW EXECUTE FUNCTION authz.guard_document_storage();
ALTER TABLE public.audit_events DROP CONSTRAINT audit_actor_type;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_actor_type CHECK (
 (actor_kind='user' AND actor_id IS NOT NULL AND supplier_actor_id IS NULL) OR
 (actor_kind='supplier' AND actor_id IS NULL AND supplier_actor_id IS NOT NULL) OR
 (actor_kind='system' AND actor_id IS NULL AND supplier_actor_id IS NULL AND source='document_worker'));

CREATE TABLE public.document_jobs (
 organization_id uuid NOT NULL, version_id uuid NOT NULL,
 object_id uuid NOT NULL DEFAULT gen_random_uuid(),
 status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','LEASED','DONE','FAILED')),
 lease_token uuid, lease_until timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,version_id),
 FOREIGN KEY(organization_id,version_id) REFERENCES public.document_versions(organization_id,id),
 CHECK((status='LEASED')=(lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX document_jobs_available ON public.document_jobs(available_at,created_at)
 WHERE status IN ('QUEUED','LEASED');
ALTER TABLE public.document_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_jobs FROM PUBLIC,geoforest_app,geoforest_document_worker;

CREATE FUNCTION authz.document_enqueue(p_org uuid,p_version uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v public.document_versions;
BEGIN
 SELECT * INTO v FROM public.document_versions WHERE organization_id=p_org AND id=p_version FOR UPDATE;
 IF NOT FOUND OR NOT (coalesce(authz.supply_writer(p_org),false) OR
    coalesce(authz.portal_access(p_org,v.supplier_id),false))
 THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='42501'; END IF;
 IF v.storage_backend<>'s3' THEN RAISE EXCEPTION 'S3 version required'; END IF;
 IF EXISTS(SELECT 1 FROM public.document_jobs WHERE organization_id=p_org AND version_id=p_version) THEN RETURN; END IF;
 IF v.state<>'UPLOADING' OR v.received_size<>v.expected_size OR v.expires_at<=now() OR v.attempts<>0
 THEN RAISE EXCEPTION 'upload not eligible'; END IF;
 INSERT INTO public.document_jobs(organization_id,version_id) VALUES(p_org,p_version);
 UPDATE public.document_versions SET state='SCANNING' WHERE organization_id=p_org AND id=p_version;
 INSERT INTO public.audit_events(organization_id,actor_kind,actor_id,supplier_actor_id,action,object_type,object_id,new_value,source)
 VALUES(p_org,
   CASE WHEN coalesce(authz.supply_writer(p_org),false) THEN 'user' ELSE 'supplier' END,
   CASE WHEN coalesce(authz.supply_writer(p_org),false) THEN authz.current_user_id() ELSE NULL END,
   CASE WHEN coalesce(authz.supply_writer(p_org),false) THEN NULL ELSE v.supplier_id END,
   'document.scan_queued','document',p_version,'{"state":"SCANNING"}'::jsonb,
   CASE WHEN coalesce(authz.supply_writer(p_org),false) THEN 'application' ELSE 'supplier_portal' END);
END $$;

CREATE FUNCTION authz.document_claim() RETURNS TABLE (
 organization_id uuid,version_id uuid,object_id uuid,lease_token uuid,
 expected_size integer,expected_sha256 text,claimed_mime text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.document_jobs; v public.document_versions; token uuid;
BEGIN
 SELECT q.* INTO j FROM public.document_jobs q
 WHERE (q.status='QUEUED' AND q.available_at<=now()) OR (q.status='LEASED' AND q.lease_until<=now())
 ORDER BY q.available_at,q.created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO STRICT v FROM public.document_versions d WHERE d.organization_id=j.organization_id AND d.id=j.version_id FOR UPDATE;
 IF v.attempts>=3 THEN
   UPDATE public.document_jobs q SET status='FAILED',lease_token=NULL,lease_until=NULL
    WHERE q.organization_id=j.organization_id AND q.version_id=j.version_id;
   UPDATE public.document_versions d SET state='SCAN_UNAVAILABLE',scan_result='{"status":"SCAN_UNAVAILABLE","reason":"LEASE_RETRIES_EXHAUSTED"}'::jsonb
    WHERE d.organization_id=j.organization_id AND d.id=j.version_id;
   INSERT INTO public.audit_events(organization_id,actor_kind,action,object_type,object_id,new_value,source)
    VALUES(j.organization_id,'system','document.scan_exhausted','document',j.version_id,
           '{"state":"SCAN_UNAVAILABLE"}'::jsonb,'document_worker');
   RETURN;
 END IF;
 token:=gen_random_uuid();
 UPDATE public.document_jobs q SET status='LEASED',lease_token=token,lease_until=now()+interval '5 minutes'
  WHERE q.organization_id=j.organization_id AND q.version_id=j.version_id;
 UPDATE public.document_versions d SET state='SCANNING',attempts=attempts+1
  WHERE d.organization_id=j.organization_id AND d.id=j.version_id;
 RETURN QUERY SELECT j.organization_id,j.version_id,j.object_id,token,v.expected_size,
                     v.metadata->>'expected_sha256',v.metadata->>'claimed_mime';
END $$;

CREATE FUNCTION authz.document_complete(p_org uuid,p_version uuid,p_token uuid,p_state text,
 p_storage_version text,p_sha256 text,p_mime text,p_result jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.document_jobs; v public.document_versions; retry boolean;
BEGIN
 SELECT * INTO j FROM public.document_jobs WHERE organization_id=p_org AND version_id=p_version FOR UPDATE;
 IF NOT FOUND OR j.status<>'LEASED' OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until<=now() THEN RETURN false; END IF;
 SELECT * INTO STRICT v FROM public.document_versions WHERE organization_id=p_org AND id=p_version FOR UPDATE;
 IF p_state IS NULL OR p_state NOT IN ('SCAN_PASSED','SCAN_REJECTED','SCAN_UNAVAILABLE','FORMAT_REJECTED') OR
    p_result IS NULL OR jsonb_typeof(p_result)<>'object' OR octet_length(p_result::text)>32768 OR
    p_result->>'status' IS DISTINCT FROM p_state
 THEN RAISE EXCEPTION 'invalid scan result'; END IF;
 IF p_storage_version IS NOT NULL AND (length(p_storage_version) NOT BETWEEN 1 AND 1024 OR p_storage_version='null') THEN RAISE EXCEPTION 'invalid storage version'; END IF;
 IF (p_storage_version IS NULL)<>(p_sha256 IS NULL) OR (p_sha256 IS NOT NULL AND p_sha256 !~ '^[0-9a-f]{64}$') THEN RAISE EXCEPTION 'invalid blob reference'; END IF;
 IF p_state IN ('SCAN_PASSED','SCAN_REJECTED','FORMAT_REJECTED') AND p_storage_version IS NULL THEN RAISE EXCEPTION 'missing blob reference'; END IF;
 IF p_state='SCAN_PASSED' AND (
    p_sha256 IS DISTINCT FROM v.metadata->>'expected_sha256' OR
    p_result->>'input_sha256' IS DISTINCT FROM p_sha256 OR
    p_result->>'engine_version' IS DISTINCT FROM '1.4.6' OR
    p_mime IS NULL OR p_mime NOT IN ('application/pdf','image/jpeg','image/png') OR
    p_mime IS DISTINCT FROM v.metadata->>'claimed_mime')
 THEN RAISE EXCEPTION 'incomplete scan evidence'; END IF;
 retry:=p_state='SCAN_UNAVAILABLE' AND v.attempts<3;
 -- Unavailable attempts do not seal a locator: a lost response can be retried.
 UPDATE public.document_versions SET state=p_state,scan_result=p_result,mime=p_mime,
   object_id=CASE WHEN p_state='SCAN_UNAVAILABLE' THEN object_id ELSE j.object_id END,
   sha256=CASE WHEN p_state='SCAN_UNAVAILABLE' THEN sha256 ELSE p_sha256 END,
   storage_version=CASE WHEN p_state='SCAN_UNAVAILABLE' THEN storage_version ELSE p_storage_version END
 WHERE organization_id=p_org AND id=p_version;
 UPDATE public.document_jobs SET status=CASE WHEN retry THEN 'QUEUED' WHEN p_state='SCAN_UNAVAILABLE' THEN 'FAILED' ELSE 'DONE' END,
   lease_token=NULL,lease_until=NULL,available_at=now()+interval '30 seconds'
 WHERE organization_id=p_org AND version_id=p_version;
 INSERT INTO public.audit_events(organization_id,actor_kind,action,object_type,object_id,new_value,source)
 VALUES(p_org,'system','document.scan_finished','document',p_version,
        jsonb_build_object('state',p_state,'attempt',v.attempts,'retry',retry),'document_worker');
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION authz.document_enqueue(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.document_claim() FROM PUBLIC;
REVOKE ALL ON FUNCTION authz.document_complete(uuid,uuid,uuid,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.document_enqueue(uuid,uuid) TO geoforest_app;
GRANT USAGE ON SCHEMA authz TO geoforest_document_worker;
GRANT EXECUTE ON FUNCTION authz.document_claim(),authz.document_complete(uuid,uuid,uuid,text,text,text,text,jsonb) TO geoforest_document_worker;
