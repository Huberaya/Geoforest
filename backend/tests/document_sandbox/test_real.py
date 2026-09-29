import io
import json
import os
import socket
import time
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import boto3
import pytest
from app.documents.s3_store import S3Store
from app.documents.sandbox import DocumentSandbox
from app.documents.sandbox_processing import SandboxScanner, sandbox_format
from app.documents.worker import execute_job
from moto import mock_aws
from PIL import Image
from pypdf import PdfWriter


def put(store, data):
    return store.put_quarantined(uuid4(), [data], declared_size=len(data))


def test_boundary_real_parent_secret_files_fds_network(tmp_path, monkeypatch):
    secret = tmp_path / "synthetic-secret"
    secret.write_text("SYNTHETIC_SECRET_DO_NOT_INHERIT")
    monkeypatch.setenv("WORKER_SECRET_SENTINEL", "SYNTHETIC_SECRET_DO_NOT_INHERIT")
    with secret.open("rb") as inherited, socket.socket() as listener:
        os.set_inheritable(inherited.fileno(), True)
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        with socket.create_connection(listener.getsockname()):
            peer, _ = listener.accept()
            peer.close()
        request = {
            "sentinel_path": str(secret),
            "sentinel_value": "SYNTHETIC_SECRET_DO_NOT_INHERIT",
            "parent_pid_namespace": os.readlink("/proc/self/ns/pid"),
            "parent_net_namespace": os.readlink("/proc/self/ns/net"),
            "port": listener.getsockname()[1],
        }
        result = DocumentSandbox().run("probe", json.dumps(request).encode())
    assert result.error is None and result.returncode == 0
    assert json.loads(result.output)["boundary"] == "PASS"


def test_timeout_kills_detached_pid_namespace():
    result = DocumentSandbox().run("timeout-probe", timeout=0.5)
    assert result.error == "SANDBOX_TIMEOUT"
    namespace = json.loads(result.output)["pid_namespace"]
    deadline = time.monotonic() + 2
    while True:
        found = []
        for p in Path("/proc").glob("[0-9]*/ns/pid"):
            try:
                if os.readlink(p) == namespace:
                    found.append(str(p))
            except OSError:
                pass
        if not found or time.monotonic() > deadline:
            break
        time.sleep(0.02)
    assert not found, "A descendant retained the terminated PID namespace"


@pytest.mark.parametrize(
    "kind,mime",
    [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("PDF", "application/pdf")],
)
def test_real_format_parser(store, kind, mime):
    output = io.BytesIO()
    if kind == "PDF":
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer.write(output)
    else:
        Image.new("RGB", (7, 9), "green").save(output, format=kind)
    blob = put(store, output.getvalue())
    assert sandbox_format(store, blob, mime)["mime"] == mime
    assert sandbox_format(store, blob, "text/plain") is None
    assert sandbox_format(store, replace(blob, sha256="0" * 64), mime) is None


def test_active_pdf_rejected(store):
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.add_js("app.alert('synthetic')")
    out = io.BytesIO()
    writer.write(out)
    assert sandbox_format(store, put(store, out.getvalue()), "application/pdf") is None


def test_malformed_rejected(store):
    assert sandbox_format(store, put(store, b"not an image"), "image/png") is None


@pytest.mark.parametrize(
    "data,status",
    [
        (b"FICTITIOUS DOCUMENT ONLY. No business data.", "SCAN_PASSED"),
        (
            b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
            "SCAN_REJECTED",
        ),
    ],
)
def test_real_clamav(scanner, store, data, status):
    blob = put(store, data)
    result = scanner.scan(store, blob)
    assert result.status == status
    assert result.engine_version == "1.4.6"
    assert result.input_sha256 == blob.sha256


def test_real_scan_timeout_fail_closed(scanner, store):
    assert (
        scanner.scan(store, put(store, b"FICTITIOUS"), timeout=0.001).status
        == "SCAN_UNAVAILABLE"
    )


def test_invalid_vendor_databases_fail_closed(scanner, store, tmp_path):
    database = tmp_path / "invalid-signatures"
    database.mkdir()
    for name in ("daily", "main", "bytecode"):
        (database / (name + ".cvd")).write_text(
            f"ClamAV-VDB:date:1:1:90:invalid:invalid:builder:{int(time.time())}".ljust(
                512
            )
        )
    invalid = SandboxScanner(
        scanner.executable, database, library_path=scanner.library_path
    )
    assert invalid.scan(store, put(store, b"FICTITIOUS")).status == "SCAN_UNAVAILABLE"


def test_stale_signatures_fail_closed(scanner, store, tmp_path):
    database = tmp_path / "stale"
    database.mkdir()
    for name in ("daily", "main", "bytecode"):
        (database / (name + ".cvd")).write_text(
            f"ClamAV-VDB:date:1:1:90:invalid:invalid:builder:{int(time.time()) - 96 * 3600}".ljust(
                512
            )
        )
    invalid = SandboxScanner(
        scanner.executable, database, library_path=scanner.library_path
    )
    assert invalid.scan(store, put(store, b"FICTITIOUS")).status == "SCAN_UNAVAILABLE"


def test_worker_pipeline_real_scan_and_parser_with_emulated_s3(scanner):
    import hashlib

    with mock_aws():
        client = boto3.client(
            "s3",
            region_name="eu-west-3",
            aws_access_key_id="synthetic",
            aws_secret_access_key="synthetic",
        )
        bucket = "sandbox-synthetic-documents"
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
                for k in [
                    "BlockPublicAcls",
                    "IgnorePublicAcls",
                    "BlockPublicPolicy",
                    "RestrictPublicBuckets",
                ]
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
        storage = S3Store(client, bucket)
        output = io.BytesIO()
        Image.new("RGB", (5, 6), "blue").save(output, format="PNG")
        data = output.getvalue()
        org, version = uuid4(), uuid4()
        storage.put_chunk(org, version, 0, data, len(data))
        blob, result, mime = execute_job(
            storage,
            scanner,
            {
                "organization_id": org,
                "version_id": version,
                "object_id": uuid4(),
                "expected_size": len(data),
                "expected_sha256": hashlib.sha256(data).hexdigest(),
                "claimed_mime": "image/png",
            },
            format_validator=sandbox_format,
        )
        assert result["status"] == "SCAN_PASSED" and mime == "image/png"
        assert blob.storage_version not in ("", None, "null")
        _, bad_result, bad_mime = execute_job(
            storage,
            scanner,
            {
                "organization_id": org,
                "version_id": version,
                "object_id": uuid4(),
                "expected_size": len(data),
                "expected_sha256": "0" * 64,
                "claimed_mime": "image/png",
            },
            format_validator=sandbox_format,
        )
        assert bad_result["status"] == "FORMAT_REJECTED" and bad_mime is None
