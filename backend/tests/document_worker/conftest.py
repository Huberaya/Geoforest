"""Dedicated synthetic DB only. Never inherits the general API reset fixture."""

import hashlib
import json
import os
from uuid import uuid4

import boto3
import pytest
from app.documents.s3_store import S3Store
from moto import mock_aws
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool


@pytest.fixture(scope="session")
def engines():
    base = os.environ.get("DOCUMENT_QUEUE_TEST_URL")
    if not base:
        pytest.skip(
            "Opt-in candidate DB: set DOCUMENT_QUEUE_TEST_URL to geoforest_queue_test on loopback"
        )
    url = make_url(base)
    assert url.host == "127.0.0.1" and url.database == "geoforest_queue_test"
    owner = create_engine(url, poolclass=NullPool)
    app = create_engine(
        url.set(username="geoforest_app", password="local-test-app-password"),
        poolclass=NullPool,
    )
    worker = create_engine(
        url.set(
            username="geoforest_worker_test", password="local-synthetic-worker-password"
        ),
        poolclass=NullPool,
    )
    yield owner, app, worker
    for e in (owner, app, worker):
        e.dispose()


@pytest.fixture(autouse=True)
def clean(engines):
    with engines[0].begin() as c:
        c.execute(text("TRUNCATE organizations,users CASCADE"))


@pytest.fixture
def seed(engines):
    def make(data=b"fiction", role="Admin", backend="s3", **overrides):
        ids = {
            key: uuid4()
            for key in ("org", "user", "supplier", "document", "version", "request")
        }
        ids.update(size=len(data), sha=hashlib.sha256(data).hexdigest(), data=data)
        with engines[0].begin() as c:
            c.execute(
                text(
                    "INSERT INTO users(id,issuer,subject,email,display_name) VALUES(:user,'synthetic',:subject,'test@example.invalid','Fictif')"
                ),
                ids | {"subject": str(ids["user"])},
            )
            c.execute(
                text(
                    "INSERT INTO organizations(id,name) VALUES(:org,'Organisation fictive')"
                ),
                ids,
            )
            c.execute(
                text(
                    "INSERT INTO memberships(organization_id,user_id,role) VALUES(:org,:user,:role)"
                ),
                ids | {"role": role},
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
                text("""INSERT INTO document_versions(organization_id,supplier_id,document_id,id,version,request_id,
              input_sha256,metadata,expected_size,received_size,actor_id,actor_kind,storage_backend)
              VALUES(:org,:supplier,:document,:version,1,:request,:sha,CAST(:metadata AS jsonb),:size,:received,:user,'user',:backend)"""),
                ids
                | {
                    "metadata": json.dumps(
                        {
                            "expected_sha256": overrides.get("sha", ids["sha"]),
                            "claimed_mime": "image/png",
                        }
                    ),
                    "received": overrides.get("received", len(data)),
                    "backend": backend,
                },
            )
        return ids

    return make


@pytest.fixture
def store():
    with mock_aws():
        c = boto3.client(
            "s3",
            region_name="eu-west-3",
            aws_access_key_id="synthetic",
            aws_secret_access_key="synthetic",
        )
        b = "geoforest-worker-synthetic"
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
        yield S3Store(c, b)


@pytest.fixture(autouse=True)
def reset():
    # Override the parent API database reset: this suite only uses its own DB.
    yield
