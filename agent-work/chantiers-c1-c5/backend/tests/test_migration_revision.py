"""Smoke tests for the PostgreSQL migration chain (offline only; no DB writes)."""

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
    "alert_recipient_states",
    "suppliers",
    "supplier_invitations",
    "products",
    "shipments",
    "plots",
    "audit_events",
    "documents",
    "document_versions",
    "document_links",
    "document_checklist_items",
    "risk_cases",
    "risk_case_origins",
    "risk_case_evidence",
    "risk_findings",
    "risk_finding_evidence",
    "risk_mitigation_actions",
    "risk_decisions",
    "declaration_preparations",
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


def test_full_upgrade_compiles_complete_postgresql_schema_offline() -> None:
    sql = _run_alembic_offline("upgrade", "head")

    for table in EXPECTED_TABLES:
        assert f"CREATE TABLE {table} (" in sql
    assert sql.count("CREATE TYPE ") == 10
    assert sql.count("CREATE INDEX ") + sql.count("CREATE UNIQUE INDEX ") == 86
    assert "CREATE TABLE document_versions (" in sql
    assert "CREATE TABLE document_links (" in sql
    assert "CREATE TABLE document_checklist_items (" in sql
    assert "CREATE TABLE risk_cases (" in sql
    assert "CREATE TABLE risk_decisions (" in sql
    assert "CREATE TABLE alert_recipient_states (" in sql
    assert "uq_alerts_org_dedupe_key" in sql
    assert "CREATE TABLE declaration_preparations (" in sql
    assert "uq_document_version_storage_key" in sql
    assert "ck_document_checklist_scope_id" in sql
    assert "CREATE TABLE alembic_version (" in sql
    assert "CREATE EXTENSION" not in sql.upper()


def test_full_downgrade_compiles_enum_cleanup_offline() -> None:
    sql = _run_alembic_offline("downgrade", "20260927_0004:base")

    assert sql.count("DROP TYPE ") == 10
    for table in EXPECTED_TABLES:
        assert f"DROP TABLE {table};" in sql
