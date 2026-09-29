import os
from uuid import uuid4

import pytest
from app.documents.recovery.archive import (
    RecoveryError,
    encrypt_file,
    load_key,
    private_directory,
    read_manifest,
    read_payload,
    seal,
    write_private,
)
from app.documents.recovery.database import test_url as checked_url
from app.documents.recovery.service import local_only, verify


@pytest.fixture
def workspace(tmp_path):
    tmp_path.chmod(0o700)
    return tmp_path


def simple_archive(workspace):
    root = workspace / "archive"
    root.mkdir(mode=0o700)
    key = os.urandom(32)
    entry = encrypt_file(root, key, b"fictional database dump only")
    manifest = {
        "format": "geoforest-document-backup-v1",
        "backup_id": str(uuid4()),
        "created_at": "2026-09-29T12:00:00Z",
        "source_database": "synthetic_test",
        "source_bucket": "synthetic-bucket",
        "source_endpoint": "https://synthetic.example.invalid",
        "postgres_major": 17,
        "postgis_version": "synthetic-test-only",
        "schema_revision": "0007+document-queue-candidate",
        "dump": entry,
        "entries": [],
        "tables": {},
    }
    seal(root, key, manifest)
    return root, key, manifest


def test_encrypted_authenticated_roundtrip(workspace):
    root, key, manifest = simple_archive(workspace)
    assert verify(root, key).dump.sha256 == manifest["dump"]["sha256"]
    assert read_payload(root, key, manifest["dump"]) == b"fictional database dump only"
    assert read_manifest(root, key) == manifest
    for p in root.iterdir():
        assert p.stat().st_mode & 0o777 == 0o600
        assert b"fictional database" not in p.read_bytes()
        assert b"synthetic-bucket" not in p.read_bytes()


@pytest.mark.parametrize("which", ["manifest", "payload"])
def test_ciphertext_corruption(workspace, which):
    root, key, m = simple_archive(workspace)
    file = root / ("manifest.gcm" if which == "manifest" else m["dump"]["file"])
    data = bytearray(file.read_bytes())
    data[-1] ^= 1
    file.write_bytes(data)
    with pytest.raises(RecoveryError):
        verify(root, key)


def test_wrong_key(workspace):
    root, _, _ = simple_archive(workspace)
    with pytest.raises(RecoveryError):
        verify(root, os.urandom(32))


@pytest.mark.parametrize(
    "action", ["missing", "extra", "symlink", "hardlink", "permissions"]
)
def test_inventory_and_filesystem_protection(workspace, action):
    root, key, m = simple_archive(workspace)
    p = root / m["dump"]["file"]
    if action == "missing":
        p.unlink()
    elif action == "extra":
        write_private(root / "extra", b"fiction")
    elif action == "symlink":
        other = workspace / "other"
        p.rename(other)
        p.symlink_to(other)
    elif action == "hardlink":
        os.link(p, workspace / "hardlink")
    else:
        p.chmod(0o644)
    with pytest.raises((RecoveryError, OSError)):
        verify(root, key)


def test_file_cannot_be_substituted_from_other_backup(workspace):
    root, key, m = simple_archive(workspace)
    other = encrypt_file(root, key, b"other bytes")
    a = root / m["dump"]["file"]
    b = root / other["file"]
    a.write_bytes(b.read_bytes())
    b.unlink()
    with pytest.raises(RecoveryError):
        verify(root, key)


def test_manifest_may_not_traverse_paths(workspace):
    root, key, m = simple_archive(workspace)
    (root / "manifest.gcm").unlink()
    m["dump"]["file"] = "../outside.gcm"
    seal(root, key, m)
    with pytest.raises(RecoveryError):
        verify(root, key)


def test_duplicate_payload_names_rejected(workspace):
    root, key, m = simple_archive(workspace)
    (root / "manifest.gcm").unlink()
    m["entries"] = [
        m["dump"]
        | {
            "kind": "blob",
            "organization_id": str(uuid4()),
            "version_id": str(uuid4()),
            "object_id": str(uuid4()),
            "offset": None,
            "source_version": "opaque",
        }
    ]
    seal(root, key, m)
    with pytest.raises(RecoveryError):
        verify(root, key)


def test_seal_is_no_overwrite(workspace):
    root, key, m = simple_archive(workspace)
    with pytest.raises(FileExistsError):
        seal(root, key, m)


def test_separate_private_key(workspace):
    root = workspace / "backup"
    root.mkdir(mode=0o700)
    key = workspace / "key"
    write_private(key, os.urandom(32))
    assert len(load_key(key, root)) == 32
    nested = root / "key"
    write_private(nested, os.urandom(32))
    with pytest.raises(RecoveryError):
        load_key(nested, root)
    key.chmod(0o644)
    with pytest.raises(RecoveryError):
        load_key(key, root)


@pytest.mark.parametrize("size", [0, 16, 31, 33])
def test_invalid_key_length(workspace, size):
    p = workspace / "key"
    write_private(p, b"x" * size)
    with pytest.raises(RecoveryError):
        load_key(p, workspace / "backup")


def test_directory_permissions_and_symlink(workspace):
    d = workspace / "private"
    d.mkdir(mode=0o700)
    alias = workspace / "alias"
    alias.symlink_to(d)
    with pytest.raises(RecoveryError):
        private_directory(alias)
    d.chmod(0o755)
    with pytest.raises(RecoveryError):
        private_directory(d)


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://geoforest_migrator:test@example.invalid/geoforest_test",
        "postgresql+psycopg://geoforest_migrator:test@127.0.0.1/geoforest",
        "postgresql+psycopg://geoforest_app:test@127.0.0.1/geoforest_test",
        "postgresql+psycopg://geoforest_migrator:test@127.0.0.1/geoforest_test?host=elsewhere",
        "sqlite:///geoforest_test",
    ],
)
def test_database_boundaries(url):
    with pytest.raises(RecoveryError):
        checked_url(url)


@pytest.mark.parametrize(
    "env,stopped", [("production", True), ("test", False), ("development", True)]
)
def test_explicit_test_and_stopped_writers(env, stopped):
    with pytest.raises(RecoveryError):
        local_only(
            "postgresql+psycopg://geoforest_migrator:test@127.0.0.1/geoforest_test",
            env,
            stopped,
        )


def test_cli_verify_and_error_redaction(workspace):
    import subprocess
    import sys
    from pathlib import Path

    root, key, _ = simple_archive(workspace)
    keyfile = workspace / "independent-key"
    write_private(keyfile, key)
    script = Path(__file__).resolve().parents[3] / "scripts" / "document-recovery.py"
    env = {
        "APP_ENV": "test",
        "DOCUMENT_RECOVERY_KEY_FILE": str(keyfile),
        "DOCUMENT_RECOVERY_DATABASE_URL": "DO-NOT-PRINT-THIS-SYNTHETIC-SECRET",
    }
    proc = subprocess.run(
        [sys.executable, str(script), "verify", "--directory", str(root)],
        env=env,
        capture_output=True,
        timeout=15,
    )
    assert (
        proc.returncode == 0 and b'"verified": true' in proc.stdout and not proc.stderr
    )
    keyfile.write_bytes(os.urandom(32))
    proc = subprocess.run(
        [sys.executable, str(script), "verify", "--directory", str(root)],
        env=env,
        capture_output=True,
        timeout=15,
    )
    assert (
        proc.returncode == 1
        and proc.stdout.strip() == b'{"error": "DOCUMENT_RECOVERY_FAILED"}'
    )
    assert not proc.stderr and b"SECRET" not in proc.stdout


def test_cli_refuses_external_s3_before_creating_client(workspace, monkeypatch, capsys):
    import importlib.util
    import sys
    from pathlib import Path

    script = Path(__file__).resolve().parents[3] / "scripts" / "document-recovery.py"
    spec = importlib.util.spec_from_file_location("recovery_cli_under_test", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    keyfile = workspace / "key"
    write_private(keyfile, os.urandom(32))
    values = {
        "APP_ENV": "test",
        "DOCUMENT_RECOVERY_KEY_FILE": str(keyfile),
        "DOCUMENT_STORAGE_BACKEND": "s3",
        "DOCUMENT_S3_ENDPOINT": "https://external.example.invalid",
        "DOCUMENT_S3_LOCAL_TEST": "false",
        "DOCUMENT_S3_BUCKET": "synthetic-bucket",
        "DOCUMENT_S3_REGION": "eu-west-3",
        "DOCUMENT_S3_ACCESS_KEY": "synthetic",
        "DOCUMENT_S3_SECRET_KEY": "synthetic",
    }
    for k, v in values.items():
        monkeypatch.setenv(k, v)
    calls = []
    monkeypatch.setattr(module.S3Store, "from_settings", lambda cfg: calls.append(cfg))
    monkeypatch.setattr(
        sys,
        "argv",
        [
            str(script),
            "backup",
            "--directory",
            str(workspace / "new"),
            "--writers-stopped",
        ],
    )
    assert module.main() == 1 and not calls
    assert capsys.readouterr().out.strip() == '{"error": "DOCUMENT_RECOVERY_FAILED"}'
