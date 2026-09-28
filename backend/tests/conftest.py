import os
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

# These are test-only database credentials. Tests refuse any database not suffixed _test.
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://geoforest_app:local-test-app-password@127.0.0.1:5432/geoforest_test",
)
os.environ.setdefault(
    "MIGRATION_DATABASE_URL",
    "postgresql+psycopg://geoforest_migrator:local-test-migrator-password@127.0.0.1:5432/geoforest_test",
)
os.environ.setdefault(
    "SESSION_SECRET", "test-only-session-secret-at-least-thirty-two-characters"
)
os.environ.setdefault("OIDC_CLIENT_SECRET", "test-only")
os.environ.setdefault("PUBLIC_ORIGIN", "http://localhost:3000")
os.environ.setdefault("ALLOWED_HOSTS", "localhost,127.0.0.1,testserver")
assert make_url(os.environ["DATABASE_URL"]).database.endswith("_test")
assert make_url(os.environ["MIGRATION_DATABASE_URL"]).database.endswith("_test")
from app.config import settings
from app.database import transaction
from app.main import app
from app.security import token_hash

owner = create_engine(os.environ["MIGRATION_DATABASE_URL"])


@pytest.fixture(autouse=True)
def reset():
    with owner.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE audit_events,memberships,organizations,sessions,users,rate_buckets CASCADE"
            )
        )
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def identity():
    def make(email=None, expired=False, acr=""):
        uid = uuid4()
        raw = secrets.token_urlsafe(48)
        csrf = secrets.token_urlsafe(32)
        with owner.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO users(id,issuer,subject,email,display_name) VALUES(:u,'test',:s,:e,'Utilisateur synthétique')"
                ),
                {"u": uid, "s": str(uid), "e": email or f"{uid}@example.invalid"},
            )
            conn.execute(
                text(
                    "INSERT INTO sessions(token_hash,user_id,csrf_token,acr,expires_at) VALUES(:h,:u,:c,:a,:e)"
                ),
                {
                    "h": token_hash(raw),
                    "u": uid,
                    "c": csrf,
                    "a": acr,
                    "e": datetime.now(timezone.utc)
                    + timedelta(hours=-1 if expired else 1),
                },
            )
        return {
            "id": uid,
            "raw": raw,
            "csrf": csrf,
            "email": email or f"{uid}@example.invalid",
        }

    return make


@pytest.fixture
def signin():
    def use(client, who):
        client.cookies.clear()
        client.cookies.set(settings().session_cookie, who["raw"])
        client.headers.update(
            {"Origin": settings().public_origin, "X-CSRF-Token": who["csrf"]}
        )

    return use


@pytest.fixture
def org():
    def make(uid, name="Organisation synthétique"):
        with transaction(uid) as conn:
            return conn.execute(
                text("SELECT authz.create_organization(:n)"), {"n": name}
            ).scalar_one()

    return make


@pytest.fixture
def membership():
    def make(org, uid, role="Viewer", supplier=None):
        with owner.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO memberships(organization_id,user_id,role,supplier_id) VALUES(:o,:u,:r,:s)"
                ),
                {"o": org, "u": uid, "r": role, "s": supplier},
            )

    return make
