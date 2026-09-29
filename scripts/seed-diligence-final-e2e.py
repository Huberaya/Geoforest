"""Seed a READY synthetic dossier for real OIDC browser tests.
Test database only. Config contains a local IdP subject/email (no production identity).
Scanner is stubbed ONLY inside this offline fixture process, never in the live API.
"""

# ruff: noqa: E402
import json
import os
import sys
from pathlib import Path

if os.environ.get("APP_ENV") != "test":
    raise SystemExit("APP_ENV=test required")
root = Path(__file__).resolve().parents[1]
private = Path(os.environ["E2E_DILIGENCE_PRIVATE"]).resolve()
if private.is_relative_to(root):
    raise SystemExit("Private fixture directory must remain outside the repository")
cfg = json.loads((private / "config.json").read_text())
sys.path[:0] = [str(root / "backend/tests"), str(root / "backend")]
import conftest
import pytest
from app.config import settings
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy import text
from test_diligence_api import ready_dossier
from test_documents_api import documentary_storage
from test_supply import workspace

settings().diligence_enabled = True
storage = private / "documents"
storage.mkdir(mode=0o700, exist_ok=True)
with pytest.MonkeyPatch.context() as patch:
    documentary_storage.__wrapped__(storage, patch)
    with TestClient(app) as client:
        w = workspace.__wrapped__(
            client,
            conftest.identity.__wrapped__(),
            conftest.signin.__wrapped__(),
            conftest.org.__wrapped__(),
        )
        dossier, url, _ = ready_dossier(client, w)
        with conftest.owner.begin() as c:
            uid = c.execute(
                text("""INSERT INTO users(issuer,subject,email,display_name)
              VALUES(:issuer,:subject,:email,'Recette FICTIVE OIDC')
              ON CONFLICT(issuer,subject) DO UPDATE SET email=EXCLUDED.email RETURNING id"""),
                {
                    "issuer": "http://localhost:3000/identity/realms/geoforest",
                    "subject": cfg["subject"],
                    "email": cfg["email"],
                },
            ).scalar_one()
            c.execute(
                text(
                    "INSERT INTO memberships(organization_id,user_id,role) VALUES(:o,:u,'Admin')"
                ),
                {"o": w[1], "u": uid},
            )
            c.execute(
                text(
                    "UPDATE organizations SET name='Diligence FICTIVE OIDC finale' WHERE id=:o"
                ),
                {"o": w[1]},
            )
            # Remove the temporary non-OIDC fixture login, leaving only the browser login to come.
            c.execute(text("DELETE FROM sessions WHERE user_id=:u"), {"u": w[0]["id"]})
        fixture = {
            "org": str(w[1]),
            "user": str(uid),
            "dossier": str(dossier["dossier_id"]),
            "base": w[2],
            "url": url,
        }
        p = private / "fixture.json"
        p.write_text(json.dumps(fixture))
        p.chmod(0o600)
print(
    "READY dossier and synthetic OIDC membership created; temporary fixture session removed."
)
