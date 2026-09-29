import io
import json

import pytest
from PIL import Image
from sqlalchemy import text


def png():
    data = io.BytesIO()
    Image.new("RGB", (4, 5), "green").save(data, format="PNG")
    return data.getvalue()


def test_service_sandbox_boundary(service):
    result = service("probe")
    assert result.returncode == 0, result.stderr + "\n" + result.stdout
    assert json.loads(json.loads(result.stdout)["output"])["boundary"] == "PASS"


def test_service_old_profile_refuses_sandbox(service):
    result = service("probe", deny_namespaces=True)
    assert result.returncode != 0
    observed = json.loads(result.stdout)
    assert observed["returncode"] != 0 or observed["error"] is not None


def state(db, ids):
    with db.connect() as c:
        row = (
            c.execute(
                text(
                    "SELECT * FROM document_versions WHERE organization_id=:org AND id=:version"
                ),
                ids,
            )
            .mappings()
            .one()
        )
        job = (
            c.execute(
                text(
                    "SELECT * FROM document_jobs WHERE organization_id=:org AND version_id=:version"
                ),
                ids,
            )
            .mappings()
            .one()
        )
        return dict(row), dict(job)


def assert_done(db, ids, expected):
    row, job = state(db, ids)
    assert row["state"] == expected and job["status"] == "DONE"
    assert row["storage_version"] and row["scan_result"]["status"] == expected
    with db.connect() as c:
        assert (
            c.execute(
                text(
                    "SELECT count(*) FROM document_reviews WHERE organization_id=:org AND version_id=:version"
                ),
                ids,
            ).scalar_one()
            == 0
        )
        assert (
            c.execute(
                text(
                    "SELECT count(*) FROM audit_events WHERE organization_id=:org AND object_id=:version AND action='document.scan_finished' AND actor_kind='system' AND source='document_worker'"
                ),
                ids,
            ).scalar_one()
            >= 1
        )
    return row


def test_real_worker_pg_s3_scan_parser_commit(service, prepared, db, storage):
    from app.documents.storage import Blob

    ids = prepared(png())
    result = service()
    assert result.returncode == 0 and json.loads(result.stdout) == {
        "job": True,
        "accepted": True,
    }, result.stdout + result.stderr
    row = assert_done(db, ids, "SCAN_PASSED")
    assert row["mime"] == "image/png" and row["attempts"] == 1
    blob = Blob(
        ids["org"],
        row["object_id"],
        row["expected_size"],
        row["sha256"],
        row["storage_version"],
    )
    with storage.open_verified(blob) as f:
        assert f.read() == png()


def test_real_eicar_stays_rejected(service, prepared, db):
    eicar = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    ids = prepared(eicar)
    result = service()
    assert result.returncode == 0, result.stdout + result.stderr
    assert assert_done(db, ids, "SCAN_REJECTED")["mime"] is None


def test_bad_namespace_no_fallback_and_bounded_attempts(service, prepared, db):
    ids = prepared(png())
    for attempt in range(1, 4):
        result = service(deny_namespaces=True)
        assert result.returncode == 0  # committed UNAVAILABLE is not a favorable scan
        row, job = state(db, ids)
        assert row["state"] == "SCAN_UNAVAILABLE" and row["storage_version"] is None
        assert row["attempts"] == attempt
        assert job["status"] == ("FAILED" if attempt == 3 else "QUEUED")
        if attempt < 3:
            with db.begin() as c:
                c.execute(
                    text(
                        "UPDATE document_jobs SET available_at=now()-interval '1 second' WHERE organization_id=:org AND version_id=:version"
                    ),
                    ids,
                )
    assert json.loads(service().stdout) == {"job": False}


@pytest.mark.parametrize(
    "mode,deadline", [("crash-after-object", "270s"), ("hang-after-object", "4s")]
)
def test_interruption_then_version_preserving_retry(
    service, prepared, db, storage, mode, deadline
):
    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    from .conftest import WORKER_URL

    ids = prepared(png())
    killed = service(mode, deadline=deadline)
    assert killed.returncode != 0
    row, job = state(db, ids)
    assert row["state"] == "SCANNING" and row["storage_version"] is None
    assert job["status"] == "LEASED" and row["attempts"] == 1
    key = storage.key(ids["org"], job["object_id"])
    original = storage.client.list_object_versions(Bucket=storage.bucket, Prefix=key)[
        "Versions"
    ]
    assert len(original) == 1
    with db.begin() as c:
        c.execute(
            text(
                "UPDATE document_jobs SET lease_until=now()-interval '1 second' WHERE organization_id=:org AND version_id=:version"
            ),
            ids,
        )
    worker = create_engine(WORKER_URL, poolclass=NullPool)
    try:
        with worker.begin() as c:
            accepted = c.execute(
                text(
                    "SELECT authz.document_complete(:org,:version,:token,'SCAN_UNAVAILABLE',NULL,NULL,NULL,CAST(:result AS jsonb))"
                ),
                ids
                | {
                    "token": job["lease_token"],
                    "result": '{"status":"SCAN_UNAVAILABLE"}',
                },
            ).scalar_one()
            assert accepted is False
    finally:
        worker.dispose()
    resumed = service()
    assert resumed.returncode == 0, resumed.stdout + resumed.stderr
    row = assert_done(db, ids, "SCAN_PASSED")
    assert row["attempts"] == 2
    assert row["storage_version"] == original[0]["VersionId"]
    assert (
        len(
            storage.client.list_object_versions(Bucket=storage.bucket, Prefix=key)[
                "Versions"
            ]
        )
        == 1
    )


def test_privileged_sql_identity_refused_before_claim(service, prepared, db):
    from .conftest import URL

    ids = prepared(png())
    result = service(worker_url=URL)
    assert result.returncode != 0 and json.loads(result.stdout) == {
        "error": "WORKER_UNAVAILABLE"
    }
    row, job = state(db, ids)
    assert (
        row["state"] == "SCANNING"
        and row["attempts"] == 0
        and job["status"] == "QUEUED"
    )


def test_public_bucket_guard_unchanged(service, prepared, db, storage):
    ids = prepared(png())
    storage.client.delete_public_access_block(Bucket=storage.bucket)
    result = service()
    assert result.returncode != 0 and json.loads(result.stdout) == {
        "error": "WORKER_UNAVAILABLE"
    }
    row, job = state(db, ids)
    assert row["attempts"] == 0 and job["status"] == "QUEUED"


def test_sql_worker_permissions_and_app_cross_org(prepared, db):
    from sqlalchemy import create_engine
    from sqlalchemy.exc import DBAPIError
    from sqlalchemy.pool import NullPool

    from .conftest import URL, WORKER_URL

    first, other = prepared(png()), prepared(png())
    worker = create_engine(WORKER_URL, poolclass=NullPool)
    app = create_engine(
        URL.replace(
            "geoforest_migrator:local-test-migrator-password",
            "geoforest_app:local-test-app-password",
        ),
        poolclass=NullPool,
    )
    try:
        for sql in [
            "SELECT * FROM document_versions",
            "UPDATE document_jobs SET status='FAILED'",
            "SELECT * FROM users",
        ]:
            with pytest.raises(DBAPIError):
                with worker.begin() as c:
                    c.execute(text(sql))
        with app.begin() as c:
            c.execute(
                text(
                    "SELECT set_config('app.user_id',:user,true),set_config('app.organization_id',:org,true)"
                ),
                {"user": str(first["user"]), "org": str(first["org"])},
            )
            assert (
                c.execute(
                    text(
                        "SELECT count(*) FROM document_versions WHERE organization_id=:org"
                    ),
                    {"org": other["org"]},
                ).scalar_one()
                == 0
            )
    finally:
        worker.dispose()
        app.dispose()


def test_active_pdf_rejected_by_isolated_parser(service, prepared, db):
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject

    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer._add_object(DictionaryObject({NameObject("/S"): NameObject("/Launch")}))
    stream = io.BytesIO()
    writer.write(stream)
    ids = prepared(stream.getvalue(), mime="application/pdf")
    result = service()
    assert result.returncode == 0, result.stdout + result.stderr
    row = assert_done(db, ids, "FORMAT_REJECTED")
    assert row["mime"] is None
