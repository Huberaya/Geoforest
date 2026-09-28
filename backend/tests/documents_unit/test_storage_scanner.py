import hashlib
import os
import subprocess
import time
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
from app.documents.scanner import Scanner
from app.documents.storage import CHUNK, MAX_BYTES, LocalStore, StorageError


@pytest.fixture
def store(tmp_path):
    tmp_path.chmod(0o700)
    return LocalStore(tmp_path)


def test_roundtrip_private_version(store):
    organization = uuid4()
    first = store.put_quarantined(
        organization, [b"first", b" version"], declared_size=13
    )
    second = store.put_quarantined(organization, [b"second"], declared_size=6)
    assert first.object_id != second.object_id
    with store.open_verified(first) as f:
        assert f.read() == b"first version"
    assert first.sha256 == hashlib.sha256(b"first version").hexdigest()
    assert (
        store.root / organization.hex / first.object_id.hex
    ).stat().st_mode & 0o777 == 0o400


@pytest.mark.parametrize("size", [0, -1, True, MAX_BYTES + 1, "5"])
def test_declared_size_rejected_before_write(store, size):
    with pytest.raises(StorageError):
        store.put_quarantined(uuid4(), [b"hello"], declared_size=size)
    assert not list(store.root.iterdir())


@pytest.mark.parametrize(
    "chunks,size",
    [
        ([b"hello"], 6),
        ([b"hello"], 4),
        ([b"x" * (CHUNK + 1)], CHUNK + 1),
        (["hello"], 5),
    ],
)
def test_bad_upload_has_no_partial_or_published_file(store, chunks, size):
    org = uuid4()
    with pytest.raises(StorageError):
        store.put_quarantined(org, chunks, declared_size=size)
    assert not list((store.root / org.hex).iterdir())


def test_interrupted_generator_cleaned(store):
    org = uuid4()

    def chunks():
        yield b"hello"
        raise ConnectionError("simulated disconnect")

    with pytest.raises(ConnectionError):
        store.put_quarantined(org, chunks(), declared_size=6)
    assert not list((store.root / org.hex).iterdir())


def test_wrong_organization_cannot_lookup_blob(store):
    blob = store.put_quarantined(uuid4(), [b"hello"], declared_size=5)
    with pytest.raises(FileNotFoundError):
        store.open_verified(replace(blob, organization_id=uuid4()))


@pytest.mark.parametrize("org", ["../escape", "/tmp", "org", None])
def test_paths_never_accepted_as_identifier(store, org):
    with pytest.raises(StorageError):
        store.put_quarantined(org, [b"hello"], declared_size=5)


def test_hash_mismatch_before_any_bytes_returned(store):
    blob = store.put_quarantined(uuid4(), [b"hello"], declared_size=5)
    with pytest.raises(StorageError, match="OBJECT_INTEGRITY_FAILED"):
        store.open_verified(replace(blob, sha256="0" * 64))


def test_symlink_and_hardlink_rejected(store, tmp_path):
    org = uuid4()
    blob = store.put_quarantined(org, [b"hello"], declared_size=5)
    p = store.root / org.hex / blob.object_id.hex
    duplicate = tmp_path / "hardlink"
    os.link(p, duplicate)
    with pytest.raises(StorageError):
        store.open_verified(blob)
    duplicate.unlink()
    p.unlink()
    p.symlink_to("/etc/passwd")
    with pytest.raises(OSError):
        store.open_verified(blob)


def test_collision_does_not_overwrite(store, monkeypatch):
    org = uuid4()
    blob = store.put_quarantined(org, [b"hello"], declared_size=5)
    monkeypatch.setattr("app.documents.storage.uuid4", lambda: blob.object_id)
    with pytest.raises(FileExistsError):
        store.put_quarantined(org, [b"other"], declared_size=5)
    with store.open_verified(blob) as f:
        assert f.read() == b"hello"


def test_world_readable_root_refused(tmp_path):
    tmp_path.chmod(0o755)
    with pytest.raises(StorageError, match="PRIVATE_ROOT_REQUIRED"):
        LocalStore(tmp_path).put_quarantined(uuid4(), [b"hello"], declared_size=5)


def test_symlink_root_refused(tmp_path):
    target = tmp_path / "real"
    target.mkdir(mode=0o700)
    alias = tmp_path / "alias"
    alias.symlink_to(target)
    with pytest.raises(StorageError):
        LocalStore(alias)


def test_symlink_tenant_refused(store, tmp_path):
    org = uuid4()
    (store.root / org.hex).symlink_to(tmp_path)
    with pytest.raises(OSError):
        store.put_quarantined(org, [b"hello"], declared_size=5)


def test_missing_scanner_never_passes(store, tmp_path):
    blob = store.put_quarantined(uuid4(), [b"hello"], declared_size=5)
    r = Scanner(tmp_path / "missing-engine", tmp_path / "no-signatures").scan(
        store, blob
    )
    assert r.status == "SCAN_UNAVAILABLE"


def signatures(tmp_path, epoch):
    for name in ("daily", "main", "bytecode"):
        (tmp_path / f"{name}.cvd").write_text(
            f"ClamAV-VDB:date:1:1:90:hash:signature:builder:{epoch}".ljust(512)
        )


@pytest.mark.parametrize("offset", [-73 * 3600, 3600])
def test_signature_age_fail_closed(tmp_path, offset):
    signatures(tmp_path, int(time.time()) + offset)
    with pytest.raises(ValueError):
        Scanner(Path("/unqualified"), tmp_path)._databases()


def test_old_engine_refused(store, tmp_path, monkeypatch):
    signatures(tmp_path, int(time.time()))
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **kw: subprocess.CompletedProcess(a, 0, b"ClamAV 1.4.3\n"),
    )
    blob = store.put_quarantined(uuid4(), [b"hello"], declared_size=5)
    r = Scanner(Path("/unqualified"), tmp_path).scan(store, blob)
    assert r.status == "SCAN_UNAVAILABLE" and r.reason == "ENGINE_NOT_QUALIFIED"


def test_empty_chunk_storm_is_bounded(store):
    org = uuid4()
    with pytest.raises(StorageError, match="UPLOAD_CHUNK_BUDGET"):
        store.put_quarantined(org, (b"" for _ in range(4097)), declared_size=1)
    assert not list((store.root / org.hex).iterdir())


def test_scanner_does_not_inherit_business_secrets(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "test-only-secret")
    monkeypatch.setenv("SESSION_SECRET", "test-only-secret")
    monkeypatch.setenv("HTTP_PROXY", "http://untrusted.invalid")
    scanner = Scanner(tmp_path / "engine", tmp_path / "db")
    assert not {"DATABASE_URL", "SESSION_SECRET", "HTTP_PROXY"} & scanner.env.keys()


def test_exact_maximum_size_roundtrip(store):
    blob = store.put_quarantined(
        uuid4(),
        (b"x" * CHUNK for _ in range(MAX_BYTES // CHUNK)),
        declared_size=MAX_BYTES,
    )
    assert blob.size == MAX_BYTES
    with store.open_verified(blob) as f:
        assert f.read(CHUNK) == b"x" * CHUNK


def test_stored_content_changed_same_size_is_rejected(store):
    blob = store.put_quarantined(uuid4(), [b"hello"], declared_size=5)
    p = store.root / blob.organization_id.hex / blob.object_id.hex
    p.chmod(0o600)
    p.write_bytes(b"other")
    p.chmod(0o400)
    with pytest.raises(StorageError, match="OBJECT_INTEGRITY_FAILED"):
        store.open_verified(blob)
