"""Read-only observations, never provider qualification or production authorization."""

from app.documents.s3_store import S3Store
from app.documents.storage import StorageError
from botocore.exceptions import ClientError

OPERATIONS = (
    "get_bucket_versioning",
    "get_public_access_block",
    "get_bucket_acl",
    "get_bucket_encryption",
)
SAFE_ERRORS = {
    "S3_VERSIONING_REQUIRED",
    "S3_PUBLIC_ACCESS_MUST_BE_BLOCKED",
    "S3_PRIVATE_ACL_REQUIRED",
    "S3_ENCRYPTION_REQUIRED",
    "S3_SECURITY_CONFIGURATION_UNVERIFIED",
}


def plan():
    return {
        "schema_revision": 1,
        "scope": "BUCKET_CONFIGURATION_ONLY",
        "operations": list(OPERATIONS),
        "provider_qualified": False,
        "production_authorized": False,
        "remaining": [
            "CONDITIONAL_WRITES_AND_CONCURRENCY",
            "VERSION_PINNED_READS_AND_SSE_RESPONSE",
            "ANONYMOUS_AND_CROSS_IDENTITY_DENIALS",
            "IAM_NO_DELETE_OR_CONFIGURATION_MUTATION",
            "OFFSITE_IMMUTABILITY_AND_KEY_RECOVERY",
            "REGION_CONTRACT_AND_RESTORE_EXERCISE",
        ],
    }


class _ObservedClient:
    """Only four cached responses: the existing runtime guard cannot mutate S3."""

    def __init__(self, responses):
        self.responses = responses

    def __getattr__(self, name):
        if name not in OPERATIONS:
            raise AttributeError("Operation outside diagnostic scope")

        def response(**kwargs):
            value = self.responses[name]
            if isinstance(value, Exception):
                raise value
            return value

        return response


def inspect_security(client, bucket):
    """Four reads, no object access, no configuration writes, no raw errors in output.

    A pass describes these non-atomic observations only. Reuses check_security,
    rather than inventing a relaxed provider-specific security contract.
    """
    report = plan()
    responses, checks = {}, []
    for operation in OPERATIONS:
        item = {"operation": operation, "read_status": "OBSERVED"}
        try:
            responses[operation] = getattr(client, operation)(Bucket=bucket)
        except Exception as exc:
            responses[operation] = exc
            code = "TRANSPORT_OR_RESPONSE_ERROR"
            if isinstance(exc, ClientError):
                remote_code = exc.response.get("Error", {}).get("Code")
                if remote_code in {"AccessDenied", "Forbidden", "InvalidAccessKeyId"}:
                    code = "NOT_AUTHORIZED"
                elif remote_code in {"NotImplemented", "UnsupportedOperation"}:
                    code = "NOT_IMPLEMENTED"
                elif remote_code in {
                    "NoSuchPublicAccessBlockConfiguration",
                    "ServerSideEncryptionConfigurationNotFoundError",
                    "NoSuchBucket",
                }:
                    code = "CONFIGURATION_MISSING"
            item.update(read_status="UNVERIFIED", reason=code)
        checks.append(item)
    report["checks"] = checks
    try:
        S3Store(_ObservedClient(responses), bucket).check_security()
        report["runtime_configuration"] = "OBSERVED_PASS"
    except Exception as exc:
        reason = str(exc) if isinstance(exc, StorageError) else ""
        report["runtime_configuration"] = "REFUSED_OR_UNVERIFIED"
        report["reason"] = (
            reason if reason in SAFE_ERRORS else "S3_SECURITY_CONFIGURATION_UNVERIFIED"
        )
    return report
