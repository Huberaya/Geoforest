from contextlib import contextmanager
from functools import lru_cache

from app.config import settings
from sqlalchemy import create_engine, text


@lru_cache
def engine():
    return create_engine(
        settings().database_url, pool_pre_ping=True, pool_size=5, max_overflow=5
    )


@contextmanager
def transaction(user_id=None, organization_id=None):
    with engine().begin() as conn:
        # LOCAL scope prevents identity leakage when a pooled connection is reused.
        conn.execute(
            text(
                "SELECT set_config('app.user_id', :u, true), set_config('app.organization_id', :o, true)"
            ),
            {"u": str(user_id or ""), "o": str(organization_id or "")},
        )
        yield conn
