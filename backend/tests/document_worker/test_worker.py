import io
import json

import pytest
from app.documents.scanner import Scanner, ScanResult
from app.documents.storage import Blob
from app.documents.worker import WorkerSettings, execute_job, run_once
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from .helpers import enqueue
from .test_queue import claim, complete, expire


class SyntheticScanner:
    def __init__(self, status="SCAN_PASSED"):
        self.status = status
        self.calls = 0

    def scan(self, storage, blob):
        self.calls += 1
        return ScanResult(
            self.status,
            "SYNTHETIC_ONLY",
            engine_version="1.4.6",
            input_sha256=blob.sha256,
        )


def png():
    f = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(f, format="PNG")
    return f.getvalue()


def prepare(engines, seed, store, data, **kwargs):
    v = seed(data=data, **kwargs)
    store.put_chunk(v["org"], v["version"], 0, data, len(data))
    enqueue(engines[1], v)
    return v


def row(engines):
    with engines[0].begin() as c:
        return c.execute(text("SELECT * FROM document_versions")).mappings().one()


def test_full_queue_storage_worker_and_sealed_result(engines, seed, store):
    data = png()
    v = prepare(engines, seed, store, data)
    assert run_once(engines[2], store, SyntheticScanner()) == {
        "job": True,
        "accepted": True,
    }
    r = row(engines)
    assert r["state"] == "SCAN_PASSED" and r["mime"] == "image/png"
    assert r["storage_backend"] == "s3" and r["storage_version"]
    blob = Blob(
        v["org"], r["object_id"], r["expected_size"], r["sha256"], r["storage_version"]
    )
    with store.open_verified(blob) as f:
        assert f.read() == data
    with pytest.raises(DBAPIError):
        with engines[0].begin() as c:
            c.execute(text("UPDATE document_versions SET storage_version='different'"))
    assert run_once(engines[2], store, SyntheticScanner()) == {"job": False}


@pytest.mark.parametrize(
    "status,expected",
    [("SCAN_REJECTED", "SCAN_REJECTED"), ("SCAN_UNAVAILABLE", "SCAN_UNAVAILABLE")],
)
def test_antivirus_failures_do_not_release(engines, seed, store, status, expected):
    prepare(engines, seed, store, png())
    run_once(engines[2], store, SyntheticScanner(status))
    r = row(engines)
    assert r["state"] == expected and r["mime"] is None


def test_invalid_format_rejected_after_scan(engines, seed, store):
    prepare(engines, seed, store, b"not a PNG")
    run_once(engines[2], store, SyntheticScanner())
    assert row(engines)["state"] == "FORMAT_REJECTED"


def test_integrity_mismatch_does_not_even_scan(engines, seed, store):
    prepare(engines, seed, store, png(), sha="0" * 64)
    scanner = SyntheticScanner()
    run_once(engines[2], store, scanner)
    assert row(engines)["state"] == "FORMAT_REJECTED"
    assert scanner.calls == 0


def test_missing_staging_and_missing_clamav_fail_closed(engines, seed, store, tmp_path):
    v = seed(data=png())
    enqueue(engines[1], v)
    run_once(engines[2], store, SyntheticScanner())
    assert row(engines)["state"] == "SCAN_UNAVAILABLE"
    store.put_chunk(v["org"], v["version"], 0, png(), len(png()))
    expire(engines)
    scanner = Scanner(tmp_path / "not-installed", tmp_path / "no-signatures")
    assert run_once(engines[2], store, scanner)["accepted"]
    assert row(engines)["state"] == "SCAN_UNAVAILABLE"


def test_crash_after_s3_write_reuses_object_and_rejects_old_lease(engines, seed, store):
    prepare(engines, seed, store, png())
    first = claim(engines)
    blob, result, mime = execute_job(store, SyntheticScanner(), first)
    expire(engines)
    assert run_once(engines[2], store, SyntheticScanner())["accepted"]
    r = row(engines)
    assert r["storage_version"] == blob.storage_version and r["attempts"] == 2
    assert not complete(
        engines,
        first,
        state=result["status"],
        sv=blob.storage_version,
        sha=blob.sha256,
        mime=mime,
        result=json.dumps(result),
    )
    versions = store.client.list_object_versions(
        Bucket=store.bucket, Prefix="objects/"
    )["Versions"]
    assert len(versions) == 1


def test_bucket_misconfiguration_does_not_consume_attempt(engines, seed, store):
    prepare(engines, seed, store, png())
    store.client.put_bucket_versioning(
        Bucket=store.bucket, VersioningConfiguration={"Status": "Suspended"}
    )
    with pytest.raises(Exception):
        run_once(engines[2], store, SyntheticScanner())
    assert row(engines)["attempts"] == 0


def config(**changes):
    return WorkerSettings(
        _env_file=None,
        app_env="test",
        document_storage_backend="s3",
        document_s3_endpoint="http://127.0.0.1:5000",
        document_s3_local_test=True,
        document_s3_region="eu-west-3",
        document_s3_bucket="synthetic-bucket",
        document_s3_access_key="synthetic",
        document_s3_secret_key="synthetic-secret",
        **(
            {
                "document_worker_database_url": "postgresql+psycopg://worker:synthetic-db-secret@127.0.0.1/geoforest_queue_test"
            }
            | changes
        ),
    )


def test_worker_config_needs_no_clerk_or_browser_secret():
    cfg = config()
    assert "synthetic-db-secret" not in repr(cfg) and "synthetic-secret" not in repr(
        cfg
    )
    assert not hasattr(cfg, "clerk_secret_key") and not hasattr(cfg, "session_secret")


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://worker:secret@example.invalid/geoforest_queue_test",
        "postgresql+psycopg://worker:secret@127.0.0.1/production",
        "postgresql+psycopg://worker@127.0.0.1/geoforest_queue_test",
        "sqlite:///geoforest_queue_test",
    ],
)
def test_worker_test_config_refuses_other_databases(url):
    with pytest.raises(ValidationError):
        config(document_worker_database_url=url)


def test_production_requires_verified_tls_without_clerk_credentials():
    values = config().model_dump() | {
        "app_env": "production",
        "document_s3_endpoint": "https://s3.example.invalid",
        "document_s3_local_test": False,
        "document_worker_database_url": "postgresql+psycopg://worker:synthetic@db.example.invalid/geoforest",
    }
    with pytest.raises(ValidationError):
        WorkerSettings.model_validate(values)
    values["document_worker_database_url"] += "?sslmode=verify-full"
    valid = WorkerSettings.model_validate(values)
    from app.documents.worker import worker_engine

    engine = worker_engine(valid)
    try:
        assert (
            engine.url.query["sslmode"] == "verify-full"
            and engine.url.query["sslrootcert"]
        )
    finally:
        engine.dispose()
