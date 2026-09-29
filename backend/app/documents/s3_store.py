"""Private, conditional, version-pinned S3 objects. No public URLs or delete API.

A successful byte/hash check does NOT release quarantine. SQL authorization and
scan state control access. Credentials must be scoped by the operator's IAM policy.
"""

import hashlib
import tempfile
import time
from contextlib import closing
from uuid import uuid4

import boto3
from app.documents.storage import CHUNK, MAX_BYTES, Blob, StorageError, identifier
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

UPLOAD_CHUNK = (
    64000  # Existing browser protocol; at most 328 staging objects per version.
)


def version_id(response):
    value = response.get("VersionId")
    if not isinstance(value, str) or not 1 <= len(value) <= 1024 or value == "null":
        raise StorageError("S3_VERSIONING_REQUIRED")
    return value


class S3Store:
    def __init__(self, client, bucket):
        self.client, self.bucket = client, bucket

    @classmethod
    def from_settings(cls, cfg):
        from app.documents.s3_config import ObjectStorageSettings

        cfg = ObjectStorageSettings(
            _env_file=None, **(cfg.model_dump() | {"document_storage_backend": "s3"})
        )
        client = boto3.client(
            "s3",
            endpoint_url=cfg.document_s3_endpoint,
            region_name=cfg.document_s3_region,
            aws_access_key_id=cfg.document_s3_access_key,
            aws_secret_access_key=cfg.document_s3_secret_key,
            verify=True,
            config=Config(
                signature_version="s3v4",
                connect_timeout=3,
                read_timeout=5,
                retries={"total_max_attempts": 1},
                s3={"addressing_style": "path"},
            ),
        )
        return cls(client, cfg.document_s3_bucket)

    def check_security(self):
        """Read-only gates. Unsupported capability fails closed; never changes a bucket."""
        try:
            c, b = self.client, self.bucket
            if c.get_bucket_versioning(Bucket=b).get("Status") != "Enabled":
                raise StorageError("S3_VERSIONING_REQUIRED")
            block = c.get_public_access_block(Bucket=b)[
                "PublicAccessBlockConfiguration"
            ]
            if any(
                block.get(k) is not True
                for k in (
                    "BlockPublicAcls",
                    "IgnorePublicAcls",
                    "BlockPublicPolicy",
                    "RestrictPublicBuckets",
                )
            ):
                raise StorageError("S3_PUBLIC_ACCESS_MUST_BE_BLOCKED")
            acl = c.get_bucket_acl(Bucket=b)
            if any(
                g.get("Grantee", {}).get("ID") != acl["Owner"]["ID"]
                for g in acl["Grants"]
            ):
                raise StorageError("S3_PRIVATE_ACL_REQUIRED")
            rules = c.get_bucket_encryption(Bucket=b)[
                "ServerSideEncryptionConfiguration"
            ]["Rules"]
            if not any(
                r.get("ApplyServerSideEncryptionByDefault", {}).get("SSEAlgorithm")
                == "AES256"
                for r in rules
            ):
                raise StorageError("S3_ENCRYPTION_REQUIRED")
        except (BotoCoreError, ClientError, KeyError, TypeError):
            raise StorageError("S3_SECURITY_CONFIGURATION_UNVERIFIED") from None

    @staticmethod
    def key(org, object_id):
        return f"objects/{identifier(org)}/{identifier(object_id)}"

    @staticmethod
    def staging_key(org, upload, offset):
        if (
            type(offset) is not int
            or offset < 0
            or offset >= MAX_BYTES
            or offset % UPLOAD_CHUNK
        ):
            raise StorageError("INVALID_CHUNK_OFFSET")
        return f"staging/{identifier(org)}/{identifier(upload)}/{offset:08x}"

    def _read(self, key, expected_size, *, pinned=None):
        args = {"Bucket": self.bucket, "Key": key}
        if pinned is not None:
            args["VersionId"] = pinned
        try:
            response = self.client.get_object(**args)
            with closing(response["Body"]) as body:
                actual_version = version_id(response)
                if (
                    response.get("ContentLength") != expected_size
                    or response.get("ServerSideEncryption") != "AES256"
                    or (pinned is not None and actual_version != pinned)
                ):
                    raise StorageError("S3_OBJECT_METADATA_INVALID")
                data = body.read(expected_size + 1)
                if len(data) != expected_size:
                    raise StorageError("S3_OBJECT_SIZE_INVALID")
            return data, actual_version
        except (BotoCoreError, ClientError, KeyError):
            raise StorageError("S3_READ_UNAVAILABLE") from None

    def _put_once(self, key, data):
        self.check_security()
        try:
            response = self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=data,
                ContentLength=len(data),
                IfNoneMatch="*",
                ServerSideEncryption="AES256",
                ContentType="application/octet-stream",
                Metadata={"sha256": hashlib.sha256(data).hexdigest()},
            )
            return version_id(response)
        except ClientError as exc:
            if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") not in (
                409,
                412,
            ):
                raise StorageError("S3_WRITE_UNAVAILABLE") from None
            # Response loss/replay or competing worker: NEVER overwrite.
            existing, pinned = self._read(key, len(data))
            if existing != data:
                raise StorageError("S3_IMMUTABLE_CONFLICT") from None
            return pinned
        except BotoCoreError:
            raise StorageError("S3_WRITE_UNAVAILABLE") from None

    def put_chunk(self, org, upload, offset, data, expected_size):
        if (
            type(expected_size) is not int
            or not 1 <= expected_size <= MAX_BYTES
            or type(data) is not bytes
            or len(data) != min(UPLOAD_CHUNK, expected_size - offset)
        ):
            raise StorageError("INVALID_CHUNK_SIZE")
        self._put_once(self.staging_key(org, upload, offset), data)

    def staged_chunks(self, org, upload, expected_size, *, deadline):
        if type(expected_size) is not int or not 1 <= expected_size <= MAX_BYTES:
            raise StorageError("INVALID_DECLARED_SIZE")
        for offset in range(0, expected_size, UPLOAD_CHUNK):
            if time.monotonic() > deadline:
                raise StorageError("ASSEMBLY_TIMEOUT")
            data, _ = self._read(
                self.staging_key(org, upload, offset),
                min(UPLOAD_CHUNK, expected_size - offset),
            )
            yield data

    def put_quarantined(
        self, organization_id, chunks, *, declared_size, object_id=None
    ):
        if type(declared_size) is not int or not 1 <= declared_size <= MAX_BYTES:
            raise StorageError("INVALID_DECLARED_SIZE")
        object_id = uuid4() if object_id is None else object_id
        key = self.key(organization_id, object_id)
        payload = bytearray()
        for i, data in enumerate(chunks):
            if i >= 4096 or type(data) is not bytes or len(data) > CHUNK:
                raise StorageError("INVALID_UPLOAD_CHUNK")
            payload.extend(data)
            if len(payload) > declared_size:
                raise StorageError("UPLOAD_SIZE_EXCEEDED")
        if len(payload) != declared_size:
            raise StorageError("UPLOAD_TRUNCATED")
        data = bytes(payload)
        pinned = self._put_once(key, data)
        return Blob(
            organization_id,
            object_id,
            len(data),
            hashlib.sha256(data).hexdigest(),
            pinned,
        )

    def open_verified(self, blob):
        if (
            type(blob) is not Blob
            or type(blob.size) is not int
            or not 1 <= blob.size <= MAX_BYTES
            or not isinstance(blob.storage_version, str)
            or not 1 <= len(blob.storage_version) <= 1024
            or blob.storage_version == "null"
        ):
            raise StorageError("INVALID_VERSIONED_BLOB")
        data, _ = self._read(
            self.key(blob.organization_id, blob.object_id),
            blob.size,
            pinned=blob.storage_version,
        )
        if hashlib.sha256(data).hexdigest() != blob.sha256:
            raise StorageError("OBJECT_INTEGRITY_FAILED")
        # Temporary processing copy, never the durable source. No bytes served before hash verification.
        f = tempfile.TemporaryFile()
        try:
            f.write(data)
            f.seek(0)
            return f
        except BaseException:
            f.close()
            raise
