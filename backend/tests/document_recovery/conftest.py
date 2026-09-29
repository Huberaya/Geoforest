import hashlib
import io
import json
import os
import subprocess
from uuid import uuid4

import boto3
import pytest
from app.documents.recovery.database import engine_for
from app.documents.recovery.database import test_url as checked_url
from app.documents.s3_store import S3Store
from moto import mock_aws
from PIL import Image
from sqlalchemy import text


@pytest.fixture(autouse=True)
def reset():
    # Never inherits the parent general API DB reset.
    yield


@pytest.fixture
def source():
    url = os.environ.get("DOCUMENT_RECOVERY_TEST_URL")
    if not url:
        pytest.skip(
            "Set DOCUMENT_RECOVERY_TEST_URL for local synthetic recovery exercise"
        )
    parsed = checked_url(url)
    assert parsed.database == "geoforest_backup_test"
    engine = engine_for(url)
    with engine.begin() as c:
        c.execute(text("TRUNCATE organizations,users CASCADE"))
    yield url, engine
    engine.dispose()


@pytest.fixture
def target(source):
    name = "geoforest_dr_" + uuid4().hex[:12] + "_test"

    # New test database only; never drop/recreate an existing database.
    def admin(sql, database="postgres"):
        subprocess.run(
            [
                "sudo",
                "-u",
                "postgres",
                "psql",
                "-v",
                "ON_ERROR_STOP=1",
                "-d",
                database,
                "-c",
                sql,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=30,
        )

    admin(f"CREATE DATABASE {name} OWNER geoforest_migrator")
    admin(f"REVOKE CONNECT ON DATABASE {name} FROM PUBLIC")
    admin(
        "CREATE EXTENSION postgis; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT INSERT ON public.spatial_ref_sys TO geoforest_migrator;",
        name,
    )
    url = (
        checked_url(source[0]).set(database=name).render_as_string(hide_password=False)
    )
    return url


@pytest.fixture
def stores():
    with mock_aws():
        client = boto3.client(
            "s3",
            region_name="eu-west-3",
            aws_access_key_id="synthetic",
            aws_secret_access_key="synthetic",
        )
        result = []
        for bucket in ("geoforest-backup-synthetic", "geoforest-restored-synthetic"):
            client.create_bucket(
                Bucket=bucket,
                CreateBucketConfiguration={"LocationConstraint": "eu-west-3"},
            )
            client.put_bucket_versioning(
                Bucket=bucket, VersioningConfiguration={"Status": "Enabled"}
            )
            client.put_public_access_block(
                Bucket=bucket,
                PublicAccessBlockConfiguration={
                    k: True
                    for k in (
                        "BlockPublicAcls",
                        "IgnorePublicAcls",
                        "BlockPublicPolicy",
                        "RestrictPublicBuckets",
                    )
                },
            )
            client.put_bucket_encryption(
                Bucket=bucket,
                ServerSideEncryptionConfiguration={
                    "Rules": [
                        {
                            "ApplyServerSideEncryptionByDefault": {
                                "SSEAlgorithm": "AES256"
                            }
                        }
                    ]
                },
            )
            result.append(S3Store(client, bucket))
        yield result


@pytest.fixture
def workspace(tmp_path):
    tmp_path.chmod(0o700)
    return tmp_path


@pytest.fixture
def seeded(source, stores):
    engine = source[1]
    storage = stores[0]
    ids = {
        k: uuid4() for k in ("org", "other_org", "user", "supplier", "other_supplier")
    }
    f = io.BytesIO()
    Image.new("RGB", (3, 3), "white").save(f, format="PNG")
    data = f.getvalue()
    versions = []
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO users(id,issuer,subject,email,display_name) VALUES(:user,'synthetic','synthetic','test@example.invalid','Fictif')"
            ),
            ids,
        )
        for o, s in (
            (ids["org"], ids["supplier"]),
            (ids["other_org"], ids["other_supplier"]),
        ):
            c.execute(
                text(
                    "INSERT INTO organizations(id,name) VALUES(:o,'Organisation FICTIVE')"
                ),
                {"o": o},
            )
            c.execute(
                text(
                    "INSERT INTO memberships(organization_id,user_id,role) VALUES(:o,:u,'Admin')"
                ),
                {"o": o, "u": ids["user"]},
            )
            c.execute(
                text(
                    "INSERT INTO suppliers(organization_id,id,reference,name) VALUES(:o,:s,'SYN','Fournisseur FICTIF')"
                ),
                {"o": o, "s": s},
            )
        for state, o, s in [
            ("SCAN_PASSED", ids["org"], ids["supplier"]),
            ("SCAN_REJECTED", ids["other_org"], ids["other_supplier"]),
            ("SCANNING", ids["org"], ids["supplier"]),
            ("UPLOADING", ids["org"], ids["supplier"]),
        ]:
            d, v = uuid4(), uuid4()
            partial = state == "UPLOADING"
            payload = b"p" * 64000 + b"end" if partial else data
            received = 64000 if partial else len(payload)
            sha = hashlib.sha256(payload).hexdigest()
            blob = None
            if state in ("SCAN_PASSED", "SCAN_REJECTED"):
                blob = storage.put_quarantined(o, [payload], declared_size=len(payload))
            else:
                storage.put_chunk(o, v, 0, payload[:received], len(payload))
            c.execute(
                text(
                    "INSERT INTO documents(organization_id,supplier_id,id) VALUES(:o,:s,:d)"
                ),
                {"o": o, "s": s, "d": d},
            )
            c.execute(
                text("""INSERT INTO document_versions(organization_id,supplier_id,document_id,id,version,request_id,
              input_sha256,metadata,expected_size,received_size,actor_id,actor_kind,storage_backend,state,object_id,sha256,storage_version,mime,scan_result)
              VALUES(:o,:s,:d,:v,1,:req,:sha,CAST(:meta AS jsonb),:size,:received,:u,'user','s3',:state,:obj,:hash,:sv,:mime,CAST(:result AS jsonb))"""),
                {
                    "o": o,
                    "s": s,
                    "d": d,
                    "v": v,
                    "req": uuid4(),
                    "sha": sha,
                    "meta": json.dumps(
                        {
                            "expected_sha256": sha,
                            "claimed_mime": "image/png",
                            "title": "FICTIF",
                        }
                    ),
                    "size": len(payload),
                    "received": received,
                    "u": ids["user"],
                    "state": state,
                    "obj": blob.object_id if blob else None,
                    "hash": blob.sha256 if blob else None,
                    "sv": blob.storage_version if blob else None,
                    "mime": "image/png" if state == "SCAN_PASSED" else None,
                    "result": json.dumps({"status": state}) if blob else None,
                },
            )
            if state == "SCAN_PASSED":
                c.execute(
                    text(
                        "INSERT INTO document_reviews(organization_id,supplier_id,version_id,decision,note,actor_id) VALUES(:o,:s,:v,'ACCEPTED','Revue synthétique conservée',:u)"
                    ),
                    {"o": o, "s": s, "v": v, "u": ids["user"]},
                )
            if state == "SCANNING":
                c.execute(
                    text(
                        "INSERT INTO document_jobs(organization_id,version_id,status,lease_token,lease_until) VALUES(:o,:v,'LEASED',:t,now()+interval '5 minutes')"
                    ),
                    {"o": o, "v": v, "t": uuid4()},
                )
            versions.append(
                {"id": v, "org": o, "state": state, "blob": blob, "data": payload}
            )
        c.execute(
            text(
                "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES('synthetic-session',:user,'synthetic-csrf',now()+interval '1 hour')"
            ),
            ids,
        )
        inv = uuid4()
        c.execute(
            text(
                "INSERT INTO supplier_invitations(organization_id,supplier_id,id,token_hash,created_by,expires_at) VALUES(:org,:supplier,:inv,'synthetic-invitation',:user,now()+interval '1 hour')"
            ),
            ids | {"inv": inv},
        )
        c.execute(
            text(
                "INSERT INTO supplier_sessions(token_hash,organization_id,supplier_id,invitation_id,csrf_token,expires_at) VALUES('synthetic-portal',:org,:supplier,:inv,'synthetic-csrf',now()+interval '1 hour')"
            ),
            ids | {"inv": inv},
        )
        c.execute(
            text(
                "INSERT INTO audit_events(organization_id,actor_id,action,object_type,object_id) VALUES(:org,:user,'synthetic.created','document',:v)"
            ),
            ids | {"v": versions[0]["id"]},
        )
    return ids, versions
