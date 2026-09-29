import json
import os

import pytest
from app.documents.recovery.archive import AAD, RecoveryError
from app.documents.recovery.database import engine_for
from app.documents.recovery.service import backup, restore, verify
from app.documents.storage import Blob
from app.documents.worker import execute_job
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from document_worker.test_worker import SyntheticScanner
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

OPTIONS = {"app_env": "test", "writers_stopped": True}


def capture(source, stores, workspace):
    key = os.urandom(32)
    folder = workspace / "backup"
    result = backup(source[0], stores[0], folder, key, **OPTIONS)
    assert result["complete"]
    return folder, key


def test_complete_restore_after_source_objects_are_lost(
    source, target, stores, workspace, seeded
):
    ids, versions = seeded
    folder, key = capture(source, stores, workspace)
    manifest = verify(folder, key)
    assert len(manifest.entries) == 4
    # Deliberate loss of fictional source objects only, inside Moto.
    for obj in stores[0].client.list_object_versions(Bucket=stores[0].bucket)[
        "Versions"
    ]:
        stores[0].client.delete_object(
            Bucket=stores[0].bucket, Key=obj["Key"], VersionId=obj["VersionId"]
        )
    receipt = workspace / "receipt.gcm"
    result = restore(folder, key, target, stores[1], receipt, **OPTIONS)
    assert result == {
        "restored": True,
        "objects": 4,
        "mapped_versions": 2,
        "promotion": "NOT_AUTHORIZED",
    }
    raw = receipt.read_bytes()
    proof = json.loads(
        AESGCM(key).decrypt(raw[:12], raw[12:], AAD + b"restore-receipt")
    )
    assert proof["backup_id"] == str(manifest.backup_id)
    e = engine_for(target)
    try:
        with e.begin() as c:
            rows = {
                r["id"]: r
                for r in c.execute(text("SELECT * FROM document_versions")).mappings()
            }
            for original in versions[:2]:
                row = rows[original["id"]]
                assert row["state"] == original["state"]
                assert row["storage_version"] != original["blob"].storage_version
                blob = Blob(
                    row["organization_id"],
                    row["object_id"],
                    row["expected_size"],
                    row["sha256"],
                    row["storage_version"],
                )
                with stores[1].open_verified(blob) as f:
                    assert f.read() == original["data"]
            assert (
                c.execute(text("SELECT count(*) FROM document_reviews")).scalar_one()
                == 1
            )
            assert (
                c.execute(text("SELECT count(*) FROM audit_events")).scalar_one() == 1
            )
            for table in ("sessions", "supplier_sessions", "supplier_invitations"):
                assert (
                    c.execute(
                        text(f"SELECT count(*) FROM {table} WHERE revoked_at IS NULL")
                    ).scalar_one()
                    == 0
                )
            assert c.execute(
                text("SELECT status,lease_token,lease_until FROM document_jobs")
            ).one() == ("QUEUED", None, None)
            assert not c.execute(
                text(
                    "SELECT has_database_privilege('geoforest_app',current_database(),'CONNECT')"
                )
            ).scalar_one()
            assert c.execute(
                text(
                    "SELECT relrowsecurity FROM pg_class WHERE oid='document_versions'::regclass"
                )
            ).scalar_one()
        with pytest.raises(DBAPIError):
            with e.begin() as c:
                c.execute(
                    text(
                        "UPDATE document_versions SET storage_version='tamper' WHERE state='SCAN_PASSED'"
                    )
                )
        # Queued complete chunks still produce the original document, never automatic approval by restore.
        item = versions[2]
        blob, result, mime = execute_job(
            stores[1],
            SyntheticScanner(),
            {
                "organization_id": item["org"],
                "version_id": item["id"],
                "expected_size": len(item["data"]),
                "expected_sha256": rows[item["id"]]["metadata"]["expected_sha256"],
                "object_id": __import__("uuid").uuid4(),
                "claimed_mime": "image/png",
            },
        )
        assert result["status"] == "SCAN_PASSED" and mime == "image/png"
        assert rows[item["id"]]["state"] == "SCANNING"
        # Partial upload is still partial and its bytes survive.
        partial = versions[3]
        got, _ = stores[1]._read(
            stores[1].staging_key(partial["org"], partial["id"], 0), 64000
        )
        assert got == partial["data"][:64000]
    finally:
        e.dispose()


def test_tampered_backup_does_not_touch_target(
    source, target, stores, workspace, seeded
):
    folder, key = capture(source, stores, workspace)
    m = verify(folder, key)
    path = folder / m.entries[0].file
    raw = bytearray(path.read_bytes())
    raw[-1] ^= 1
    path.write_bytes(raw)
    with pytest.raises(RecoveryError):
        restore(folder, key, target, stores[1], workspace / "receipt.gcm", **OPTIONS)
    assert stores[1].client.list_objects_v2(Bucket=stores[1].bucket)["KeyCount"] == 0
    e = engine_for(target)
    with e.begin() as c:
        assert (
            c.execute(text("SELECT to_regclass('public.users')")).scalar_one() is None
        )
    e.dispose()


def test_wrong_key_fails_before_restore(source, target, stores, workspace, seeded):
    folder, key = capture(source, stores, workspace)
    with pytest.raises(RecoveryError):
        restore(
            folder,
            os.urandom(32),
            target,
            stores[1],
            workspace / "receipt.gcm",
            **OPTIONS,
        )
    assert stores[1].client.list_objects_v2(Bucket=stores[1].bucket)["KeyCount"] == 0


def test_no_restore_over_source_or_populated_bucket(
    source, target, stores, workspace, seeded
):
    folder, key = capture(source, stores, workspace)
    with pytest.raises(RecoveryError, match="DISTINCT"):
        restore(folder, key, source[0], stores[1], workspace / "receipt.gcm", **OPTIONS)
    with pytest.raises(RecoveryError, match="DISTINCT"):
        restore(folder, key, target, stores[0], workspace / "receipt.gcm", **OPTIONS)
    stores[1].client.put_object(
        Bucket=stores[1].bucket, Key="existing", Body=b"fictitious"
    )
    with pytest.raises(RecoveryError, match="BUCKET_NOT_EMPTY"):
        restore(folder, key, target, stores[1], workspace / "receipt.gcm", **OPTIONS)


def test_missing_source_object_never_seals_backup(source, stores, workspace, seeded):
    _, versions = seeded
    blob = versions[0]["blob"]
    stores[0].client.delete_object(
        Bucket=stores[0].bucket,
        Key=stores[0].key(blob.organization_id, blob.object_id),
        VersionId=blob.storage_version,
    )
    with pytest.raises(Exception):
        capture(source, stores, workspace)
    assert not (workspace / "backup" / "manifest.gcm").exists()


def test_local_legacy_content_blocks_incomplete_s3_backup(
    source, stores, workspace, seeded
):
    with source[1].begin() as c:
        # Seed separate legacy version; normal runtime cannot change the backend of a version.
        c.execute(
            text("""INSERT INTO document_versions(organization_id,supplier_id,document_id,version,request_id,input_sha256,metadata,
            expected_size,received_size,actor_id,actor_kind,storage_backend)
            SELECT organization_id,supplier_id,document_id,2,gen_random_uuid(),input_sha256,metadata,
             expected_size,1,actor_id,actor_kind,'local' FROM document_versions LIMIT 1""")
        )
    with pytest.raises(RecoveryError, match="LEGACY_LOCAL"):
        capture(source, stores, workspace)


def test_offline_target_required(source, target, stores, workspace, seeded):
    folder, key = capture(source, stores, workspace)
    e = engine_for(target)
    with e.begin() as c:
        db = c.execute(text("SELECT current_database()")).scalar_one()
        c.exec_driver_sql(f'GRANT CONNECT ON DATABASE "{db}" TO geoforest_app')
    e.dispose()
    with pytest.raises(RecoveryError, match="OFFLINE"):
        restore(folder, key, target, stores[1], workspace / "receipt.gcm", **OPTIONS)


def test_snapshot_dump_matches_inventory_even_if_new_row_commits(
    source, target, stores, workspace, seeded, monkeypatch
):
    from app.documents.recovery import service

    original = service.pg_tool
    injected = False

    def mutate_after_snapshot(url, **kwargs):
        nonlocal injected
        if "snapshot" in kwargs and not injected:
            with source[1].begin() as c:
                c.execute(
                    text(
                        "INSERT INTO organizations(name) VALUES('POST SNAPSHOT FICTIF')"
                    )
                )
            injected = True
        return original(url, **kwargs)

    monkeypatch.setattr(service, "pg_tool", mutate_after_snapshot)
    folder, key = capture(source, stores, workspace)
    restore(folder, key, target, stores[1], workspace / "receipt.gcm", **OPTIONS)
    e = engine_for(target)
    with e.begin() as c:
        assert c.execute(text("SELECT count(*) FROM organizations")).scalar_one() == 2
    e.dispose()
    with source[1].begin() as c:
        assert c.execute(text("SELECT count(*) FROM organizations")).scalar_one() == 3


def test_interrupted_restore_stays_offline_without_receipt(
    source, target, stores, workspace, seeded, monkeypatch
):
    folder, key = capture(source, stores, workspace)
    from app.documents.storage import StorageError

    real = stores[1].put_quarantined
    calls = 0

    def fail_after_first(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls > 1:
            raise StorageError("SYNTHETIC_INTERRUPTION")
        return real(*args, **kwargs)

    monkeypatch.setattr(stores[1], "put_quarantined", fail_after_first)
    with pytest.raises(StorageError):
        restore(folder, key, target, stores[1], workspace / "receipt.gcm", **OPTIONS)
    assert not (workspace / "receipt.gcm").exists()
    e = engine_for(target)
    with e.begin() as c:
        assert not c.execute(
            text(
                "SELECT has_database_privilege('geoforest_app',current_database(),'CONNECT')"
            )
        ).scalar_one()
        assert (
            c.execute(
                text(
                    "SELECT count(*) FROM pg_trigger WHERE tgrelid='public.document_versions'::regclass AND tgname IN ('document_version_guard','document_storage_guard') AND tgenabled='O'"
                )
            ).scalar_one()
            == 2
        )
    e.dispose()
    assert verify(folder, key)
    # Rerunning must not overwrite a partial destination.
    with pytest.raises(RecoveryError):
        restore(folder, key, target, stores[1], workspace / "receipt.gcm", **OPTIONS)


def test_populated_database_refused_without_overwrite(
    source, target, stores, workspace, seeded
):
    folder, key = capture(source, stores, workspace)
    e = engine_for(target)
    with e.begin() as c:
        c.execute(text("CREATE TABLE keep_me (id integer)"))
        c.execute(text("INSERT INTO keep_me VALUES (42)"))
    with pytest.raises(RecoveryError, match="DATABASE_NOT_EMPTY"):
        restore(folder, key, target, stores[1], workspace / "receipt.gcm", **OPTIONS)
    with e.begin() as c:
        assert c.execute(text("SELECT id FROM keep_me")).scalar_one() == 42
    e.dispose()


def test_missing_member_in_authenticated_inventory_refused(
    source, target, stores, workspace, seeded
):
    from app.documents.recovery.archive import seal

    folder, key = capture(source, stores, workspace)
    m = verify(folder, key).model_dump(mode="json")
    removed = m["entries"].pop()
    (folder / removed["file"]).unlink()
    (folder / "manifest.gcm").unlink()
    seal(folder, key, m)
    with pytest.raises(RecoveryError, match="DATABASE_OBJECT_INVENTORY"):
        restore(folder, key, target, stores[1], workspace / "receipt.gcm", **OPTIONS)
    assert stores[1].client.list_objects_v2(Bucket=stores[1].bucket)["KeyCount"] == 0


def test_real_runtime_role_is_still_tenant_scoped_after_restore(
    source, target, stores, workspace, seeded
):
    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url

    folder, key = capture(source, stores, workspace)
    restore(folder, key, target, stores[1], workspace / "receipt.gcm", **OPTIONS)
    e = engine_for(target)
    runtime = create_engine(
        make_url(target).set(
            username="geoforest_app", password="local-test-app-password"
        ),
        poolclass=__import__("sqlalchemy").pool.NullPool,
    )
    # Temporary test-only access for one validation connection, revoked immediately.
    db = make_url(target).database
    with e.begin() as c:
        c.exec_driver_sql(f'GRANT CONNECT ON DATABASE "{db}" TO geoforest_app')
    try:
        with runtime.connect() as app:
            with e.begin() as c:
                c.exec_driver_sql(
                    f'REVOKE CONNECT ON DATABASE "{db}" FROM geoforest_app'
                )
            ids, versions = seeded
            with app.begin():
                app.execute(
                    text(
                        "SELECT set_config('app.user_id',:user,true),set_config('app.organization_id',:org,true)"
                    ),
                    {"user": str(ids["user"]), "org": str(ids["org"])},
                )
                assert (
                    app.execute(
                        text("SELECT count(*) FROM document_versions")
                    ).scalar_one()
                    == 3
                )
                assert (
                    app.execute(
                        text(
                            "SELECT count(*) FROM document_versions WHERE organization_id=:other"
                        ),
                        {"other": ids["other_org"]},
                    ).scalar_one()
                    == 0
                )
            with pytest.raises(DBAPIError):
                with app.begin():
                    app.execute(
                        text(
                            "SELECT set_config('app.user_id',:user,true),set_config('app.organization_id',:org,true)"
                        ),
                        {"user": str(ids["user"]), "org": str(ids["org"])},
                    )
                    app.execute(
                        text(
                            "UPDATE document_versions SET storage_version='forged' WHERE state='SCAN_PASSED'"
                        )
                    )
    finally:
        with e.begin() as c:
            c.exec_driver_sql(f'REVOKE CONNECT ON DATABASE "{db}" FROM geoforest_app')
        runtime.dispose()
        e.dispose()


def test_mapping_failure_rolls_back_temporarily_disabled_guards(
    source, target, stores, workspace, seeded, monkeypatch
):
    from app.documents.recovery import service

    folder, key = capture(source, stores, workspace)
    real = service.text

    def conflict(sql):
        if sql.startswith("UPDATE public.document_versions SET storage_version"):
            return real(sql + " AND false")
        return real(sql)

    monkeypatch.setattr(service, "text", conflict)
    with pytest.raises(RecoveryError, match="REFERENCE_CONFLICT"):
        restore(folder, key, target, stores[1], workspace / "receipt.gcm", **OPTIONS)
    assert not (workspace / "receipt.gcm").exists()
    e = engine_for(target)
    with e.begin() as c:
        assert (
            c.execute(
                text(
                    "SELECT count(*) FROM pg_trigger WHERE tgrelid='public.document_versions'::regclass AND tgname IN ('document_version_guard','document_storage_guard') AND tgenabled='O'"
                )
            ).scalar_one()
            == 2
        )
        old = seeded[1][0]["blob"].storage_version
        assert (
            c.execute(
                text(
                    "SELECT storage_version FROM document_versions WHERE state='SCAN_PASSED'"
                )
            ).scalar_one()
            == old
        )
        assert not c.execute(
            text(
                "SELECT has_database_privilege('geoforest_app',current_database(),'CONNECT')"
            )
        ).scalar_one()
    e.dispose()
