"""Synthetic, in-process S3 emulation only; NOT provider/IAM qualification."""

import hashlib
import time
from dataclasses import replace
from uuid import uuid4

import boto3
import pytest
from app.documents.s3_config import ObjectStorageSettings
from app.documents.s3_store import UPLOAD_CHUNK, S3Store
from app.documents.storage import MAX_BYTES, StorageError
from moto import mock_aws
from pydantic import ValidationError


@pytest.fixture
def store():
    with mock_aws():
        client = boto3.client(
            "s3",
            region_name="eu-west-3",
            aws_access_key_id="synthetic",
            aws_secret_access_key="synthetic",
        )
        bucket = "geoforest-synthetic-documents"
        client.create_bucket(
            Bucket=bucket, CreateBucketConfiguration={"LocationConstraint": "eu-west-3"}
        )
        client.put_bucket_versioning(
            Bucket=bucket, VersioningConfiguration={"Status": "Enabled"}
        )
        client.put_public_access_block(
            Bucket=bucket,
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
        client.put_bucket_encryption(
            Bucket=bucket,
            ServerSideEncryptionConfiguration={
                "Rules": [
                    {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}
                ]
            },
        )
        yield S3Store(client, bucket)


def test_pinned_roundtrip_and_new_latest_does_not_replace_reference(store):
    org = uuid4()
    blob = store.put_quarantined(org, [b"fiction"], declared_size=7)
    assert (
        blob.storage_version and blob.sha256 == hashlib.sha256(b"fiction").hexdigest()
    )
    store.client.put_object(
        Bucket=store.bucket,
        Key=store.key(org, blob.object_id),
        Body=b"changed",
        ServerSideEncryption="AES256",
    )
    with store.open_verified(blob) as f:
        assert f.read() == b"fiction"
    with pytest.raises(StorageError):
        store.open_verified(replace(blob, organization_id=uuid4()))
    with pytest.raises(StorageError):
        store.open_verified(replace(blob, sha256="0" * 64))
    with pytest.raises(StorageError):
        store.open_verified(replace(blob, storage_version="missing"))


def test_conditional_write_replay_and_conflict(store):
    org, obj = uuid4(), uuid4()
    a = store.put_quarantined(org, [b"one"], declared_size=3, object_id=obj)
    b = store.put_quarantined(org, [b"one"], declared_size=3, object_id=obj)
    assert a == b
    with pytest.raises(StorageError, match="IMMUTABLE_CONFLICT"):
        store.put_quarantined(org, [b"two"], declared_size=3, object_id=obj)
    assert len(store.client.list_object_versions(Bucket=store.bucket)["Versions"]) == 1


def test_browser_chunks_resume_and_assembly(store):
    org, upload = uuid4(), uuid4()
    data = b"f" * UPLOAD_CHUNK + b"ictitious"
    store.put_chunk(org, upload, 0, data[:UPLOAD_CHUNK], len(data))
    store.put_chunk(org, upload, 0, data[:UPLOAD_CHUNK], len(data))
    store.put_chunk(org, upload, UPLOAD_CHUNK, data[UPLOAD_CHUNK:], len(data))
    chunks = store.staged_chunks(org, upload, len(data), deadline=time.monotonic() + 30)
    blob = store.put_quarantined(org, chunks, declared_size=len(data))
    with store.open_verified(blob) as f:
        assert f.read() == data
    with pytest.raises(StorageError, match="TIMEOUT"):
        list(store.staged_chunks(org, upload, len(data), deadline=0))
    with pytest.raises(StorageError):
        list(
            store.staged_chunks(
                uuid4(), upload, len(data), deadline=time.monotonic() + 30
            )
        )


@pytest.mark.parametrize(
    "offset,data,size",
    [
        (-1, b"a", 1),
        (True, b"a", 2),
        (1, b"a", 2),
        (0, b"a", 2),
        (0, b"a", MAX_BYTES + 1),
        (0, b"a", 0),
        (0, b"a", True),
        (UPLOAD_CHUNK, b"a", 1),
    ],
)
def test_invalid_staging_writes(store, offset, data, size):
    with pytest.raises(StorageError):
        store.put_chunk(uuid4(), uuid4(), offset, data, size)
    assert store.client.list_objects_v2(Bucket=store.bucket)["KeyCount"] == 0


@pytest.mark.parametrize(
    "chunks,size",
    [
        ([b"a"], 0),
        ([b"a"], True),
        ([b"a"], 2),
        ([b"ab"], 1),
        (["a"], 1),
        ([b"a" * 65537], 65537),
        ([b"a"], MAX_BYTES + 1),
    ],
)
def test_invalid_object_size(store, chunks, size):
    with pytest.raises(StorageError):
        store.put_quarantined(uuid4(), chunks, declared_size=size)
    assert store.client.list_objects_v2(Bucket=store.bucket)["KeyCount"] == 0


@pytest.mark.parametrize("failure", ["versioning", "public", "encryption", "acl"])
def test_bucket_configuration_fails_closed(store, failure):
    c, b = store.client, store.bucket
    if failure == "versioning":
        c.put_bucket_versioning(
            Bucket=b, VersioningConfiguration={"Status": "Suspended"}
        )
    elif failure == "public":
        c.put_public_access_block(
            Bucket=b, PublicAccessBlockConfiguration={"BlockPublicAcls": False}
        )
    elif failure == "encryption":
        c.put_bucket_encryption(
            Bucket=b,
            ServerSideEncryptionConfiguration={
                "Rules": [
                    {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms"}}
                ]
            },
        )
    else:
        c.put_bucket_acl(Bucket=b, ACL="public-read")
    with pytest.raises(StorageError):
        store.put_quarantined(uuid4(), [b"a"], declared_size=1)
    assert c.list_objects_v2(Bucket=b)["KeyCount"] == 0


def test_missing_object_and_unversioned_reference_fail_closed(store):
    blob = store.put_quarantined(uuid4(), [b"a"], declared_size=1)
    for version in (None, "", "null", 3):
        with pytest.raises(StorageError):
            store.open_verified(replace(blob, storage_version=version))
    store.client.delete_object(
        Bucket=store.bucket,
        Key=store.key(blob.organization_id, blob.object_id),
        VersionId=blob.storage_version,
    )
    with pytest.raises(StorageError):
        store.open_verified(blob)


@pytest.mark.parametrize(
    "endpoint,env,local",
    [
        ("http://example.invalid", "test", False),
        ("https://user:pass@example.invalid", "test", False),
        ("https://example.invalid/path", "test", False),
        ("https://example.invalid?q=a", "test", False),
        ("https://example.invalid#x", "test", False),
        ("http://127.0.0.1:5000", "production", True),
        ("http://example.invalid", "test", True),
        ("https://localhost", "production", False),
    ],
)
def test_endpoint_constraints(endpoint, env, local):
    with pytest.raises(ValidationError):
        ObjectStorageSettings(
            document_storage_backend="s3",
            document_s3_endpoint=endpoint,
            app_env=env,
            document_s3_local_test=local,
            document_s3_region="eu-west-3",
            document_s3_bucket="synthetic-bucket",
            document_s3_access_key="synthetic",
            document_s3_secret_key="synthetic-secret",
        )


def test_storage_only_config_does_not_need_identity_secrets():
    cfg = ObjectStorageSettings(
        document_storage_backend="s3",
        document_s3_endpoint="http://127.0.0.1:5000",
        app_env="test",
        document_s3_local_test=True,
        document_s3_region="eu-west-3",
        document_s3_bucket="synthetic-bucket",
        document_s3_access_key="synthetic",
        document_s3_secret_key="synthetic-secret",
    )
    assert "synthetic-secret" not in repr(cfg)


def test_api_refuses_premature_s3_activation():
    from app.config import Settings

    with pytest.raises(ValidationError, match="activation refused"):
        Settings(
            _env_file=None,
            database_url="postgresql://synthetic/synthetic_test",
            session_secret="synthetic-test-secret-at-least-32-characters",
            document_storage_backend="s3",
            document_s3_endpoint="https://s3.example.invalid",
            document_s3_region="eu-west-3",
            document_s3_bucket="synthetic-bucket",
            document_s3_access_key="synthetic",
            document_s3_secret_key="synthetic",
        )


@pytest.mark.parametrize(
    "environment,enabled,allowed",
    [
        ("test", True, True),
        ("test", False, False),
        ("production", True, False),
        ("development", True, False),
    ],
)
def test_api_s3_activation_is_explicitly_test_only(environment, enabled, allowed):
    from app.config import Settings

    values = {
        "app_env": environment,
        "oidc_client_secret": "synthetic-oidc-test-secret",
        "document_s3_api_test": enabled,
        "database_url": "postgresql+psycopg://synthetic:synthetic@127.0.0.1/synthetic_test",
        "session_secret": "synthetic-test-secret-at-least-32-characters",
        "document_storage_backend": "s3",
        "document_s3_endpoint": "https://s3.example.invalid",
        "document_s3_region": "eu-west-3",
        "document_s3_bucket": "synthetic-bucket",
        "document_s3_access_key": "synthetic",
        "document_s3_secret_key": "synthetic",
    }
    if allowed:
        assert Settings(_env_file=None, **values).document_storage_backend == "s3"
    else:
        with pytest.raises(ValidationError, match="activation refused"):
            Settings(_env_file=None, **values)


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://synthetic:synthetic@db.example.invalid/geoforest_test",
        "postgresql+psycopg://synthetic:synthetic@127.0.0.1/production",
    ],
)
def test_api_s3_test_switch_refuses_remote_or_business_database(url):
    from app.config import Settings

    with pytest.raises(ValidationError, match="loopback _test database"):
        Settings(
            _env_file=None,
            app_env="test",
            database_url=url,
            session_secret="synthetic-session-secret-at-least-32-characters",
            oidc_client_secret="synthetic",
            document_s3_api_test=True,
        )
