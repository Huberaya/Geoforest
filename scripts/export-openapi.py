"""Run with configured environment: PYTHONPATH=backend python scripts/export-openapi.py."""

import json
from pathlib import Path

from app.main import app

Path("docs/openapi.json").write_text(
    json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n"
)
print("docs/openapi.json generated; no tokens or secrets included")
