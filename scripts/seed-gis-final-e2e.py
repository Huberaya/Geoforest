"""Opt-in synthetic session for local GIS end-to-end only; never cloud login.

Does not expose a test login route. No reset, no production credentials.
"""

import json
import os
import sys
from pathlib import Path

from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
if os.environ.get("APP_ENV") != "test" or os.environ.get("GIS_FINAL_LOCAL_TEST") != "1":
    raise SystemExit("Explicit local test opt-in required")
for key in ("DATABASE_URL", "MIGRATION_DATABASE_URL"):
    url = make_url(os.environ[key])
    if (
        url.host != "127.0.0.1"
        or url.database != "geoforest_gis_final_test"
        or url.query
    ):
        raise SystemExit("Dedicated loopback test database required")
target = Path(os.environ["GIS_FINAL_SESSION_FILE"]).resolve()
if target.is_relative_to(ROOT):
    raise SystemExit("Private session file must be outside repository")
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "backend/tests")]
import conftest  # noqa: E402

from app.config import settings  # noqa: E402

identity = conftest.identity.__wrapped__()()
target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
# O_EXCL: never overwrite a previous fixture or follow a symlink.
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as f:
    json.dump(
        {
            "cookie_name": settings().session_cookie,
            "cookie_value": identity["raw"],
            "user_id": str(identity["id"]),
        },
        f,
    )
print("Synthetic local session prepared; credential not logged")
