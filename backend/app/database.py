from contextlib import contextmanager
from functools import lru_cache

import certifi
from app.config import settings
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool


def connection_options(url, timeout):
    options = {"connect_timeout": timeout}
    if make_url(url).query.get("sslrootcert") == "certifi":
        options["sslrootcert"] = certifi.where()
    return options


@lru_cache
def engine():
    cfg = settings()
    return create_engine(
        cfg.database_url,
        pool_pre_ping=True,
        pool_size=cfg.database_pool_size,
        max_overflow=cfg.database_max_overflow,
        pool_timeout=cfg.database_pool_timeout,
        pool_recycle=cfg.database_pool_recycle,
        connect_args=connection_options(cfg.database_url, cfg.database_connect_timeout),
    )


def session_lock_engine():
    cfg = settings()
    if cfg.database_connection_mode != "direct":
        raise RuntimeError(
            "Session advisory locks require a direct database connection"
        )
    return _direct_lock_engine(cfg.database_url, cfg.database_connect_timeout)


@lru_cache
def _direct_lock_engine(url, timeout):
    # Separate from the API pool: a long-running worker must not exhaust it.
    # NullPool physically closes the connection, releasing even leaked session locks.
    return create_engine(
        url,
        poolclass=NullPool,
        connect_args=connection_options(url, timeout),
    )


@contextmanager
def transaction(
    user_id=None, organization_id=None, portal_session=None, *, isolation_level=None
):
    target = (
        engine().execution_options(isolation_level=isolation_level)
        if isolation_level
        else engine()
    )
    with target.begin() as conn:
        # LOCAL scope prevents identity leakage when a pooled connection is reused.
        conn.execute(
            text(
                "SELECT set_config('app.user_id', :u, true), set_config('app.organization_id', :o, true), set_config('app.portal_session', :p, true), set_config('statement_timeout', :st, true), set_config('lock_timeout', :lt, true)"
            ),
            {
                "u": str(user_id or ""),
                "o": str(organization_id or ""),
                "p": str(portal_session or ""),
                "st": str(settings().database_statement_timeout_ms),
                "lt": str(settings().database_lock_timeout_ms),
            },
        )
        yield conn
