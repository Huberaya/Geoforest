"""Session fixture refuses non-local targets before importing DB fixtures."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BASE = "postgresql+psycopg://fiction:fiction@127.0.0.1/geoforest_gis_final_test"


@pytest.mark.parametrize(
    "changes",
    [
        {"APP_ENV": "production"},
        {"GIS_FINAL_LOCAL_TEST": "0"},
        {"DATABASE_URL": BASE.replace("127.0.0.1", "api.example.invalid")},
        {"MIGRATION_DATABASE_URL": BASE.replace("geoforest_gis_final_test", "neondb")},
        {"DATABASE_URL": BASE + "?host=api.example.invalid"},
        {"GIS_FINAL_SESSION_FILE": str(ROOT / "forbidden-session.json")},
    ],
)
def test_seed_refuses_before_connection(tmp_path, changes):
    destination = tmp_path / "session.json"
    env = (
        os.environ
        | {
            "APP_ENV": "test",
            "GIS_FINAL_LOCAL_TEST": "1",
            "DATABASE_URL": BASE,
            "MIGRATION_DATABASE_URL": BASE,
            "GIS_FINAL_SESSION_FILE": str(destination),
        }
        | changes
    )
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/seed-gis-final-e2e.py")],
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode != 0
    assert any(
        message in result.stderr
        for message in [
            "Explicit local test opt-in required",
            "Dedicated loopback test database required",
            "Private session file must be outside repository",
        ]
    )
    assert "Traceback" not in result.stderr
    assert not destination.exists() and not (ROOT / "forbidden-session.json").exists()
