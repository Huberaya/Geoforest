"""Independent S3 worker. No HTTP routes, browser identity or API settings import.

Run once under an external supervisor: python -m app.documents.worker --once
The DB transaction is closed before any S3/AV work. Lease tokens fence late results.
"""

import argparse
import json
import time
from pathlib import Path

import certifi
from app.documents.format_validation import validate_format_from_store
from app.documents.s3_config import ObjectStorageSettings
from app.documents.s3_store import S3Store
from app.documents.scanner import Scanner
from pydantic import Field, model_validator
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool


class WorkerSettings(ObjectStorageSettings):
    document_worker_database_url: str = Field(repr=False)
    clamav_executable: str = "/usr/local/bin/clamscan"
    clamav_database: str = "/var/lib/clamav"
    clamav_library_path: str = ""

    @model_validator(mode="after")
    def worker_only(self):
        u = make_url(self.document_worker_database_url)
        if (
            self.document_storage_backend != "s3"
            or u.drivername != "postgresql+psycopg"
        ):
            raise ValueError("Worker requires S3 and PostgreSQL psycopg")
        if not u.username or not u.password or not u.host or not u.database:
            raise ValueError("Explicit worker database credentials required")
        if self.app_env == "test":
            if u.host != "127.0.0.1" or not u.database.endswith("_test"):
                raise ValueError(
                    "Tests require loopback and a dedicated _test database"
                )
        elif self.app_env != "production" or u.query.get("sslmode") != "verify-full":
            raise ValueError("Production worker requires verified PostgreSQL TLS")
        return self


def worker_engine(cfg):
    url = make_url(cfg.document_worker_database_url)
    if cfg.app_env == "production" and not url.query.get("sslrootcert"):
        url = url.update_query_dict({"sslrootcert": certifi.where()})
    return create_engine(url, poolclass=NullPool, connect_args={"connect_timeout": 5})


def transaction(engine):
    return engine.begin()


def bounded(conn):
    conn.execute(text("SET LOCAL statement_timeout='15s'"))
    conn.execute(text("SET LOCAL lock_timeout='3s'"))


def verify_worker_role(engine):
    with transaction(engine) as conn:
        bounded(conn)
        safe = conn.execute(
            text("""
            SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreaterole
             AND NOT r.rolcreatedb
             AND pg_has_role(current_user,'geoforest_document_worker','MEMBER')
             AND NOT EXISTS (SELECT 1 FROM pg_roles other
               WHERE other.rolname NOT IN (current_user,'geoforest_document_worker')
               AND pg_has_role(current_user,other.oid,'MEMBER'))
             AND NOT r.rolreplication
             AND NOT pg_has_role(current_user,'geoforest_app','MEMBER')
             AND NOT pg_has_role(current_user,'geoforest_migrator','MEMBER')
             AND NOT EXISTS (
               SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')
               AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass
                 AND d.objid=c.oid AND d.deptype='e')
               AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
                    OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE')))
            FROM pg_roles r WHERE r.rolname=current_user
        """)
        ).scalar_one()
        if not safe:
            raise RuntimeError("Worker role is not least-privilege")


def execute_job(storage, scanner, job, *, format_validator=validate_format_from_store):
    blob = None
    try:
        chunks = storage.staged_chunks(
            job["organization_id"],
            job["version_id"],
            job["expected_size"],
            deadline=time.monotonic() + 150,
        )
        blob = storage.put_quarantined(
            job["organization_id"],
            chunks,
            declared_size=job["expected_size"],
            object_id=job["object_id"],
        )
        if blob.sha256 != job["expected_sha256"]:
            result = {"status": "FORMAT_REJECTED", "reason": "UPLOAD_INTEGRITY_FAILED"}
        else:
            result = scanner.scan(storage, blob).json()
            if result.get("status") not in {
                "SCAN_PASSED",
                "SCAN_REJECTED",
                "SCAN_UNAVAILABLE",
            }:
                raise ValueError("Invalid scanner response")
            if result["status"] == "SCAN_PASSED":
                if result.get("input_sha256") != blob.sha256:
                    raise ValueError("Scanner input mismatch")
                form = format_validator(storage, blob, job["claimed_mime"])
                if not form:
                    result = {
                        "status": "FORMAT_REJECTED",
                        "reason": "UNSUPPORTED_OR_INVALID_FORMAT",
                    }
                else:
                    result["format"] = form
                    return blob, result, form["mime"]
        return blob, result, None
    except Exception:
        # Never log source documents, S3 response payloads or credentials.
        return (
            blob,
            {"status": "SCAN_UNAVAILABLE", "reason": "PROCESSING_UNAVAILABLE"},
            None,
        )


def run_once(engine, storage, scanner):
    verify_worker_role(engine)
    storage.check_security()
    with transaction(engine) as conn:
        bounded(conn)
        job = (
            conn.execute(text("SELECT * FROM authz.document_claim()"))
            .mappings()
            .first()
        )
    if job is None:
        return {"job": False}
    blob, result, mime = execute_job(storage, scanner, job)
    with transaction(engine) as conn:
        bounded(conn)
        accepted = conn.execute(
            text("""
            SELECT authz.document_complete(:org,:version,:token,:state,:sv,:sha,:mime,CAST(:result AS jsonb))
        """),
            {
                "org": job["organization_id"],
                "version": job["version_id"],
                "token": job["lease_token"],
                "state": result["status"],
                "sv": blob.storage_version if blob else None,
                "sha": blob.sha256 if blob else None,
                "mime": mime,
                "result": json.dumps(result),
            },
        ).scalar_one()
    return {"job": True, "accepted": accepted}


def main():
    parser = argparse.ArgumentParser(
        description="Process at most one private document job"
    )
    parser.add_argument("--once", action="store_true", required=True)
    parser.parse_args()
    engine = None
    try:
        cfg = WorkerSettings()
        engine = worker_engine(cfg)
        scanner = Scanner(
            Path(cfg.clamav_executable),
            Path(cfg.clamav_database),
            library_path=Path(cfg.clamav_library_path)
            if cfg.clamav_library_path
            else None,
        )
        print(json.dumps(run_once(engine, S3Store.from_settings(cfg), scanner)))
    except Exception:
        print(json.dumps({"error": "WORKER_UNAVAILABLE"}))
        return 1
    finally:
        if engine is not None:
            engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
