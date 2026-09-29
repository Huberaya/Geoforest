"""Opt-in LOCAL fictitious database and HTTP S3 emulator only; no resets or drops."""

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4

import boto3
import pytest
from app.documents.s3_store import S3Store
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "profile_audit", ROOT / "scripts/audit-document-worker-profile.py"
)
PROFILE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROFILE)
URL = "postgresql+psycopg://geoforest_migrator:local-test-migrator-password@127.0.0.1/geoforest_supervised_test"
WORKER_URL = "postgresql+psycopg://geoforest_worker_test:local-synthetic-worker-password@127.0.0.1/geoforest_supervised_test"
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C"}


@pytest.fixture(autouse=True)
def opt_in():
    if os.environ.get("SUPERVISED_SANDBOX_TEST") != "1":
        pytest.skip(
            "Explicit local systemd/PG/S3/ClamAV recipe: SUPERVISED_SANDBOX_TEST=1"
        )


@pytest.fixture(scope="session")
def bundle():
    if os.environ.get("SUPERVISED_SANDBOX_TEST") != "1":
        pytest.skip("Local opt-in required")
    if not PROFILE.audit(ROOT / "infra/document-worker")["candidate_profile_valid"]:
        pytest.fail("Candidate profile differs from audited contract")
    path = Path(tempfile.mkdtemp(prefix="supervised-", dir=ROOT / ".cache"))
    (path / "backend").mkdir()
    shutil.copytree(
        ROOT / "backend/app",
        path / "backend/app",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    shutil.copy2(
        ROOT / "backend/tests/supervised_sandbox/service_entry.py",
        path / "backend/service_entry.py",
    )
    # Only source code, no .env/.git or other repository content. venv is bound separately.
    yield path
    shutil.rmtree(path)


@pytest.fixture
def db():
    engine = create_engine(URL, poolclass=NullPool)
    with engine.connect() as c:
        assert (
            c.execute(text("select current_database()")).scalar_one()
            == "geoforest_supervised_test"
        )
    yield engine
    engine.dispose()


@pytest.fixture
def storage():
    client = boto3.client(
        "s3",
        endpoint_url="http://127.0.0.1:5017",
        region_name="eu-west-3",
        aws_access_key_id="synthetic",
        aws_secret_access_key="synthetic",
    )
    bucket = "supervised-" + uuid4().hex
    client.create_bucket(
        Bucket=bucket, CreateBucketConfiguration={"LocationConstraint": "eu-west-3"}
    )
    client.put_bucket_versioning(
        Bucket=bucket, VersioningConfiguration={"Status": "Enabled"}
    )
    client.put_public_access_block(
        Bucket=bucket,
        PublicAccessBlockConfiguration={
            key: True
            for key in (
                "BlockPublicAcls",
                "IgnorePublicAcls",
                "BlockPublicPolicy",
                "RestrictPublicBuckets",
            )
        },
    )
    client.put_bucket_encryption(
        Bucket=bucket,
        ServerSideEncryptionConfiguration={
            "Rules": [
                {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}
            ]
        },
    )
    return S3Store(client, bucket)


@pytest.fixture
def service(bundle, storage):
    def run(
        mode="worker", *, deny_namespaces=False, deadline="270s", worker_url=WORKER_URL
    ):
        # Never accept a configurable real connection string in this synthetic harness.
        assert worker_url in (WORKER_URL, URL)
        name = "geoforest-integration-" + uuid4().hex
        envfile = bundle / (name + ".env")
        values = {
            "APP_ENV": "test",
            "DOCUMENT_STORAGE_BACKEND": "s3",
            "DOCUMENT_S3_LOCAL_TEST": "true",
            "DOCUMENT_WORKER_DATABASE_URL": worker_url,
            "DOCUMENT_S3_ENDPOINT": "http://127.0.0.1:5017",
            "DOCUMENT_S3_REGION": "eu-west-3",
            "DOCUMENT_S3_BUCKET": storage.bucket,
            "DOCUMENT_S3_ACCESS_KEY": "synthetic",
            "DOCUMENT_S3_SECRET_KEY": "synthetic",
            "CLAMAV_EXECUTABLE": "/opt/gft-test-engine/bin/clamscan",
            "CLAMAV_DATABASE": "/opt/gft-test-signatures",
            "CLAMAV_LIBRARY_PATH": "/opt/gft-test-engine/lib",
            "SYNTHETIC_SERVICE_MODE": mode,
        }
        envfile.write_text("".join(k + "=" + v + "\n" for k, v in values.items()))
        envfile.chmod(0o600)
        props = dict(PROFILE.SERVICE["Service"])
        for key in ("ExecStart", "ExecStartPre", "StandardOutput", "StandardError"):
            props.pop(key)
        props.update(
            User="user",
            Group="user",
            WorkingDirectory="/opt/gft-test/backend",
            EnvironmentFile=str(envfile),
            ReadOnlyPaths="/opt/gft-test-engine /opt/gft-test-signatures",
            InaccessiblePaths="-/opt/gft-test/.env",
            TimeoutStartSec=deadline,
            TimeoutStopSec="2s",
        )
        if deny_namespaces:
            props["RestrictNamespaces"] = "yes"
        command = [
            "sudo",
            "-n",
            "systemd-run",
            "--wait",
            "--pipe",
            "--collect",
            "--unit=" + name,
        ]
        for key, value in props.items():
            pieces = value.split() if key == "TemporaryFileSystem" else [value]
            command.extend("--property=" + key + "=" + piece for piece in pieces)
        for source, target in [
            (bundle, "/opt/gft-test"),
            (ROOT / ".venv", "/opt/gft-test/.venv"),
            (
                ROOT / ".cache/clamav-qualification/engine/usr/local",
                "/opt/gft-test-engine",
            ),
            (ROOT / ".cache/clamav-qualification/database", "/opt/gft-test-signatures"),
        ]:
            command.append("--property=BindReadOnlyPaths=" + str(source) + ":" + target)
        command += ["/usr/bin/env", "--", "/opt/gft-test/.venv/bin/python"]
        command += (
            ["-m", "app.documents.worker", "--once"]
            if mode == "worker"
            else ["service_entry.py", "--once"]
        )
        try:
            result = subprocess.run(
                command,
                env=ENV,
                capture_output=True,
                text=True,
                timeout=150,
                check=False,
            )
            # Persist only synthetic output/metadata, never real credentials or document bodies.
            proof = ROOT / "docs/rapports/preuves-chantier-8/supervised-sandbox"
            (proof / (name + ".json")).write_text(
                json.dumps(
                    {
                        "mode": mode,
                        "namespace_denied": deny_namespaces,
                        "deadline": deadline,
                        "exit_code": result.returncode,
                        "stdout": result.stdout,
                        "stderr": result.stderr,
                        "production_authorized": False,
                    },
                    indent=2,
                )
                + "\n"
            )
            return result
        finally:
            subprocess.run(
                ["sudo", "-n", "systemctl", "stop", name + ".service"],
                env=ENV,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=20,
                check=False,
            )
            envfile.unlink()

    return run


@pytest.fixture
def prepared(db, storage):
    import hashlib

    created = []

    def make(data, *, mime="image/png"):
        ids = {
            k: uuid4()
            for k in ("org", "user", "supplier", "document", "version", "request")
        }
        ids.update(
            size=len(data),
            sha=hashlib.sha256(data).hexdigest(),
            metadata=json.dumps(
                {
                    "expected_sha256": hashlib.sha256(data).hexdigest(),
                    "claimed_mime": mime,
                }
            ),
            subject=str(uuid4()),
        )
        with db.begin() as c:
            c.execute(
                text(
                    "INSERT INTO users(id,issuer,subject,email,display_name) VALUES(:user,'synthetic',:subject,'test@example.invalid','Fictif')"
                ),
                ids,
            )
            c.execute(
                text(
                    "INSERT INTO organizations(id,name) VALUES(:org,'Organisation fictive')"
                ),
                ids,
            )
            c.execute(
                text(
                    "INSERT INTO memberships(organization_id,user_id,role) VALUES(:org,:user,'Admin')"
                ),
                ids,
            )
            c.execute(
                text(
                    "INSERT INTO suppliers(organization_id,id,reference,name) VALUES(:org,:supplier,'SYN','Fournisseur fictif')"
                ),
                ids,
            )
            c.execute(
                text(
                    "INSERT INTO documents(organization_id,supplier_id,id) VALUES(:org,:supplier,:document)"
                ),
                ids,
            )
            c.execute(
                text("""INSERT INTO document_versions(organization_id,supplier_id,document_id,id,version,request_id,input_sha256,metadata,expected_size,received_size,actor_id,actor_kind,storage_backend)
            VALUES(:org,:supplier,:document,:version,1,:request,:sha,CAST(:metadata AS jsonb),:size,:size,:user,'user','s3')"""),
                ids,
            )
        from app.documents.s3_store import UPLOAD_CHUNK

        for offset in range(0, len(data), UPLOAD_CHUNK):
            storage.put_chunk(
                ids["org"],
                ids["version"],
                offset,
                data[offset : offset + UPLOAD_CHUNK],
                len(data),
            )
        app = create_engine(
            URL.replace(
                "geoforest_migrator:local-test-migrator-password",
                "geoforest_app:local-test-app-password",
            ),
            poolclass=NullPool,
        )
        try:
            with app.begin() as c:
                c.execute(
                    text(
                        "SELECT set_config('app.user_id',:user,true),set_config('app.organization_id',:org,true)"
                    ),
                    {"user": str(ids["user"]), "org": str(ids["org"])},
                )
                c.execute(text("SELECT authz.document_enqueue(:org,:version)"), ids)
        finally:
            app.dispose()
        created.append(ids)
        return ids

    yield make
    # Only this fixture's unfinished synthetic jobs; no TRUNCATE, deletes or state promotion.
    with db.begin() as c:
        for ids in created:
            c.execute(
                text(
                    "UPDATE document_jobs SET status='FAILED',lease_token=NULL,lease_until=NULL WHERE organization_id=:org AND version_id=:version AND status IN ('QUEUED','LEASED')"
                ),
                ids,
            )
