"""Only loopback *_test databases. pg tools never receive passwords in argv."""

import hashlib
import subprocess
import tempfile

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from .archive import MAX_DUMP, RecoveryError

TABLES = """
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p')
AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
ORDER BY c.relname
"""


def test_url(value):
    u = make_url(value)
    if (
        u.drivername != "postgresql+psycopg"
        or u.host != "127.0.0.1"
        or not u.database
        or not u.database.endswith("_test")
        or u.query
        or u.username != "geoforest_migrator"
        or not u.password
    ):
        raise RecoveryError("DEDICATED_LOOPBACK_TEST_DATABASE_REQUIRED")
    return u


def engine_for(value):
    u = test_url(value)
    return create_engine(u, poolclass=NullPool, connect_args={"connect_timeout": 5})


def fingerprints(conn):
    result = {}
    conn.execute(text("SET LOCAL TIME ZONE 'UTC'"))
    for name, rls, force in conn.execute(text(TABLES)).all():
        # Identifier quoting is through the SQLAlchemy dialect, never string input.
        quoted = conn.dialect.identifier_preparer.quote(name)
        digest = hashlib.sha256()
        count = 0
        for row in conn.execute(
            text(
                f"SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') FROM public.{quoted} t ORDER BY 1 LIMIT 100001"
            )
        ):
            digest.update(row[0].encode() + b"\n")
            count += 1
            if count > 100000:
                raise RecoveryError("LOCAL_TABLE_ROW_LIMIT")
        result[name] = {
            "rows": count,
            "sha256": digest.hexdigest(),
            "rls": rls,
            "force": force,
        }
    return result


def pg_tool(url, *, snapshot=None, payload=None):
    u = test_url(url)
    env = {
        "PATH": "/usr/bin:/bin",
        "LANG": "C",
        "PGPASSWORD": u.password,
        "PGCONNECT_TIMEOUT": "5",
        "PGSSLMODE": "disable",
        "PGOPTIONS": "-c statement_timeout=60000 -c lock_timeout=3000",
    }
    # Unlinked, mode-0600 temporary files; bounded local exercise, not secure erasure.
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as input_file:
        args = [
            "--host",
            u.host,
            "--port",
            str(u.port or 5432),
            "--username",
            u.username,
            "--dbname",
            u.database,
            "--no-password",
        ]
        if payload is None:
            command = [
                "/usr/bin/pg_dump",
                *args,
                "--format=custom",
                "--no-owner",
                "--no-comments",
                "--snapshot=" + snapshot,
            ]
        else:
            if len(payload) > MAX_DUMP:
                raise RecoveryError("DUMP_LIMIT")
            input_file.write(payload)
            input_file.seek(0)
            command = [
                "/usr/bin/pg_restore",
                *args,
                "--no-owner",
                "--no-comments",
                "--exit-on-error",
                "--single-transaction",
            ]
        command = [
            "/usr/bin/prlimit",
            f"--fsize={MAX_DUMP}:{MAX_DUMP}",
            "--cpu=90:90",
            "--",
            *command,
        ]
        proc = subprocess.run(
            command,
            env=env,
            stdin=input_file if payload is not None else subprocess.DEVNULL,
            stdout=output,
            stderr=subprocess.DEVNULL,
            timeout=120,
            check=False,
        )
        if proc.returncode:
            raise RecoveryError("POSTGRES_TOOL_FAILED")
        if payload is not None:
            return None
        if output.tell() > MAX_DUMP:
            raise RecoveryError("DUMP_LIMIT")
        output.seek(0)
        return output.read(MAX_DUMP + 1)


def check_source(conn):
    if (
        conn.execute(
            text("SELECT version_num FROM public.alembic_version")
        ).scalar_one()
        != "0007"
    ):
        raise RecoveryError("UNSUPPORTED_SCHEMA")
    if not conn.execute(
        text("SELECT to_regprocedure('authz.document_claim()') IS NOT NULL")
    ).scalar_one():
        raise RecoveryError("CANDIDATE_SCHEMA_REQUIRED")
    # Bound pg_dump's temporary disk use for this local exercise.
    if (
        conn.execute(text("SELECT pg_database_size(current_database())")).scalar_one()
        > MAX_DUMP // 2
    ):
        raise RecoveryError("LOCAL_DATABASE_SIZE_LIMIT")


def check_target(conn):
    if not conn.execute(
        text(
            "SELECT has_table_privilege(current_user,'public.spatial_ref_sys','INSERT')"
        )
    ).scalar_one():
        raise RecoveryError("POSTGIS_RESTORE_PERMISSION_REQUIRED")
    if conn.execute(text(TABLES)).first() is not None:
        raise RecoveryError("RESTORE_DATABASE_NOT_EMPTY")
    if conn.execute(
        text("""SELECT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolcanlogin AND NOT r.rolsuper
       AND r.rolname<>current_user AND has_database_privilege(r.rolname,current_database(),'CONNECT'))
       OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid())""")
    ).scalar_one():
        raise RecoveryError("RESTORE_DATABASE_MUST_BE_OFFLINE")
    # Superusers remain trusted operators. No other runtime may connect.
