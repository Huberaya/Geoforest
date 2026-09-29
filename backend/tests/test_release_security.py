from contextlib import contextmanager

import pytest
from app.config import Settings, settings
from app.database import transaction
from app.main import app
from app.readiness import RLS_TABLES, UnsafeRuntimeDatabase, verify_runtime_database
from conftest import owner
from fastapi.testclient import TestClient
from sqlalchemy import text


def production(**overrides):
    return Settings(
        _env_file=None,
        **(
            {
                "app_env": "production",
                "database_url": "postgresql+psycopg://geoforest_app:synthetic-only@db.example.invalid/geoforest?sslmode=verify-full&sslrootcert=/etc/test-ca.pem",
                "public_origin": "https://trace.example.invalid",
                "allowed_hosts": "trace.example.invalid,127.0.0.1",
                "oidc_issuer": "https://identity.example.invalid/realms/geoforest",
                "oidc_backchannel_origin": "",
                "session_secret": "synthetic-session-value-" + "a" * 40,
                "oidc_client_secret": "synthetic-client-value-" + "b" * 40,
                "admin_acr": "urn:test:acr:mfa",
            }
            | overrides
        ),
    )


def test_valid_production_config():
    s = production()
    assert s.session_cookie == "__Host-gft-session"
    assert not s.diligence_enabled


@pytest.mark.parametrize(
    "field,value",
    [
        ("public_origin", "https://trace.example.invalid/path"),
        ("public_origin", "https://trace.example.invalid/"),
        ("public_origin", "https://trace.example.invalid?query=1"),
        ("public_origin", "https://trace.example.invalid#fragment"),
        ("public_origin", "https://user:password@trace.example.invalid"),
        ("public_origin", "https://@trace.example.invalid"),
        ("public_origin", "https://"),
        ("public_origin", "https://trace.example.invalid:invalid"),
        ("public_origin", "https://trace.example.invalid\n"),
        ("public_origin", "http://trace.example.invalid"),
        ("oidc_issuer", "https://identity.example.invalid/realm?foo=1"),
        ("oidc_issuer", "https://user@identity.example.invalid/realm"),
        ("oidc_backchannel_origin", "http://keycloak:8080"),
        ("oidc_backchannel_origin", "https://keycloak/identity"),
        ("admin_acr", "   "),
        ("allowed_hosts", "*.example.invalid"),
        ("allowed_hosts", "other.example.invalid"),
        ("allowed_hosts", "trace.example.invalid,"),
        ("allowed_hosts", "trace.example.invalid, localhost"),
        ("session_secret", "CHANGE_ME" * 8),
        ("oidc_client_secret", "short"),
        ("oidc_client_secret", "synthetic-session-value-" + "a" * 40),
    ],
)
def test_production_config_rejects_ambiguous_inputs(field, value):
    with pytest.raises(ValueError):
        production(**{field: value})


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://geoforest_app:secret@db/geoforest",
        "postgresql+psycopg://geoforest_app:secret@db/geoforest?sslmode=require&sslrootcert=/ca",
        "postgresql+psycopg://geoforest_app:secret@db/geoforest?sslmode=verify-full",
        "postgresql+psycopg://postgres:secret@db/geoforest?sslmode=verify-full&sslrootcert=/ca",
        "postgresql+psycopg://geoforest_migrator:secret@db/geoforest?sslmode=verify-full&sslrootcert=/ca",
        "postgresql+psycopg://geoforest_app:secret@db/geoforest?sslmode=verify-full&sslrootcert=/ca&user=postgres",
        "sqlite:///test.db",
        "not a DSN",
    ],
)
def test_production_requires_explicit_verified_database_tls(url):
    with pytest.raises(ValueError) as e:
        production(database_url=url)
    assert url not in str(e.value)
    assert "synthetic-session-value" not in str(e.value)


def test_readiness_accepts_runtime_and_rejects_owner():
    with transaction() as c:
        verify_runtime_database(c)
    with owner.connect() as c:
        with pytest.raises(UnsafeRuntimeDatabase):
            verify_runtime_database(c)
    assert len(RLS_TABLES) == 32


@pytest.mark.parametrize(
    "table",
    ["suppliers", "document_versions", "diligence_revisions", "supplier_sessions"],
)
def test_readiness_fails_if_rls_disabled(client, table):
    # Fixed parametrized identifiers, test DB only. Always restore schema even on failure.
    with owner.begin() as c:
        c.execute(text(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY"))
    try:
        r = client.get("/health/ready")
        assert r.status_code == 503
        assert "geoforest" not in r.text
    finally:
        with owner.begin() as c:
            c.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
    assert client.get("/health/ready").status_code == 200


def test_production_startup_fails_closed_on_owner_role(monkeypatch):
    import app.main as main

    @contextmanager
    def wrong_role():
        with owner.begin() as c:
            yield c

    monkeypatch.setattr(settings(), "app_env", "production")
    monkeypatch.setattr(main, "transaction", wrong_role)
    with pytest.raises(RuntimeError, match="Production database checks failed"):
        with TestClient(app):
            pytest.fail("Application must not start with its migration owner")


def test_production_startup_accepts_checked_database(monkeypatch):
    monkeypatch.setattr(settings(), "app_env", "production")
    with TestClient(app) as client:
        assert client.get("/health/ready").status_code == 200


def test_env_generator_creates_private_file_even_with_permissive_umask(tmp_path):
    import os
    import subprocess
    import sys
    from pathlib import Path

    script = Path(__file__).resolve().parents[2] / "scripts/init-env.py"
    r = subprocess.run(
        [sys.executable, str(script)],
        cwd=tmp_path,
        umask=0,
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0
    p = tmp_path / ".env"
    assert p.stat().st_mode & 0o777 == 0o600
    data = p.read_text()
    assert "DILIGENCE_ENABLED=false" in data
    assert "SESSION_SECRET=" not in r.stdout
    before = p.read_bytes()
    r = subprocess.run([sys.executable, str(script)], cwd=tmp_path, capture_output=True)
    assert r.returncode != 0
    assert p.read_bytes() == before
    os.chmod(p, 0o600)


def test_env_generator_refuses_dangling_symlink(tmp_path):
    import subprocess
    import sys
    from pathlib import Path

    script = Path(__file__).resolve().parents[2] / "scripts/init-env.py"
    target = tmp_path / "must-not-exist"
    (tmp_path / ".env").symlink_to(target)
    r = subprocess.run([sys.executable, str(script)], cwd=tmp_path, capture_output=True)
    assert r.returncode != 0
    assert not target.exists()
