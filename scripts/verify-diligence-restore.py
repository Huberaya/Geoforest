"""Offline test-only restore verification. Never restore over the source database.
Source writers must be stopped before the dump and remain stopped for comparison.
Requires SOURCE_MIGRATION_DATABASE_URL, MIGRATION_DATABASE_URL (restore),
DATABASE_URL (restore runtime), DOCUMENT_STORAGE_ROOT and RESTORE_PROOF_OUTPUT.
No private payload, credentials or raw sessions are written into the proof.
"""

# ruff: noqa: E402
import csv
import hashlib
import io
import json
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

if os.environ.get("APP_ENV") != "test" or "--writers-stopped" not in sys.argv:
    raise SystemExit("Test environment and explicitly stopped source writers required")
source_url = os.environ["SOURCE_MIGRATION_DATABASE_URL"]
restore_url = os.environ["MIGRATION_DATABASE_URL"]
source_name = make_url(source_url).database
restore_name = make_url(restore_url).database
if (
    not source_name.endswith("_test")
    or not restore_name.endswith("_test")
    or source_name == restore_name
    or make_url(os.environ["DATABASE_URL"]).database != restore_name
):
    raise SystemExit("Distinct test databases and matching restore runtime required")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.config import settings
from app.main import app
from app.security import token_hash
from fastapi.testclient import TestClient
from pypdf import PdfReader

source = create_engine(source_url)
restore = create_engine(restore_url)
report = {
    "checked_at": datetime.now(timezone.utc).isoformat(),
    "isolated_restore": True,
    "source_writers_stopped": True,
    "tables": {},
    "exports": [],
}
for table in [
    "diligence_dossiers",
    "diligence_revisions",
    "diligence_decisions",
    "document_versions",
    "document_reviews",
    "legality_assessments",
    "risk_assessments",
]:

    def read(engine):
        with engine.connect() as c:
            return [
                r[0]
                for r in c.execute(
                    text(
                        f"SELECT to_jsonb(t)::text FROM {table} t ORDER BY to_jsonb(t)::text"
                    )
                )
            ]

    a, b = read(source), read(restore)
    assert a == b, table
    report["tables"][table] = {
        "rows": len(a),
        "identical": True,
        "sha256": hashlib.sha256("\n".join(a).encode()).hexdigest(),
    }
with restore.begin() as c:
    c.execute(text("UPDATE sessions SET revoked_at=now() WHERE revoked_at IS NULL"))
    c.execute(
        text("UPDATE supplier_sessions SET revoked_at=now() WHERE revoked_at IS NULL")
    )
    # A cloned invitation must never be valid in the restored environment.
    c.execute(
        text(
            "UPDATE supplier_invitations SET revoked_at=now() WHERE revoked_at IS NULL"
        )
    )
    rows = list(
        c.execute(
            text(
                "SELECT organization_id,dossier_id,revision,created_by,snapshot_sha256 FROM diligence_revisions ORDER BY revision"
            )
        ).mappings()
    )
    assert rows
raw = secrets.token_urlsafe(48)
try:
    with restore.begin() as c:
        c.execute(
            text(
                "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES(:h,:u,:csrf,now()+interval '5 minutes')"
            ),
            {
                "h": token_hash(raw),
                "u": rows[0]["created_by"],
                "csrf": secrets.token_urlsafe(32),
            },
        )
    with TestClient(app) as client:
        client.cookies.set(settings().session_cookie, raw)
        for row in rows:
            url = f"/api/v1/organizations/{row['organization_id']}/diligence/{row['dossier_id']}/revisions/{row['revision']}"
            for kind in ["json", "csv", "pdf"]:
                r = client.get(url + "/export." + kind)
                assert r.status_code == 200, (kind, r.status_code)
                assert (
                    hashlib.sha256(r.content).hexdigest()
                    == r.headers["x-content-sha256"]
                )
                if kind == "json":
                    d = r.json()
                    assert d["snapshot_sha256"] == row["snapshot_sha256"]
                    assert d["source_matches_now"]
                    if not d["is_current_revision"]:
                        assert (
                            d["validation_applicability"] == "NOT_A_CURRENT_VALIDATION"
                        )
                elif kind == "csv":
                    cells = list(
                        csv.DictReader(io.StringIO(r.content.decode("utf-8-sig")))
                    )
                    assert (
                        cells and cells[0]["snapshot_sha256"] == row["snapshot_sha256"]
                    )
                else:
                    pdf = PdfReader(io.BytesIO(r.content))
                    assert "NON SOUMIS PAR GEOFOREST" in pdf.pages[0].extract_text()
                report["exports"].append(
                    {
                        "revision": row["revision"],
                        "format": kind,
                        "status": 200,
                        "integrity_verified": True,
                    }
                )
        client.cookies.clear()
        for kind in ["json", "csv", "pdf"]:
            assert client.get(url + "/export." + kind).status_code == 401
finally:
    with restore.begin() as c:
        c.execute(
            text("UPDATE sessions SET revoked_at=now() WHERE token_hash=:h"),
            {"h": token_hash(raw)},
        )
    # Remove all remaining live test logins on source after its snapshot comparison.
    with source.begin() as c:
        c.execute(text("UPDATE sessions SET revoked_at=now() WHERE revoked_at IS NULL"))
report.update(
    {
        "anonymous_exports": {"json": 401, "csv": 401, "pdf": 401},
        "restored_sessions_and_invitations_revoked": True,
        "temporary_session_revoked": True,
        "source_sessions_revoked_after_comparison": True,
    }
)
Path(os.environ["RESTORE_PROOF_OUTPUT"]).write_text(json.dumps(report, indent=2) + "\n")
print(
    f"Restore verified: 7 tables identical, {len(report['exports'])} exports verified, anonymous refused, sessions revoked."
)
