"""Opt-in API integration against local 0007 + candidate, Moto S3, synthetic AV.

Run with DATABASE_URL/MIGRATION_DATABASE_URL pointing at geoforest_queue_test.
Never upgrades a database automatically. General suite skips this on plain 0007.
"""

from uuid import UUID

import boto3
import pytest
from app.config import settings
from app.documents import processing
from app.documents.s3_store import S3Store
from app.documents.storage import StorageError
from app.documents.worker import run_once
from conftest import owner
from document_worker.test_worker import SyntheticScanner
from moto import mock_aws
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool
from test_documents_api import accept, png, reserve, upload
from test_supply import invitation, portal, supplier, workspace

assert workspace


@pytest.fixture(autouse=True)
def s3_api(tmp_path, monkeypatch):
    if owner.url.host != "127.0.0.1" or owner.url.database != "geoforest_queue_test":
        pytest.skip(
            "S3 API candidate suite requires local geoforest_queue_test explicitly"
        )
    tmp_path.chmod(0o700)
    monkeypatch.setattr(settings(), "document_storage_root", str(tmp_path))
    monkeypatch.setattr(settings(), "documents_enabled", True)
    monkeypatch.setattr(settings(), "document_storage_backend", "s3")
    monkeypatch.setattr(settings(), "document_s3_api_test", True)
    with mock_aws():
        c = boto3.client(
            "s3",
            region_name="eu-west-3",
            aws_access_key_id="synthetic",
            aws_secret_access_key="synthetic",
        )
        b = "geoforest-api-synthetic"
        c.create_bucket(
            Bucket=b, CreateBucketConfiguration={"LocationConstraint": "eu-west-3"}
        )
        c.put_bucket_versioning(Bucket=b, VersioningConfiguration={"Status": "Enabled"})
        c.put_public_access_block(
            Bucket=b,
            PublicAccessBlockConfiguration={
                k: True
                for k in (
                    "BlockPublicAcls",
                    "IgnorePublicAcls",
                    "BlockPublicPolicy",
                    "RestrictPublicBuckets",
                )
            },
        )
        c.put_bucket_encryption(
            Bucket=b,
            ServerSideEncryptionConfiguration={
                "Rules": [
                    {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}
                ]
            },
        )
        store = S3Store(c, b)
        monkeypatch.setattr(processing, "s3_store", lambda: store)
        yield store


@pytest.fixture
def worker():
    e = create_engine(
        owner.url.set(
            username="geoforest_worker_test", password="local-synthetic-worker-password"
        ),
        poolclass=NullPool,
    )
    yield lambda store, status="SCAN_PASSED": run_once(
        e, store, SyntheticScanner(status)
    )
    e.dispose()


def endpoint(path, v):
    return path + "/documents/uploads/" + v["id"]


def download_url(path, v):
    return path + "/documents/versions/" + v["id"] + "/download"


def state(v):
    with owner.begin() as c:
        return (
            c.execute(
                text("SELECT * FROM document_versions WHERE id=:id"), {"id": v["id"]}
            )
            .mappings()
            .one()
        )


def test_api_upload_queue_worker_download_and_review(client, workspace, s3_api, worker):
    _, org, path = workspace
    s = supplier(client, path)
    v, body, data = upload(client, path, s["id"])
    assert v["state"] == "SCANNING" and v["processing_mode"] == "background"
    assert state(v)["storage_backend"] == "s3"
    assert client.get(download_url(path, v)).status_code == 409
    r = client.post(
        path + "/documents/versions/" + v["id"] + "/reviews",
        json={
            "decision": "ACCEPTED",
            "note": "Tentative prématurée de revue synthétique.",
        },
    )
    assert r.status_code == 409
    assert worker(s3_api)["accepted"]
    r = client.get(download_url(path, v))
    assert r.status_code == 200 and r.content == data
    assert r.headers["content-security-policy"].startswith("sandbox")
    assert r.headers["content-disposition"].startswith("attachment;")
    assert client.post(endpoint(path, v) + "/finish").json()["state"] == "SCAN_PASSED"
    assert client.post(path + "/documents/uploads", json=body).json()["id"] == v["id"]
    listed = client.get(path + "/documents").json()["items"][0]
    assert not {
        "object_id",
        "storage_version",
        "storage_backend",
        "input_sha256",
        "actor_id",
    } & set(listed)
    accept(client, path, v)
    with owner.begin() as c:
        assert (
            c.execute(
                text(
                    "SELECT count(*) FROM audit_events WHERE object_id=:id AND action='document.scan_queued'"
                ),
                {"id": v["id"]},
            ).scalar_one()
            == 1
        )
        assert (
            c.execute(
                text(
                    "SELECT actor_kind FROM audit_events WHERE object_id=:id AND action='document.scan_finished'"
                ),
                {"id": v["id"]},
            ).scalar_one()
            == "system"
        )


def test_finish_does_not_run_scanner_or_session_lock(
    client, workspace, s3_api, monkeypatch
):
    _, _, path = workspace

    def forbidden(*args, **kwargs):
        raise AssertionError("Long synchronous work in API")

    monkeypatch.setattr(processing, "scan", forbidden)
    monkeypatch.setattr(processing, "scan_slot", forbidden)
    v, _, _ = upload(client, path, supplier(client, path)["id"])
    for _ in range(2):
        assert client.post(endpoint(path, v) + "/finish").json()["state"] == "SCANNING"
    with owner.begin() as c:
        assert c.execute(text("SELECT count(*) FROM document_jobs")).scalar_one() == 1
        assert (
            c.execute(text("SELECT attempts FROM document_versions")).scalar_one() == 0
        )


def test_chunks_boundaries_replay_and_conflict(client, workspace, s3_api):
    _, _, path = workspace
    data = b"x" * 64000 + b"end"
    v, _, _ = reserve(client, path, supplier(client, path)["id"], data=data)
    url = endpoint(path, v) + "/chunks"
    assert client.put(url + "?offset=64000", content=b"end").status_code == 409
    assert client.put(url + "?offset=0", content=data[:65536]).status_code == 409
    assert (
        client.put(url + "?offset=0", content=data[:64000]).json()["received_size"]
        == 64000
    )
    assert (
        client.put(url + "?offset=0", content=data[:64000]).json()["received_size"]
        == 64000
    )
    assert client.put(url + "?offset=0", content=b"y" * 64000).status_code == 409
    assert client.put(url + "?offset=64000", content=b"end").json()[
        "received_size"
    ] == len(data)
    assert client.post(endpoint(path, v) + "/finish").status_code == 200
    assert client.put(url + "?offset=64000", content=b"end").status_code == 409


def test_lost_storage_response_leaves_offset_retriable(
    client, workspace, s3_api, monkeypatch
):
    _, _, path = workspace
    v, _, data = reserve(client, path, supplier(client, path)["id"])
    real = s3_api.put_chunk

    def lost(*args, **kwargs):
        real(*args, **kwargs)
        raise StorageError("SYNTHETIC_RESPONSE_LOST")

    monkeypatch.setattr(s3_api, "put_chunk", lost)
    url = endpoint(path, v) + "/chunks?offset=0"
    assert client.put(url, content=data).status_code == 503
    assert state(v)["received_size"] == 0
    monkeypatch.setattr(s3_api, "put_chunk", real)
    assert client.put(url, content=data).json()["received_size"] == len(data)
    assert (
        len(s3_api.client.list_object_versions(Bucket=s3_api.bucket)["Versions"]) == 1
    )


def test_incomplete_cannot_enqueue(client, workspace):
    _, _, path = workspace
    v, _, _ = reserve(client, path, supplier(client, path)["id"])
    assert client.post(endpoint(path, v) + "/finish").status_code == 409
    with owner.begin() as c:
        assert c.execute(text("SELECT count(*) FROM document_jobs")).scalar_one() == 0


def test_private_bucket_failure_rolls_back_reservation(client, workspace, s3_api):
    _, _, path = workspace
    s = supplier(client, path)
    s3_api.client.put_bucket_versioning(
        Bucket=s3_api.bucket, VersioningConfiguration={"Status": "Suspended"}
    )
    data = png()
    import hashlib
    from uuid import uuid4

    r = client.post(
        path + "/documents/uploads",
        json={
            "request_id": str(uuid4()),
            "supplier_id": s["id"],
            "title": "Fichier fictif",
            "original_name": "fiction.png",
            "claimed_mime": "image/png",
            "size": len(data),
            "expected_sha256": hashlib.sha256(data).hexdigest(),
        },
    )
    assert r.status_code == 503
    with owner.begin() as c:
        assert c.execute(text("SELECT count(*) FROM documents")).scalar_one() == 0


@pytest.mark.parametrize("status", ["SCAN_REJECTED", "SCAN_UNAVAILABLE"])
def test_failed_checks_never_download(client, workspace, s3_api, worker, status):
    _, _, path = workspace
    v, _, _ = upload(client, path, supplier(client, path)["id"])
    worker(s3_api, status)
    assert client.get(download_url(path, v)).status_code == 409
    assert state(v)["state"] == status


def test_three_unavailable_attempts_cannot_be_reset_by_finish(
    client, workspace, s3_api, worker
):
    _, _, path = workspace
    v, _, _ = upload(client, path, supplier(client, path)["id"])
    for _ in range(3):
        worker(s3_api, "SCAN_UNAVAILABLE")
        with owner.begin() as c:
            c.execute(
                text("UPDATE document_jobs SET available_at=now()-interval '1 second'")
            )
    assert state(v)["attempts"] == 3
    assert client.post(endpoint(path, v) + "/finish").status_code == 409
    assert client.get(download_url(path, v)).status_code == 409


def test_version_pinned_download_not_latest(client, workspace, s3_api, worker):
    _, _, path = workspace
    v, _, data = upload(client, path, supplier(client, path)["id"])
    worker(s3_api)
    r = state(v)
    key = s3_api.key(r["organization_id"], r["object_id"])
    s3_api.client.put_object(
        Bucket=s3_api.bucket, Key=key, Body=b"changed", ServerSideEncryption="AES256"
    )
    assert client.get(download_url(path, v)).content == data
    s3_api.client.delete_object(
        Bucket=s3_api.bucket, Key=key, VersionId=r["storage_version"]
    )
    response = client.get(download_url(path, v))
    assert response.status_code == 503 and data not in response.content


def test_other_organization_cannot_read_chunk_finish_or_download(
    client, workspace, identity, org, signin, s3_api, monkeypatch
):
    _, _, path = workspace
    v, _, data = upload(client, path, supplier(client, path)["id"])
    outsider = identity()
    other = org(outsider["id"])
    signin(client, outsider)

    def forbidden(*args, **kwargs):
        raise AssertionError("Unauthorized request touched S3")

    monkeypatch.setattr(s3_api, "put_chunk", forbidden)
    monkeypatch.setattr(s3_api, "open_verified", forbidden)
    otherpath = f"/api/v1/organizations/{other}"
    assert client.get(otherpath + "/documents").json()["items"] == []
    assert (
        client.put(
            endpoint(otherpath, v) + "/chunks?offset=0", content=data
        ).status_code
        == 404
    )
    assert client.post(endpoint(otherpath, v) + "/finish").status_code == 404
    assert client.get(download_url(otherpath, v)).status_code == 404


def test_portal_scoped_upload_and_download(client, workspace, s3_api, worker):
    _, _, path = workspace
    a, b = supplier(client, path, "AA"), supplier(client, path, "BB")
    portal_a, _ = portal(invitation(client, path, a["id"]))
    portal_b, _ = portal(invitation(client, path, b["id"]))
    v, _, data = upload(portal_a, "/api/portal", None)
    assert client.get(path + "/documents").json()["items"][0]["id"] == v["id"]
    assert portal_b.post(endpoint("/api/portal", v) + "/finish").status_code == 404
    assert portal_b.get(download_url("/api/portal", v)).status_code == 404
    worker(s3_api)
    assert portal_a.get(download_url("/api/portal", v)).content == data
    assert portal_b.get(download_url("/api/portal", v)).status_code == 404
    with owner.begin() as c:
        assert c.execute(
            text(
                "SELECT actor_kind,supplier_actor_id FROM audit_events WHERE action='document.scan_queued'"
            )
        ).one() == ("supplier", UUID(a["id"]))


def test_quota_preserved_for_s3(client, workspace, monkeypatch):
    _, _, path = workspace
    s = supplier(client, path)
    v, body, _ = reserve(client, path, s["id"])
    monkeypatch.setattr(settings(), "document_quota_bytes", len(png()))
    from uuid import uuid4

    assert (
        client.post(
            path + "/documents/uploads", json=body | {"request_id": str(uuid4())}
        ).status_code
        == 409
    )


def test_reauthorize_after_s3_read_before_download(
    client, workspace, s3_api, worker, monkeypatch
):
    user, org, path = workspace
    v, _, _ = upload(client, path, supplier(client, path)["id"])
    worker(s3_api)
    real = s3_api.open_verified
    opened = []

    def revoke(blob):
        f = real(blob)
        opened.append(f)
        with owner.begin() as c:
            c.execute(
                text(
                    "DELETE FROM memberships WHERE organization_id=:org AND user_id=:user"
                ),
                {"org": org, "user": user["id"]},
            )
        return f

    monkeypatch.setattr(s3_api, "open_verified", revoke)
    assert client.get(download_url(path, v)).status_code == 404
    assert opened and opened[0].closed
    with owner.begin() as c:
        assert (
            c.execute(
                text(
                    "SELECT count(*) FROM audit_events WHERE action='document.downloaded'"
                )
            ).scalar_one()
            == 0
        )


def test_old_local_version_readable_but_not_resumed_on_s3(
    client, workspace, s3_api, worker, monkeypatch
):
    _, _, path = workspace
    s = supplier(client, path)
    monkeypatch.setattr(settings(), "document_storage_backend", "local")
    monkeypatch.setattr(
        processing,
        "scan",
        lambda blob: {
            "status": "SCAN_PASSED",
            "reason": "SYNTHETIC",
            "input_sha256": blob.sha256,
        },
    )
    old, _, data = upload(client, path, s["id"])
    unfinished, _, _ = reserve(client, path, s["id"])
    monkeypatch.setattr(settings(), "document_storage_backend", "s3")
    assert client.get(download_url(path, old)).content == data
    assert client.post(endpoint(path, unfinished) + "/finish").status_code == 409
    assert (
        client.put(
            endpoint(path, unfinished) + "/chunks?offset=0", content=data
        ).status_code
        == 409
    )
    new, _, _ = upload(client, path, s["id"], document_id=old["document_id"])
    assert new["version"] == 2 and new["processing_mode"] == "background"
    worker(s3_api)
    assert client.get(download_url(path, new)).content == data


def test_readonly_role_cannot_upload_or_finish(
    client, workspace, identity, membership, signin, s3_api, worker
):
    _, org, path = workspace
    s = supplier(client, path)
    v, body, data = upload(client, path, s["id"])
    viewer = identity()
    membership(org, viewer["id"], "Viewer")
    signin(client, viewer)
    assert client.post(path + "/documents/uploads", json=body).status_code == 403
    assert (
        client.put(endpoint(path, v) + "/chunks?offset=0", content=data).status_code
        == 403
    )
    assert client.post(endpoint(path, v) + "/finish").status_code == 403
    worker(s3_api)
    assert client.get(download_url(path, v)).content == data
    assert (
        client.post(
            path + "/documents/versions/" + v["id"] + "/reviews",
            json={
                "decision": "ACCEPTED",
                "note": "Revue fictive interdite au lecteur.",
            },
        ).status_code
        == 403
    )


def test_supplier_revocation_during_s3_download_closes_stream(
    client, workspace, s3_api, worker, monkeypatch
):
    _, _, path = workspace
    s = supplier(client, path)
    pc, _ = portal(invitation(client, path, s["id"]))
    v, _, _ = upload(pc, "/api/portal", None)
    worker(s3_api)
    real = s3_api.open_verified
    streams = []

    def revoke(blob):
        f = real(blob)
        streams.append(f)
        with owner.begin() as c:
            c.execute(text("UPDATE supplier_sessions SET revoked_at=now()"))
        return f

    monkeypatch.setattr(s3_api, "open_verified", revoke)
    assert pc.get(download_url("/api/portal", v)).status_code == 401
    assert streams[0].closed


def test_s3_locators_do_not_bypass_activation_gate(
    client, workspace, s3_api, worker, monkeypatch
):
    _, _, path = workspace
    v, _, _ = upload(client, path, supplier(client, path)["id"])
    worker(s3_api)
    monkeypatch.setattr(settings(), "document_storage_backend", "local")
    monkeypatch.setattr(settings(), "document_s3_api_test", False)
    assert client.get(download_url(path, v)).status_code == 503
    assert client.post(endpoint(path, v) + "/finish").status_code == 503
