import json
from uuid import uuid4

import pytest
from app.documents.worker import verify_worker_role
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from .helpers import enqueue


def claim(engines):
    with engines[2].begin() as c:
        return (
            c.execute(text("SELECT * FROM authz.document_claim()")).mappings().first()
        )


def complete(engines, job, state="SCAN_UNAVAILABLE", **changes):
    args = {
        "org": job["organization_id"],
        "version": job["version_id"],
        "token": job["lease_token"],
        "state": state,
        "sv": None,
        "sha": None,
        "mime": None,
        "result": json.dumps({"status": state, "reason": "SYNTHETIC"}),
    }
    args.update(changes)
    with engines[2].begin() as c:
        return c.execute(
            text(
                "SELECT authz.document_complete(:org,:version,:token,:state,:sv,:sha,:mime,CAST(:result AS jsonb))"
            ),
            args,
        ).scalar_one()


def expire(engines):
    with engines[0].begin() as c:
        c.execute(
            text(
                "UPDATE document_jobs SET lease_until=now()-interval '1 second' WHERE status='LEASED'"
            )
        )
        c.execute(
            text(
                "UPDATE document_jobs SET available_at=now()-interval '1 second' WHERE status='QUEUED'"
            )
        )


def test_least_privilege(engines):
    verify_worker_role(engines[2])
    for engine in engines[:2]:
        with pytest.raises(RuntimeError):
            verify_worker_role(engine)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM users",
        "SELECT * FROM suppliers",
        "SELECT * FROM document_versions",
        "SELECT * FROM document_jobs",
        "SELECT * FROM audit_events",
        "UPDATE document_jobs SET status='DONE'",
        "DELETE FROM document_versions",
        "SELECT authz.document_enqueue(gen_random_uuid(),gen_random_uuid())",
        "SELECT authz.create_organization('forbidden')",
    ],
)
def test_worker_cannot_read_or_mutate_business_tables(engines, sql):
    with pytest.raises(DBAPIError):
        with engines[2].begin() as c:
            c.execute(text(sql))


@pytest.mark.parametrize(
    "sql", ["SELECT * FROM authz.document_claim()", "SELECT * FROM document_jobs"]
)
def test_api_cannot_claim_or_read_queue(engines, sql):
    with pytest.raises(DBAPIError):
        with engines[1].begin() as c:
            c.execute(text(sql))


def test_enqueue_idempotent_claim_once_minimal_payload(engines, seed):
    v = seed()
    enqueue(engines[1], v)
    enqueue(engines[1], v)
    j = claim(engines)
    assert j["expected_sha256"] == v["sha"]
    assert set(j) == {
        "organization_id",
        "version_id",
        "object_id",
        "lease_token",
        "expected_size",
        "expected_sha256",
        "claimed_mime",
    }
    assert claim(engines) is None
    assert complete(engines, j)
    assert not complete(engines, j)  # Lost completion response cannot duplicate audit.
    with engines[0].begin() as c:
        a = c.execute(
            text(
                "SELECT actor_kind,actor_id,source FROM audit_events WHERE action='document.scan_finished'"
            )
        ).one()
        assert tuple(a) == ("system", None, "document_worker")


@pytest.mark.parametrize("role", ["Viewer", "Analyst"])
def test_readonly_members_cannot_enqueue(engines, seed, role):
    with pytest.raises(DBAPIError):
        enqueue(engines[1], seed(role=role))


def test_cross_tenant_enqueue_refused(engines, seed):
    a, b = seed(), seed()
    with pytest.raises(DBAPIError):
        enqueue(engines[1], b, org=a["org"], user=a["user"])
    assert claim(engines) is None


@pytest.mark.parametrize("kwargs", [{"backend": "local"}, {"received": 0}])
def test_ineligible_upload_refused(engines, seed, kwargs):
    with pytest.raises(DBAPIError):
        enqueue(engines[1], seed(**kwargs))


def test_expired_upload_refused(engines, seed):
    v = seed()
    # expires_at is immutable: change clock relative eligibility by seeding via a new row.
    with engines[0].begin() as c:
        c.execute(text("DELETE FROM document_versions WHERE id=:version"), v)
        c.execute(
            text("""INSERT INTO document_versions(organization_id,supplier_id,document_id,id,version,request_id,input_sha256,metadata,
            expected_size,received_size,actor_id,actor_kind,storage_backend,expires_at)
            VALUES(:org,:supplier,:document,:version,1,:request,:sha,'{}',:size,:size,:user,'user','s3',now()-interval '1 hour')"""),
            v,
        )
    with pytest.raises(DBAPIError):
        enqueue(engines[1], v)


def test_lease_fencing_and_three_crash_limit(engines, seed):
    enqueue(engines[1], seed())
    old = claim(engines)
    expire(engines)
    new = claim(engines)
    assert new["lease_token"] != old["lease_token"]
    assert new["object_id"] == old["object_id"]
    assert not complete(engines, old)
    expire(engines)
    assert not complete(
        engines, new
    )  # Expiration alone fences before a replacement claim.
    assert claim(engines)
    expire(engines)
    assert claim(engines) is None
    with engines[0].begin() as c:
        assert c.execute(
            text("SELECT state,attempts FROM document_versions")
        ).one() == ("SCAN_UNAVAILABLE", 3)
        assert (
            c.execute(text("SELECT status FROM document_jobs")).scalar_one() == "FAILED"
        )
        assert (
            c.execute(
                text(
                    "SELECT count(*) FROM audit_events WHERE action='document.scan_exhausted'"
                )
            ).scalar_one()
            == 1
        )


def test_unavailable_backoff_and_limit(engines, seed):
    enqueue(engines[1], seed())
    for attempt in range(3):
        j = claim(engines)
        assert j and complete(engines, j)
        assert claim(engines) is None
        expire(engines)
    assert claim(engines) is None


def test_wrong_token_or_org_cannot_finalize(engines, seed):
    enqueue(engines[1], seed())
    j = claim(engines)
    assert not complete(engines, j, token=uuid4())
    assert not complete(engines, j, org=uuid4())
    assert complete(engines, j)


@pytest.mark.parametrize(
    "changes",
    [
        {"state": "SCAN_PASSED", "result": '{"status":"SCAN_PASSED"}'},
        {"state": "INVALID"},
        {"result": "null"},
        {"result": "[]"},
        {"sv": "null", "sha": "0" * 64},
        {"sv": "opaque", "sha": "bad"},
        {"result": '{"status":"SCAN_UNAVAILABLE","extra":"' + "x" * 33000 + '"}'},
    ],
)
def test_invalid_result_rejected_atomically(engines, seed, changes):
    enqueue(engines[1], seed())
    j = claim(engines)
    with pytest.raises(DBAPIError):
        complete(engines, j, **changes)
    assert complete(engines, j)


def test_concurrent_claim_skips_locked_job(engines, seed):
    a, b = seed(), seed()
    enqueue(engines[1], a)
    enqueue(engines[1], b)
    with engines[2].begin() as first:
        j = first.execute(text("SELECT * FROM authz.document_claim()")).mappings().one()
        other = claim(engines)
        assert other and other["version_id"] != j["version_id"]
    assert claim(engines) is None


def test_portal_scoped_enqueue_and_revocation(engines, seed):
    a, b = seed(), seed()
    invitation = uuid4()
    with engines[0].begin() as c:
        c.execute(
            text("""INSERT INTO supplier_invitations(organization_id,supplier_id,id,token_hash,created_by,expires_at)
          VALUES(:org,:supplier,:inv,'synthetic-invitation',:user,now()+interval '1 hour')"""),
            a | {"inv": invitation},
        )
        c.execute(
            text("""INSERT INTO supplier_sessions(token_hash,organization_id,supplier_id,invitation_id,csrf_token,expires_at)
          VALUES('synthetic-session',:org,:supplier,:inv,'synthetic-csrf',now()+interval '1 hour')"""),
            a | {"inv": invitation},
        )
    with pytest.raises(DBAPIError):
        enqueue(engines[1], b, user="", portal="synthetic-session")
    with engines[0].begin() as c:
        c.execute(text("UPDATE supplier_sessions SET revoked_at=now()"))
    with pytest.raises(DBAPIError):
        enqueue(engines[1], a, user="", portal="synthetic-session")
    with engines[0].begin() as c:
        c.execute(text("UPDATE supplier_sessions SET revoked_at=NULL"))
    enqueue(engines[1], a, user="", portal="synthetic-session")
    assert claim(engines)["organization_id"] == a["org"]


def test_api_cannot_forge_system_audit(engines, seed):
    v = seed()
    with pytest.raises(DBAPIError):
        with engines[1].begin() as c:
            c.execute(
                text(
                    "SELECT set_config('app.user_id',:u,true),set_config('app.organization_id',:o,true)"
                ),
                {"u": str(v["user"]), "o": str(v["org"])},
            )
            c.execute(
                text("""INSERT INTO audit_events(organization_id,actor_kind,action,object_type,object_id,source)
              VALUES(:org,'system','forged','document',:version,'document_worker')"""),
                v,
            )


def test_privilege_drift_is_refused(engines):
    with engines[0].begin() as c:
        c.execute(text("GRANT SELECT(email) ON users TO geoforest_document_worker"))
    try:
        with pytest.raises(RuntimeError):
            verify_worker_role(engines[2])
    finally:
        with engines[0].begin() as c:
            c.execute(
                text("REVOKE SELECT(email) ON users FROM geoforest_document_worker")
            )
    verify_worker_role(engines[2])


def test_queue_can_be_resumed_after_identity_revocation(engines, seed):
    v = seed()
    enqueue(engines[1], v)
    with engines[0].begin() as c:
        c.execute(text("DELETE FROM memberships WHERE organization_id=:org"), v)
    j = claim(engines)
    assert j and complete(engines, j)
    # No still-valid human session is required to record the system result.
    with pytest.raises(DBAPIError):
        enqueue(engines[1], v)


def test_enqueue_audit_is_atomic_and_idempotent(engines, seed):
    v = seed()
    enqueue(engines[1], v)
    enqueue(engines[1], v)
    with engines[0].begin() as c:
        assert c.execute(
            text(
                "SELECT actor_kind,actor_id,source FROM audit_events WHERE action='document.scan_queued'"
            )
        ).one() == ("user", v["user"], "application")
