"""Offline local smoke checks only; NOT a Vercel deployment qualification.

Run: .venv/bin/python scripts/audit-vercel-local.py
Uses synthetic configuration, no .env files, no credentials and no database.
Prints JSON evidence. Does not migrate, seed or alter application configuration.
"""

import json
import os
import platform
import subprocess
import sys
import tempfile
from contextlib import ExitStack
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
commit = subprocess.check_output(
    ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
).strip()
sys.path.insert(0, str(ROOT / "backend"))
checks = {}


def forbidden(*args, **kwargs):
    raise AssertionError("Network/database access forbidden in this offline smoke test")


# Replace inherited configuration and avoid reading a repository .env.
with tempfile.TemporaryDirectory(prefix="gft-offline-audit-") as temporary:
    original_cwd = Path.cwd()
    os.chdir(temporary)
    try:
        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {
                "APP_ENV": "test",
                "DATABASE_URL": "postgresql+psycopg://fiction:fiction@127.0.0.1:1/audit_test",
                "SESSION_SECRET": "synthetic-offline-session-secret-000000000000",
                "AUTH_PROVIDER": "oidc",
                "OIDC_CLIENT_SECRET": "synthetic-offline-oidc-secret-11111111111111",
                "PUBLIC_ORIGIN": "http://testserver",
                "ALLOWED_HOSTS": "testserver",
                "FOREST_ANALYSIS_ENABLED": "false",
                "DOCUMENTS_ENABLED": "false",
                "DILIGENCE_ENABLED": "false",
                "PROJ_NETWORK": "OFF",
                "OPENBLAS_NUM_THREADS": "1",
            }, clear=True))
            stack.enter_context(patch("socket.socket.connect", forbidden))
            stack.enter_context(patch("socket.socket.connect_ex", forbidden))
            stack.enter_context(patch("sqlalchemy.engine.Engine.connect", forbidden))
            stack.enter_context(patch("psycopg.connect", forbidden))

            import numpy as np
            import rasterio
            import shapely
            from fastapi.testclient import TestClient
            from pydantic import ValidationError
            from pypdf import PdfReader
            from rasterio.io import MemoryFile
            from rasterio.transform import from_origin
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.ttfonts import TTFont
            from reportlab.pdfgen.canvas import Canvas
            from shapely.geometry import box

            from app.config import Settings
            from app.main import app

            checks["asgi_app_import"] = "PASS"
            with TestClient(app) as client:
                response = client.get("/health/live")
                assert response.status_code == 200 and response.json() == {"status": "ok"}
                checks["local_liveness_without_database"] = "PASS"
                # API rate limiting depends on PostgreSQL before identity checks.
                assert client.get("/api/v1/me").status_code == 503
                checks["api_fails_closed_when_database_access_is_blocked"] = "PASS"

            sample = np.array([[1, 2], [3, 4]], dtype="uint8")
            with MemoryFile() as memory:
                with memory.open(
                    driver="GTiff", height=2, width=2, count=1, dtype="uint8",
                    crs="EPSG:4326", transform=from_origin(1, 1, 0.1, 0.1),
                ) as dataset:
                    dataset.write(sample, 1)
                with memory.open() as dataset:
                    assert np.array_equal(dataset.read(1), sample)
            checks["numpy_rasterio_gdal_memory_roundtrip"] = "PASS"
            square = box(0, 0, 1, 1)
            assert square.is_valid and square.area == 1
            checks["shapely_native_geometry"] = "PASS"

            font = ROOT / "backend/app/diligence/fonts/DejaVuSans.ttf"
            pdfmetrics.registerFont(TTFont("AuditGFT", str(font)))
            output = BytesIO()
            canvas = Canvas(output)
            canvas.setFont("AuditGFT", 10)
            canvas.drawString(40, 800, "Données fictives — audit local uniquement")
            canvas.save()
            assert output.getvalue().startswith(b"%PDF-")
            checks["reportlab_bundled_font"] = "PASS"
            assert len(PdfReader(BytesIO(output.getvalue())).pages) == 1
            checks["pypdf_roundtrip"] = "PASS"

            clerk = {
                "auth_provider": "clerk_development",
                "clerk_issuer": "https://synthetic-audit.clerk.accounts.dev",
                "clerk_secret_key": "sk_test_synthetic_offline_only",
                "public_origin": "http://localhost:3000",
                "database_url": "postgresql+psycopg://fiction:fiction@127.0.0.1:1/audit_test",
                "app_env": "test",
            }
            Settings(_env_file=None, **clerk)
            checks["clerk_development_local_test_control"] = "PASS"
            for name, overrides in [
                ("clerk_development_production_guard", {"app_env": "production"}),
                ("clerk_development_remote_database_guard", {
                    "database_url": "postgresql+psycopg://fiction:fiction@db.invalid/audit_test"
                }),
            ]:
                try:
                    Settings(_env_file=None, **(clerk | overrides))
                except ValidationError as error:
                    assert "Clerk development requires a local _test database" in str(error)
                    checks[name] = "PASS"
                else:
                    raise AssertionError(name + " did not reject unsafe configuration")
    finally:
        os.chdir(original_cwd)

print(json.dumps({
    "scope": "OFFLINE LOCAL ONLY — NOT VERCEL RUNTIME VALIDATION",
    "source_commit": commit,
    "python": platform.python_version(),
    "platform": platform.system(),
    "architecture": platform.machine(),
    "native_versions": {
        "numpy": np.__version__, "rasterio": rasterio.__version__,
        "gdal": rasterio.__gdal_version__, "shapely": shapely.__version__,
    },
    "checks": checks,
    "passed": len(checks),
    "database_access": "none; guarded",
    "remote_credentials_used": False,
    "cloud_deployment_performed": False,
    "not_tested": [
        "Vercel bundle/build and runtime", "production lifespan/readiness",
        "real Clerk authentication", "Neon/RLS/pooling under concurrency",
        "ClamAV", "isolated production workers", "persistent storage",
        "streamed responses through deployed proxy", "full regression suite",
    ],
}, indent=2, ensure_ascii=False))
