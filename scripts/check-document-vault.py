"""Offline inventory / integrity verification; never deletes a committed blob.

Run as the vault owner, with MIGRATION_DATABASE_URL supplied outside source control.
Stop ALL application writers first (including workers and other instances).
Only --apply-staging --writers-stopped deletes old unreferenced temporary files.
Reports contain identifiers; keep them private. Never point this at another tenant's vault.
"""

import argparse
import hashlib
import json
import os
import re
import stat
import time
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, text


def inventory(root, rows, apply=False):
    root = Path(root).absolute()
    if root.resolve() != root:
        raise ValueError("SYMLINK_ROOT")
    info = root.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError("PRIVATE_ROOT_REQUIRED")
    versions = {(r["organization_id"].hex, r["id"].hex): r for r in rows}
    objects = {
        (r["organization_id"].hex, r["object_id"].hex): r
        for r in rows
        if r["object_id"]
    }
    result = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "referenced": len(objects),
        "verified": 0,
        "missing": [],
        "invalid": [],
        "orphans_retained": [],
        "staging_candidates": [],
        "staging_removed": 0,
    }
    seen = set()
    now = time.time()
    for directory in root.iterdir():
        info = directory.lstat()
        if (
            not re.fullmatch("[0-9a-f]{32}", directory.name)
            or not stat.S_ISDIR(info.st_mode)
            or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o700
        ):
            raise ValueError("UNSAFE_TENANT_DIRECTORY")
        for f in directory.iterdir():
            info = f.lstat()
            key = (directory.name, f.name)
            label = "/".join(key)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode)
                not in (
                    (0o400,) if re.fullmatch("[0-9a-f]{32}", f.name) else (0o400, 0o600)
                )
                or info.st_nlink != 1
            ):
                raise ValueError("UNSAFE_VAULT_ENTRY")
            if key in objects:
                seen.add(key)
                r = objects[key]
                with f.open("rb") as source:
                    actual = (
                        hashlib.file_digest(source, "sha256").hexdigest()
                        if info.st_size == r["expected_size"]
                        else None
                    )
                if actual != r["sha256"]:
                    result["invalid"].append(label)
                else:
                    result["verified"] += 1
                continue
            temporary = False
            if re.fullmatch("u-[0-9a-f]{32}", f.name):
                r = versions.get((directory.name, f.name[2:]))
                temporary = (
                    r is None
                    or r["state"] not in ("UPLOADING", "SCANNING")
                    or (r["state"] == "UPLOADING" and r["expires_at"].timestamp() < now)
                )
            elif re.fullmatch("[0-9a-f]{32}\\.part", f.name):
                temporary = True
            elif not re.fullmatch("[0-9a-f]{32}", f.name):
                raise ValueError("UNKNOWN_VAULT_FILENAME")
            if temporary and now - info.st_mtime >= 24 * 3600:
                result["staging_candidates"].append(label)
                if apply:
                    if f.lstat() != info:
                        raise ValueError("VAULT_CHANGED_DURING_MAINTENANCE")
                    f.unlink()
                    result["staging_removed"] += 1
            elif re.fullmatch("[0-9a-f]{32}", f.name):
                result["orphans_retained"].append(label)
    result["missing"] = ["/".join(k) for k in sorted(objects.keys() - seen)]
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--writers-stopped", action="store_true")
    p.add_argument("--apply-staging", action="store_true")
    a = p.parse_args()
    if not a.writers_stopped:
        p.error(
            "Stop all writers, then explicitly pass --writers-stopped (offline consistency required)."
        )
    e = create_engine(os.environ["MIGRATION_DATABASE_URL"])
    with e.connect() as c:
        if (
            c.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            != "0006"
        ):
            raise ValueError("SCHEMA_0006_REQUIRED")
        rows = list(
            c.execute(
                text(
                    "SELECT organization_id,id,object_id,expected_size,sha256,state,expires_at FROM document_versions"
                )
            ).mappings()
        )
        result = inventory(a.root, rows, a.apply_staging)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(a.output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(result, f, indent=2)
        f.write("\n")
    print(
        "referenced",
        result["referenced"],
        "verified",
        result["verified"],
        "missing",
        len(result["missing"]),
        "invalid",
        len(result["invalid"]),
        "staging_removed",
        result["staging_removed"],
    )
    if result["missing"] or result["invalid"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
