"""Encrypted DB+S3 snapshot and offline restore with version-ID remapping.

Local synthetic exercise ONLY. Target database must be empty and inaccessible
by API/worker, target bucket empty and distinct. No cleanup/delete or promotion.
"""

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from app.documents.s3_store import UPLOAD_CHUNK
from app.documents.storage import CHUNK, MAX_BYTES, Blob
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from .archive import (
    AAD,
    MAX_DUMP,
    MAX_ITEMS,
    MAX_TOTAL,
    RecoveryError,
    encrypt_file,
    private_directory,
    read_manifest,
    read_payload,
    seal,
    sync_directory,
    write_private,
)
from .database import (
    check_source,
    check_target,
    engine_for,
    fingerprints,
    pg_tool,
    test_url,
)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Payload(Strict):
    file: str = Field(pattern=r"^[0-9a-f]{32}\.gcm$")
    size: int = Field(strict=True, ge=1, le=MAX_DUMP)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class Entry(Payload):
    kind: Literal["blob", "chunk"]
    organization_id: UUID
    version_id: UUID
    object_id: UUID | None
    offset: int | None = Field(default=None, strict=True, ge=0, lt=MAX_BYTES)
    source_version: str = Field(min_length=1, max_length=1024)


class Manifest(Strict):
    format: Literal["geoforest-document-backup-v1"]
    backup_id: UUID
    created_at: datetime
    source_database: str = Field(pattern=r"^[a-z][a-z0-9_]*_test$")
    source_bucket: str = Field(min_length=3, max_length=63)
    source_endpoint: str = Field(min_length=1, max_length=2048)
    postgres_major: int = Field(strict=True, ge=14, le=99)
    postgis_version: str = Field(min_length=1, max_length=256)
    schema_revision: Literal["0007+document-queue-candidate"]
    dump: Payload
    entries: list[Entry] = Field(max_length=MAX_ITEMS)
    tables: dict[str, dict]


ROWS = "SELECT organization_id,id,object_id,sha256,expected_size,received_size,storage_backend,storage_version,state FROM public.document_versions ORDER BY organization_id,id"


def local_only(url, app_env, writers_stopped):
    if app_env != "test" or writers_stopped is not True:
        raise RecoveryError("EXPLICIT_TEST_AND_STOPPED_WRITERS_REQUIRED")
    return test_url(url)


def plan(rows):
    result = []
    for r in rows:
        if r["storage_backend"] == "local":
            if r["object_id"] or r["received_size"]:
                raise RecoveryError("LEGACY_LOCAL_FILES_REQUIRE_SEPARATE_BACKUP")
            continue
        common = {"organization_id": r["organization_id"], "version_id": r["id"]}
        if r["object_id"]:
            result.append(
                common
                | {
                    "kind": "blob",
                    "object_id": r["object_id"],
                    "offset": None,
                    "size": r["expected_size"],
                    "sha256": r["sha256"],
                    "source_version": r["storage_version"],
                }
            )
        else:
            for offset in range(0, r["received_size"], UPLOAD_CHUNK):
                result.append(
                    common
                    | {
                        "kind": "chunk",
                        "object_id": None,
                        "offset": offset,
                        "size": min(UPLOAD_CHUNK, r["received_size"] - offset),
                    }
                )
        if len(result) > MAX_ITEMS:
            raise RecoveryError("INVENTORY_LIMIT")
    return result


def backup(source_url, storage, directory, key, *, app_env, writers_stopped):
    source = local_only(source_url, app_env, writers_stopped)
    if not isinstance(key, bytes) or len(key) != 32:
        raise RecoveryError("INVALID_KEY")
    dest = Path(directory).absolute()
    private_directory(dest.parent)
    dest.mkdir(mode=0o700)  # Never overwrite an old or partial backup.
    sync_directory(dest.parent)
    storage.check_security()
    engine = engine_for(source_url)
    try:
        with engine.connect().execution_options(
            isolation_level="REPEATABLE READ"
        ) as conn:
            with conn.begin():
                conn.execute(text("SET TRANSACTION READ ONLY"))
                conn.execute(text("SET LOCAL statement_timeout='30s'"))
                check_source(conn)
                snapshot = conn.execute(
                    text("SELECT pg_export_snapshot()")
                ).scalar_one()
                tables = fingerprints(conn)
                rows = conn.execute(text(ROWS)).mappings().all()
                inventory = plan(rows)
                if sum(e["size"] for e in inventory) > MAX_TOTAL - MAX_DUMP:
                    raise RecoveryError("BACKUP_SIZE_LIMIT")
                dump = encrypt_file(dest, key, pg_tool(source_url, snapshot=snapshot))
                entries = []
                for item in inventory:
                    if item["kind"] == "blob":
                        blob = Blob(
                            item["organization_id"],
                            item["object_id"],
                            item["size"],
                            item["sha256"],
                            item["source_version"],
                        )
                        with storage.open_verified(blob) as f:
                            data = f.read(MAX_BYTES + 1)
                        source_version = item["source_version"]
                    else:
                        data, source_version = storage._read(
                            storage.staging_key(
                                item["organization_id"],
                                item["version_id"],
                                item["offset"],
                            ),
                            item["size"],
                        )
                    encrypted = encrypt_file(dest, key, data)
                    entries.append(
                        item | encrypted | {"source_version": source_version}
                    )
                manifest = Manifest(
                    format="geoforest-document-backup-v1",
                    backup_id=uuid4(),
                    created_at=datetime.now(timezone.utc),
                    source_database=source.database,
                    source_bucket=storage.bucket,
                    source_endpoint=storage.client.meta.endpoint_url,
                    postgres_major=int(
                        conn.execute(text("SHOW server_version_num")).scalar_one()
                    )
                    // 10000,
                    postgis_version=conn.execute(
                        text("SELECT postgis_version()")
                    ).scalar_one(),
                    schema_revision="0007+document-queue-candidate",
                    dump=dump,
                    entries=entries,
                    tables=tables,
                )
                seal(dest, key, manifest.model_dump(mode="json"))
        return {"complete": True, "objects": len(entries), "tables": len(tables)}
    finally:
        engine.dispose()


def verify(directory, key):
    root = private_directory(directory)
    if not isinstance(key, bytes) or len(key) != 32:
        raise RecoveryError("INVALID_KEY")
    try:
        m = Manifest.model_validate(read_manifest(root, key))
    except (ValueError, TypeError):
        raise RecoveryError("INVALID_MANIFEST") from None
    entries = [m.dump, *m.entries]
    names = [e.file for e in entries]
    if len(set(names)) != len(names) or {p.name for p in root.iterdir()} != set(
        names
    ) | {"manifest.gcm"}:
        raise RecoveryError("ARCHIVE_INVENTORY_MISMATCH")
    if sum(e.size for e in entries) > MAX_TOTAL:
        raise RecoveryError("BACKUP_SIZE_LIMIT")
    seen = set()
    for e in m.entries:
        k = (e.kind, e.organization_id, e.version_id, e.offset)
        if k in seen or e.size > MAX_BYTES or e.source_version == "null":
            raise RecoveryError("INVALID_OBJECT_INVENTORY")
        seen.add(k)
    for e in entries:
        read_payload(root, key, e.model_dump())
    return m


def bind_inventory(m, rows):
    expected = plan(rows)
    entries = {
        (e.kind, e.organization_id, e.version_id, e.offset): e for e in m.entries
    }
    if len(entries) != len(expected):
        raise RecoveryError("DATABASE_OBJECT_INVENTORY_MISMATCH")
    for item in expected:
        e = entries.get(
            (item["kind"], item["organization_id"], item["version_id"], item["offset"])
        )
        if e is None or any(getattr(e, k) != v for k, v in item.items()):
            raise RecoveryError("DATABASE_OBJECT_INVENTORY_MISMATCH")


def restore(directory, key, target_url, storage, receipt, *, app_env, writers_stopped):
    target = local_only(target_url, app_env, writers_stopped)
    root = private_directory(directory)
    m = verify(root, key)  # Authenticate ALL files before changing any destination.
    if target.database == m.source_database or storage.bucket == m.source_bucket:
        raise RecoveryError("DISTINCT_RESTORE_TARGET_REQUIRED")
    receipt = Path(receipt).absolute()
    private_directory(receipt.parent)
    if receipt.exists() or receipt.is_symlink() or receipt.is_relative_to(root):
        raise RecoveryError("NEW_SEPARATE_RECEIPT_REQUIRED")
    storage.check_security()
    found = storage.client.list_object_versions(Bucket=storage.bucket, MaxKeys=1)
    if found.get("Versions") or found.get("DeleteMarkers"):
        raise RecoveryError("RESTORE_BUCKET_NOT_EMPTY")
    engine = engine_for(target_url)
    try:
        with engine.begin() as conn:
            check_target(conn)
            if (
                int(conn.execute(text("SHOW server_version_num")).scalar_one()) // 10000
                != m.postgres_major
                or conn.execute(text("SELECT postgis_version()")).scalar_one()
                != m.postgis_version
            ):
                raise RecoveryError("DATABASE_VERSION_MISMATCH")
        pg_tool(target_url, payload=read_payload(root, key, m.dump.model_dump()))
        with engine.begin() as conn:
            if fingerprints(conn) != m.tables:
                raise RecoveryError("RESTORED_DATABASE_MISMATCH")
            rows = conn.execute(text(ROWS)).mappings().all()
        bind_inventory(m, rows)
        by_id = {(r["organization_id"], r["id"]): r for r in rows}
        mappings = []
        for e in m.entries:
            data = read_payload(root, key, e.model_dump())
            if e.kind == "blob":
                blob = storage.put_quarantined(
                    e.organization_id,
                    (data[i : i + CHUNK] for i in range(0, len(data), CHUNK)),
                    declared_size=e.size,
                    object_id=e.object_id,
                )
                with storage.open_verified(blob) as f:
                    if hashlib.file_digest(f, "sha256").hexdigest() != e.sha256:
                        raise RecoveryError("RESTORED_OBJECT_MISMATCH")
                mappings.append(
                    {
                        "org": e.organization_id,
                        "version": e.version_id,
                        "object": e.object_id,
                        "sha": e.sha256,
                        "old": e.source_version,
                        "new": blob.storage_version,
                    }
                )
            else:
                r = by_id[e.organization_id, e.version_id]
                storage.put_chunk(
                    e.organization_id, e.version_id, e.offset, data, r["expected_size"]
                )
                got, _ = storage._read(
                    storage.staging_key(e.organization_id, e.version_id, e.offset),
                    e.size,
                )
                if hashlib.sha256(got).hexdigest() != e.sha256:
                    raise RecoveryError("RESTORED_CHUNK_MISMATCH")
        with engine.begin() as conn:
            conn.execute(text("SET LOCAL lock_timeout='3s'"))
            conn.execute(text("SET LOCAL statement_timeout='30s'"))
            # Offline owner-only disaster operation. Not a runtime function/grant.
            conn.execute(
                text("LOCK TABLE public.document_versions IN ACCESS EXCLUSIVE MODE")
            )
            conn.execute(
                text(
                    "ALTER TABLE public.document_versions DISABLE TRIGGER document_version_guard"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE public.document_versions DISABLE TRIGGER document_storage_guard"
                )
            )
            for entry in mappings:
                n = conn.execute(
                    text("""UPDATE public.document_versions SET storage_version=:new
                  WHERE organization_id=:org AND id=:version AND object_id=:object
                  AND sha256=:sha AND storage_version=:old AND storage_backend='s3' """),
                    entry,
                ).rowcount
                if n != 1:
                    raise RecoveryError("RESTORE_REFERENCE_CONFLICT")
            conn.execute(
                text(
                    "ALTER TABLE public.document_versions ENABLE TRIGGER document_version_guard"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE public.document_versions ENABLE TRIGGER document_storage_guard"
                )
            )
            conn.execute(
                text(
                    "UPDATE public.sessions SET revoked_at=now() WHERE revoked_at IS NULL"
                )
            )
            conn.execute(
                text(
                    "UPDATE public.supplier_sessions SET revoked_at=now() WHERE revoked_at IS NULL"
                )
            )
            conn.execute(
                text(
                    "UPDATE public.supplier_invitations SET revoked_at=now() WHERE revoked_at IS NULL"
                )
            )
            conn.execute(
                text("""UPDATE public.document_jobs SET status='QUEUED',lease_token=NULL,lease_until=NULL,available_at=now()
                WHERE status='LEASED'""")
            )
            if (
                conn.execute(
                    text("""SELECT count(*) FROM pg_trigger WHERE tgrelid='public.document_versions'::regclass
                AND tgname IN ('document_version_guard','document_storage_guard') AND tgenabled='O'""")
                ).scalar_one()
                != 2
            ):
                raise RecoveryError("IMMUTABILITY_GUARDS_NOT_RESTORED")
        payload = json.dumps(
            {
                "format": "geoforest-restore-receipt-v1",
                "backup_id": str(m.backup_id),
                "restored_at": datetime.now(timezone.utc).isoformat(),
                "target_database": target.database,
                "target_bucket": storage.bucket,
                "target_endpoint": storage.client.meta.endpoint_url,
                "mapping": mappings,
                "original_tables_verified": True,
                "sessions_revoked": True,
                "leases_invalidated": True,
                "promotion": "NOT_AUTHORIZED",
            },
            default=str,
            sort_keys=True,
        ).encode()
        nonce = os.urandom(12)
        write_private(
            receipt,
            nonce + AESGCM(key).encrypt(nonce, payload, AAD + b"restore-receipt"),
        )
        sync_directory(receipt.parent)
        return {
            "restored": True,
            "objects": len(m.entries),
            "mapped_versions": len(mappings),
            "promotion": "NOT_AUTHORIZED",
        }
    finally:
        engine.dispose()
