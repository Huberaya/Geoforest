"""Smoke tests for the frozen initial PostgreSQL migration (offline only)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
OFFLINE_DATABASE_URL = "postgresql+asyncpg://127.0.0.1:55432/offline"
EXPECTED_TABLES = (
    "organizations",
    "users",
    "alerts",
    "suppliers",
    "supplier_invitations",
    "products",
    "shipments",
    "plots",
    "audit_events",
)


def _run_alembic_offline(*args: str) -> str:
    env = os.environ.copy()
    env["DATABASE_URL"] = OFFLINE_DATABASE_URL
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args, "--sql"],
        cwd=BACKEND_DIR,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


def test_initial_upgrade_compiles_complete_postgresql_schema_offline() -> None:
    sql = _run_alembic_offline("upgrade", "head")

    for table in EXPECTED_TABLES:
        assert f"CREATE TABLE {table} (" in sql
    assert sql.count("CREATE TYPE ") == 10
    assert sql.count("CREATE INDEX ") + sql.count("CREATE UNIQUE INDEX ") == 31
    assert "CREATE TABLE alembic_version (" in sql
    assert "CREATE EXTENSION" not in sql.upper()


def test_initial_downgrade_compiles_enum_cleanup_offline() -> None:
    sql = _run_alembic_offline("downgrade", "20260925_0001:base")

    assert sql.count("DROP TYPE ") == 10
    for table in EXPECTED_TABLES:
        assert f"DROP TABLE {table};" in sql
