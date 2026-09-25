"""Configuration de la base de données (PostgreSQL + PostGIS, async SQLAlchemy 2.0).

En dev/test sans Postgres, le moteur peut tourner sur SQLite/aiosqlite (sans PostGIS).
"""
from __future__ import annotations

import logging
import uuid
from typing import AsyncGenerator

from sqlalchemy import String, TypeDecorator, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

logger = logging.getLogger(__name__)

DATABASE_URL = settings.database_url
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

IS_SQLITE = DATABASE_URL.startswith("sqlite")


class UUIDType(TypeDecorator):
    """UUID portable : native UUID sous PG, CHAR(36) sous SQLite (tests/dev)."""

    impl = String(36)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return str(value)
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(value)


# JSONType : JSONB sur PostgreSQL (meilleure performance + index), JSON sur SQLite.
# On le définit ici pour éviter un import circulaire avec models/.
if IS_SQLITE:
    from sqlalchemy import JSON as JSONType  # noqa: N812
else:
    from sqlalchemy.dialects.postgresql import JSONB as JSONType  # noqa: N812


connect_args = {"check_same_thread": False} if IS_SQLITE else {}
engine = create_async_engine(
    DATABASE_URL,
    echo=settings.debug and settings.environment == "development",
    future=True,
    pool_pre_ping=not IS_SQLITE,
    connect_args=connect_args,
)

async_session_factory = async_sessionmaker(
    engine,
    expire_on_commit=False,
    autoflush=False,
    class_=AsyncSession,
)


class Base(DeclarativeBase):
    """Classe de base déclarative pour tous les modèles."""


async def init_db() -> None:
    """Crée les extensions PG si nécessaire puis les tables."""
    from app.models import all_models  # noqa: F401

    try:
        async with engine.begin() as conn:
            if not IS_SQLITE:
                await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
            await conn.run_sync(Base.metadata.create_all)
        logger.info(
            "Base de données initialisée (%s).",
            "SQLite" if IS_SQLITE else "PostgreSQL + PostGIS",
        )
    except Exception as exc:  # pragma: no cover
        logger.warning("Initialisation DB impossible (démarrage ?): %s", exc)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dépendance FastAPI : fournit une session async."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_db_session() -> AsyncSession:
    """Session explicite (hors dépendance FastAPI, ex: tâches Celery)."""
    return async_session_factory()
