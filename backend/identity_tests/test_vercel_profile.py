"""Offline configuration/packaging/gate tests; no remote credentials or DB calls."""

import json
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from app.readiness import UnsafeRuntimeDatabase
from app.runtime_gate import RuntimeReadinessGate
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import NullPool
from test_clerk_production import configuration

from app import database, runtime_gate


def profile(**overrides):
    return configuration(
        vercel=True,
        **({"database_pool_size": 2, "database_max_overflow": 0} | overrides),
    )


def test_vercel_core_profile():
    cfg = profile()
    assert cfg.app_env == "production" and not cfg.documents_enabled


@pytest.mark.parametrize(
    "changes",
    [
        {"app_env": "development"},
        {"app_env": "test"},
        {"database_pool_size": 3},
        {"database_pool_size": 0},
        {"database_max_overflow": 1},
        {"documents_enabled": True},
        {"forest_analysis_enabled": True},
        {"diligence_enabled": True},
        {"database_pool_timeout": 0},
        {"database_connect_timeout": 0},
    ],
)
def test_unsafe_vercel_profile_rejected(changes):
    with pytest.raises(ValueError):
        profile(**changes)


def test_neon_pooler_must_be_declared():
    url = "postgresql+psycopg://geoforest_app:fiction@ep-fiction-pooler.eu.neon.tech/gft?sslmode=verify-full&sslrootcert=/fiction/ca.pem"
    with pytest.raises(ValueError, match="explicit"):
        profile(database_url=url)
    assert profile(database_url=url, database_connection_mode="transaction_pool")


@pytest.mark.parametrize("feature", ["documents_enabled", "forest_analysis_enabled"])
def test_session_workers_reject_transaction_pooling_even_outside_vercel(feature):
    with pytest.raises(ValueError, match="Session advisory locks"):
        configuration(database_connection_mode="transaction_pool", **{feature: True})


def test_engines_are_bounded_and_session_locks_do_not_consume_api_pool(monkeypatch):
    cfg = profile()
    monkeypatch.setattr(database, "settings", lambda: cfg)
    database.engine.cache_clear()
    api = database.engine()
    locks = database.session_lock_engine()
    try:
        assert api.pool.size() == 2 and api.pool._max_overflow == 0
        assert api.pool.timeout() == 5
        assert isinstance(locks.pool, NullPool) and locks is not api
        cfg.database_connection_mode = "transaction_pool"
        with pytest.raises(RuntimeError, match="direct"):
            database.session_lock_engine()  # Also refused after an earlier cached direct engine.
    finally:
        api.dispose()
        locks.dispose()
        database.engine.cache_clear()
        database._direct_lock_engine.cache_clear()


def test_runtime_manifest_and_resources():
    root = Path(__file__).resolve().parents[1]

    def lines(name):
        return {
            line.lower()
            for line in (root / name).read_text().splitlines()
            if line and not line.startswith("#")
        }

    runtime = lines("requirements.txt")
    lock = lines("requirements.lock")
    excluded = {
        line
        for line in lock
        if line.split("==")[0] in {"pytest", "iniconfig", "pluggy", "pygments"}
    }
    assert runtime == lock - excluded
    for dep in ("fastapi", "pillow", "pypdf", "reportlab", "rasterio", "psycopg"):
        assert any(line.startswith(dep + "==") for line in runtime)
    assert (root / ".python-version").read_text().strip() == "3.13"
    cfg = json.loads((root / "vercel.json").read_text())
    assert cfg["framework"] == "fastapi" and cfg["regions"] == ["fra1"]
    assert cfg["functions"]["app/main.py"]["maxDuration"] == 60
    assert (root / "app/main.py").exists()
    assert (root / "app/diligence/fonts/DejaVuSans.ttf").exists()
    assert (root / "reference").is_dir()


@pytest.fixture
def gate(monkeypatch):
    state = SimpleNamespace(calls=0, fail=False)
    monkeypatch.setattr(
        runtime_gate,
        "settings",
        lambda: SimpleNamespace(app_env="production", database_url="fiction"),
    )

    @contextmanager
    def tx():
        yield object()

    def check(conn):
        state.calls += 1
        if state.fail:
            raise UnsafeRuntimeDatabase("secret DSN must not escape")

    monkeypatch.setattr(runtime_gate, "transaction", tx)
    monkeypatch.setattr(runtime_gate, "verify_ready_connection", check)
    app = FastAPI()

    @app.get("/api/probe")
    @app.get("/health/live")
    def probe():
        return {"reachable": True}

    middleware = RuntimeReadinessGate(app)
    # Intentionally do NOT enter the TestClient lifespan context.
    return state, middleware, TestClient(middleware)


def test_no_lifespan_does_not_bypass_production_readiness(gate):
    state, _, client = gate
    state.fail = True
    response = client.get("/api/probe")
    assert response.status_code == 503 and "secret" not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert state.calls == 1


def test_liveness_is_not_readiness(gate):
    state, _, client = gate
    state.fail = True
    assert client.get("/health/live").status_code == 200 and state.calls == 0


def test_gate_caches_only_success_and_rechecks_after_expiration(gate):
    state, middleware, client = gate
    state.fail = True
    assert client.get("/api/probe").status_code == 503
    state.fail = False
    assert client.get("/api/probe").status_code == 200
    assert client.get("/api/probe").status_code == 200 and state.calls == 2
    middleware._until = 0
    state.fail = True
    assert client.get("/api/probe").status_code == 503 and state.calls == 3


def test_packaged_ca_selector_does_not_assume_a_system_path():
    options = database.connection_options(
        "postgresql+psycopg://fiction:fiction@db.example/gft?sslmode=verify-full&sslrootcert=certifi",
        5,
    )
    assert Path(options["sslrootcert"]).is_file()
    assert options["connect_timeout"] == 5
    assert database.connection_options(
        "postgresql+psycopg://fiction:fiction@db.example/gft?sslrootcert=/operator/ca.pem",
        5,
    ) == {"connect_timeout": 5}
