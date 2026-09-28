import hashlib
import importlib.util
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest

spec = importlib.util.spec_from_file_location(
    "vault_check",
    Path(__file__).resolve().parents[3] / "scripts/check-document-vault.py",
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def fixture(root):
    root.chmod(0o700)
    org, version, obj = uuid4(), uuid4(), uuid4()
    folder = root / org.hex
    folder.mkdir(mode=0o700)
    blob = folder / obj.hex
    blob.write_bytes(b"fictional")
    blob.chmod(0o400)
    row = dict(
        organization_id=org,
        id=version,
        object_id=obj,
        expected_size=9,
        sha256=hashlib.sha256(b"fictional").hexdigest(),
        state="SCAN_PASSED",
        expires_at=datetime.now(timezone.utc) - timedelta(days=2),
    )
    staging = folder / ("u-" + version.hex)
    staging.write_bytes(b"fictional")
    staging.chmod(0o600)
    os.utime(staging, (0, 0))
    return row, blob, staging


def test_inventory_and_staging_only_cleanup(tmp_path):
    row, blob, staging = fixture(tmp_path)
    r = mod.inventory(tmp_path, [row])
    assert r["verified"] == 1 and len(r["staging_candidates"]) == 1
    assert staging.exists()
    assert mod.inventory(tmp_path, [row], True)["staging_removed"] == 1
    assert blob.exists() and not staging.exists()


def test_corrupt_and_missing_never_deleted(tmp_path):
    row, blob, _ = fixture(tmp_path)
    blob.chmod(0o600)
    blob.write_bytes(b"changed!!")
    blob.chmod(0o400)
    assert len(mod.inventory(tmp_path, [row])["invalid"]) == 1
    assert blob.exists()
    blob.unlink()
    assert len(mod.inventory(tmp_path, [row])["missing"]) == 1


def test_orphan_blob_retained_and_scanning_staging_preserved(tmp_path):
    row, blob, staging = fixture(tmp_path)
    row["state"] = "SCANNING"
    r = mod.inventory(tmp_path, [row], True)
    assert not r["staging_removed"] and staging.exists()
    r = mod.inventory(tmp_path, [], True)
    assert len(r["orphans_retained"]) == 1 and blob.exists()


def test_symlink_refused(tmp_path):
    row, blob, _ = fixture(tmp_path)
    blob.unlink()
    blob.symlink_to("/etc/passwd")
    with pytest.raises(ValueError):
        mod.inventory(tmp_path, [row], True)
