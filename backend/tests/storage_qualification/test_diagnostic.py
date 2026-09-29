"""Synthetic observations only: no provider credentials, network, DB or writes."""

import copy
import importlib.util
import json
import socket
import sys
from pathlib import Path

import pytest
from app.documents.storage_diagnostic import OPERATIONS, inspect_security, plan
from botocore.exceptions import ClientError

GOOD = {
    "get_bucket_versioning": {"Status": "Enabled"},
    "get_public_access_block": {
        "PublicAccessBlockConfiguration": {
            "BlockPublicAcls": True,
            "IgnorePublicAcls": True,
            "BlockPublicPolicy": True,
            "RestrictPublicBuckets": True,
        }
    },
    "get_bucket_acl": {
        "Owner": {"ID": "synthetic-owner"},
        "Grants": [
            {"Grantee": {"ID": "synthetic-owner"}, "Permission": "FULL_CONTROL"}
        ],
    },
    "get_bucket_encryption": {
        "ServerSideEncryptionConfiguration": {
            "Rules": [
                {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}
            ]
        }
    },
}


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("NETWORK_FORBIDDEN")

    monkeypatch.setattr(socket.socket, "connect", forbidden)


class FakeClient:
    def __init__(self, responses):
        self.responses, self.calls = responses, []

    def __getattr__(self, name):
        assert name in OPERATIONS  # writes, object reads and listings are forbidden

        def call(**kwargs):
            assert kwargs == {"Bucket": "synthetic-bucket"}
            self.calls.append(name)
            result = self.responses[name]
            if isinstance(result, Exception):
                raise result
            return result

        return call


def run(responses):
    client = FakeClient(responses)
    result = inspect_security(client, "synthetic-bucket")
    assert client.calls == list(OPERATIONS)  # exactly four reads, no retries or writes
    assert result["provider_qualified"] is False
    assert result["production_authorized"] is False
    assert "synthetic-owner" not in json.dumps(result)
    assert "synthetic-bucket" not in json.dumps(result)
    return result


def test_observed_pass_is_never_provider_qualification():
    result = run(copy.deepcopy(GOOD))
    assert result["runtime_configuration"] == "OBSERVED_PASS"
    assert all(item["read_status"] == "OBSERVED" for item in result["checks"])
    assert len(result["remaining"]) == 6


@pytest.mark.parametrize(
    "field", list(GOOD["get_public_access_block"]["PublicAccessBlockConfiguration"])
)
@pytest.mark.parametrize("value", [False, 1, "true", None])
def test_every_public_access_flag_requires_boolean_true(field, value):
    responses = copy.deepcopy(GOOD)
    responses["get_public_access_block"]["PublicAccessBlockConfiguration"][field] = (
        value
    )
    result = run(responses)
    assert result["reason"] == "S3_PUBLIC_ACCESS_MUST_BE_BLOCKED"


@pytest.mark.parametrize(
    "operation,value,reason",
    [
        ("get_bucket_versioning", {"Status": "Suspended"}, "S3_VERSIONING_REQUIRED"),
        (
            "get_bucket_encryption",
            {"ServerSideEncryptionConfiguration": {"Rules": []}},
            "S3_ENCRYPTION_REQUIRED",
        ),
        (
            "get_bucket_acl",
            {"Owner": {"ID": "owner"}, "Grants": [{"Grantee": {"URI": "all-users"}}]},
            "S3_PRIVATE_ACL_REQUIRED",
        ),
        ("get_public_access_block", {}, "S3_SECURITY_CONFIGURATION_UNVERIFIED"),
        (
            "get_bucket_acl",
            {"Owner": None, "Grants": [{}]},
            "S3_SECURITY_CONFIGURATION_UNVERIFIED",
        ),
        ("get_bucket_encryption", None, "S3_SECURITY_CONFIGURATION_UNVERIFIED"),
    ],
)
def test_configuration_refused(operation, value, reason):
    responses = copy.deepcopy(GOOD)
    responses[operation] = value
    result = run(responses)
    assert result["runtime_configuration"] == "REFUSED_OR_UNVERIFIED"
    assert result["reason"] == reason


@pytest.mark.parametrize(
    "code,expected",
    [
        ("NotImplemented", "NOT_IMPLEMENTED"),
        ("AccessDenied", "NOT_AUTHORIZED"),
        ("NoSuchPublicAccessBlockConfiguration", "CONFIGURATION_MISSING"),
        ("private-provider-error", "TRANSPORT_OR_RESPONSE_ERROR"),
    ],
)
def test_errors_redacted_and_all_reads_still_observed(code, expected):
    responses = copy.deepcopy(GOOD)
    responses["get_public_access_block"] = ClientError(
        {"Error": {"Code": code, "Message": "secret-token private-name"}},
        "GetPublicAccessBlock",
    )
    result = run(responses)
    assert result["checks"][1]["reason"] == expected
    assert result["reason"] == "S3_SECURITY_CONFIGURATION_UNVERIFIED"
    assert "secret-token" not in json.dumps(result)
    assert "private-provider-error" not in json.dumps(result)


def test_unexpected_exception_is_redacted():
    responses = copy.deepcopy(GOOD)
    responses["get_bucket_acl"] = RuntimeError("secret-token")
    assert "secret-token" not in json.dumps(run(responses))


@pytest.fixture
def cli(monkeypatch):
    path = Path(__file__).resolve().parents[3] / "scripts/diagnose-document-storage.py"
    spec = importlib.util.spec_from_file_location("storage_cli", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name in list(__import__("os").environ):
        if name.startswith("DOCUMENT_S3_") or name in {
            "APP_ENV",
            "DOCUMENT_STORAGE_BACKEND",
        }:
            monkeypatch.delenv(name)
    return module


def test_plan_ignores_credentials_and_never_constructs_client(cli, monkeypatch, capsys):
    def forbidden(*args):
        raise AssertionError("Client constructed")

    monkeypatch.setattr(cli.S3Store, "from_settings", forbidden)
    monkeypatch.setenv("DOCUMENT_S3_SECRET_KEY", "secret-token")
    monkeypatch.setenv("DOCUMENT_S3_ENDPOINT", "https://cloud.invalid")
    monkeypatch.setattr(sys, "argv", ["diagnose", "plan"])
    assert cli.main() == 0
    assert json.loads(capsys.readouterr().out) == plan()


@pytest.mark.parametrize(
    "env,endpoint,local,backend",
    [
        ("production", "http://127.0.0.1:5000", "true", "s3"),
        ("test", "https://cloud.invalid", "false", "s3"),
        ("test", "https://cloud.invalid", "true", "s3"),
        ("test", "http://localhost:5000", "true", "s3"),
        ("test", "http://127.0.0.1:5000?secret-token", "true", "s3"),
        ("test", "http://127.0.0.1:5000", "true", "local"),
    ],
)
def test_cli_refuses_before_client_creation(
    cli, monkeypatch, capsys, env, endpoint, local, backend
):
    constructed = []
    monkeypatch.setattr(
        cli.S3Store, "from_settings", lambda cfg: constructed.append(cfg)
    )
    for name, value in {
        "APP_ENV": env,
        "DOCUMENT_STORAGE_BACKEND": backend,
        "DOCUMENT_S3_ENDPOINT": endpoint,
        "DOCUMENT_S3_LOCAL_TEST": local,
        "DOCUMENT_S3_REGION": "eu-west-3",
        "DOCUMENT_S3_BUCKET": "synthetic-bucket",
        "DOCUMENT_S3_ACCESS_KEY": "synthetic",
        "DOCUMENT_S3_SECRET_KEY": "secret-token",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(sys, "argv", ["diagnose", "local-check"])
    assert cli.main() == 1
    assert constructed == []
    output = capsys.readouterr().out
    assert "secret-token" not in output
    assert json.loads(output)["production_authorized"] is False


@pytest.mark.parametrize("safe", [True, False])
def test_local_cli_observation_is_not_authorization(cli, monkeypatch, capsys, safe):
    from app.documents.s3_store import S3Store

    for name, value in {
        "APP_ENV": "test",
        "DOCUMENT_STORAGE_BACKEND": "s3",
        "DOCUMENT_S3_ENDPOINT": "http://127.0.0.1:5000",
        "DOCUMENT_S3_LOCAL_TEST": "true",
        "DOCUMENT_S3_REGION": "eu-west-3",
        "DOCUMENT_S3_BUCKET": "synthetic-bucket",
        "DOCUMENT_S3_ACCESS_KEY": "synthetic",
        "DOCUMENT_S3_SECRET_KEY": "synthetic",
    }.items():
        monkeypatch.setenv(name, value)
    responses = copy.deepcopy(GOOD)
    if not safe:
        responses["get_bucket_versioning"] = {"Status": "Suspended"}
    client = FakeClient(responses)
    monkeypatch.setattr(
        cli.S3Store,
        "from_settings",
        lambda cfg: S3Store(client, cfg.document_s3_bucket),
    )
    monkeypatch.setattr(sys, "argv", ["diagnose", "local-check"])
    assert cli.main() == (0 if safe else 1)
    assert json.loads(capsys.readouterr().out)["provider_qualified"] is False
    assert client.calls == list(OPERATIONS)
