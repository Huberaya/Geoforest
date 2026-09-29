"""Real local PostgreSQL only: connection budget, LOCAL identity and session locks."""

from uuid import uuid4

import pytest
from app.config import settings
from app.documents.processing import scan_slot
from app.forest.routes import work_slot
from sqlalchemy import text

from app import database


@pytest.fixture
def single_api_connection(monkeypatch):
    database.engine().dispose()
    database.engine.cache_clear()
    monkeypatch.setattr(settings(), "database_pool_size", 1)
    monkeypatch.setattr(settings(), "database_max_overflow", 0)
    try:
        yield
    finally:
        database.engine().dispose()
        database.engine.cache_clear()


def test_worker_does_not_starve_single_connection_api_pool(single_api_connection):
    with work_slot(uuid4(), uuid4()):
        with database.transaction() as conn:
            assert conn.execute(text("SELECT 1")).scalar() == 1
    with scan_slot():
        with database.transaction() as conn:
            assert conn.execute(text("SELECT 1")).scalar() == 1


def test_local_identity_and_timeouts_do_not_leak(single_api_connection):
    user = uuid4()
    with database.transaction(user) as conn:
        pid = conn.execute(text("SELECT pg_backend_pid()")).scalar()
        assert conn.execute(
            text("SELECT current_setting('app.user_id')")
        ).scalar() == str(user)
        assert conn.execute(text("SHOW statement_timeout")).scalar() == "15s"
        assert conn.execute(text("SHOW lock_timeout")).scalar() == "3s"
    with database.transaction() as conn:
        assert conn.execute(text("SELECT pg_backend_pid()")).scalar() == pid
        assert (
            conn.execute(text("SELECT current_setting('app.user_id')")).scalar() == ""
        )
    with database.engine().connect() as conn:
        assert conn.execute(text("SHOW statement_timeout")).scalar() == "0"
        assert conn.execute(text("SHOW lock_timeout")).scalar() == "0"


def test_session_locks_release_on_exception():
    org, request_id = uuid4(), uuid4()
    with pytest.raises(RuntimeError):
        with work_slot(org, request_id):
            raise RuntimeError("synthetic cancellation")
    with work_slot(org, request_id):
        pass
    with pytest.raises(RuntimeError):
        with scan_slot():
            raise RuntimeError("synthetic cancellation")
    with scan_slot():
        pass


def test_sql_timeout_does_not_leave_a_dirty_connection(single_api_connection):
    from sqlalchemy.exc import DBAPIError

    with pytest.raises(DBAPIError):
        with database.transaction(uuid4()) as conn:
            conn.execute(text("SET LOCAL statement_timeout='10ms'"))
            conn.execute(text("SELECT pg_sleep(0.2)"))
    with database.transaction() as conn:
        assert (
            conn.execute(text("SELECT current_setting('app.user_id')")).scalar() == ""
        )
        assert conn.execute(text("SELECT 1")).scalar() == 1
