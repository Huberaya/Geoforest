import os
from pathlib import Path

import pytest
from app.documents.sandbox_processing import SandboxScanner
from app.documents.storage import LocalStore


@pytest.fixture(autouse=True)
def explicit_opt_in():
    if os.environ.get("DOCUMENT_SANDBOX_TEST") != "1":
        pytest.skip("Real local namespaces/antivirus require DOCUMENT_SANDBOX_TEST=1")
    if not Path("/usr/bin/bwrap").is_file():
        pytest.fail("Install unprivileged bubblewrap before this opt-in recipe")


@pytest.fixture
def store(tmp_path):
    root = tmp_path / "objects"
    root.mkdir(mode=0o700)
    return LocalStore(root)


@pytest.fixture
def scanner():
    root = Path(__file__).resolve().parents[3] / ".cache/clamav-qualification"
    engine = root / "engine/usr/local/bin/clamscan"
    database = root / "database"
    if not engine.is_file() or not (database / "daily.cvd").is_file():
        pytest.fail(
            "Approved verified engine and fresh vendor signatures must be provisioned explicitly"
        )
    return SandboxScanner(engine, database, library_path=root / "engine/usr/local/lib")
