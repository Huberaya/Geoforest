"""Synthetic browser fixture. Test DB only; session file is private and never committed.
Run after backend tests, with APP_ENV=test and E2E_DILIGENCE_SEED outside the repository.
"""

# ruff: noqa: E402
import json
import os
import sys
from pathlib import Path

if os.environ.get("APP_ENV") != "test":
    raise SystemExit("APP_ENV=test required")
target = Path(os.environ["E2E_DILIGENCE_SEED"]).resolve()
root = Path(__file__).resolve().parents[1]
if target.is_relative_to(root):
    raise SystemExit("Session fixture must remain outside the repository")
sys.path[:0] = [str(root / "backend/tests"), str(root / "backend")]
import conftest
from app.config import settings
from app.main import app
from fastapi.testclient import TestClient
from test_diligence_api import fixture
from test_supply import workspace

with TestClient(app) as client:
    identity = conftest.identity.__wrapped__()
    org = conftest.org.__wrapped__()
    signin = conftest.signin.__wrapped__()
    w = workspace.__wrapped__(client, identity, signin, org)
    path, supplier, lot = fixture(client, w)
    actors = {"Admin": w[0]}
    for role in ["Viewer", "Supplier"]:
        actors[role] = identity()
        conftest.membership.__wrapped__()(
            w[1],
            actors[role]["id"],
            role,
            supplier["id"] if role == "Supplier" else None,
        )
    data = {
        "base": path,
        "lot_id": lot["id"],
        "cookie_name": settings().session_cookie,
        "actors": {role: {"token": actor["raw"]} for role, actor in actors.items()},
    }
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as out:
        json.dump(data, out)
print("Synthetic diligence browser fixture created; session values not logged.")
