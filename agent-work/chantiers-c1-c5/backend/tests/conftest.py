"""Configuration des tests : base SQLite en mémoire pour les tests rapides
(sans PostGIS) OU Postgres de test si TEST_DATABASE_URL est définie.

Pour le Chantier 1, on utilise SQLite en mémoire avec create_async_engine('aiosqlite')
pour valider le flux auth/organisations sans dépendre de Postgres.
"""
from __future__ import annotations

import asyncio
import os
from typing import AsyncGenerator, Generator

import pytest
import pytest_asyncio
from fastapi import Depends
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Force une SECRET_KEY déterministe pour les tests
os.environ.setdefault("SECRET_KEY", "test-secret-key-at-least-32-characters-long-ok")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("GFW_LIVE_ENABLED", "false")

from app.core.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import all_models  # noqa: F401,E402,W0611


TEST_DB_URL = os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")


@pytest.fixture(scope="session")
def event_loop_policy():
    return asyncio.DefaultEventLoopPolicy()


@pytest_asyncio.fixture(scope="session")
async def engine():
    eng = create_async_engine(
        TEST_DB_URL,
        echo=False,
        future=True,
        connect_args={"check_same_thread": False} if TEST_DB_URL.startswith("sqlite") else {},
    )
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture()
async def db_session(engine) -> AsyncGenerator[AsyncSession, None]:
    connection = await engine.connect()
    trans = await connection.begin()
    session = async_sessionmaker(bind=connection, expire_on_commit=False, class_=AsyncSession)()
    # Surcharge la dépendance get_db pour utiliser cette session
    async def _override():
        yield session

    app.dependency_overrides[get_db] = _override
    try:
        yield session
    finally:
        await session.rollback()
        await connection.close()
        app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture()
async def client(db_session) -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
