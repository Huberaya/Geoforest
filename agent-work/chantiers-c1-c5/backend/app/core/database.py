"""Configuration PostgreSQL/SQLAlchemy 2.0 et contrôle read-only des migrations.

Le modèle stocke les géométries en JSONB et les traite dans l'application; PostGIS
n'est pas requis par le schéma actuel. SQLite/aiosqlite reste réservé aux tests.
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import AsyncGenerator

from alembic.config import Config
from alembic.script import ScriptDirectory
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
    """UUID applicatif sérialisé en VARCHAR(36) sous PostgreSQL comme sous SQLite."""

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


async def verify_db_schema() -> None:
    """Vérifie que la base est au head Alembic; ne crée/modifie aucun objet DB."""
    if settings.environment.lower() == "test" and IS_SQLITE:
        # Les tests créent leurs schémas isolés dans leurs fixtures SQLAlchemy.
        return

    backend_dir = Path(__file__).resolve().parents[2]
    alembic_config = Config(str(backend_dir / "alembic.ini"))
    alembic_config.set_main_option("script_location", str(backend_dir / "alembic"))
    expected_heads = sorted(ScriptDirectory.from_config(alembic_config).get_heads())
    if not expected_heads:
        raise RuntimeError("Aucune révision Alembic n'est disponible dans le déploiement.")

    from app.models import all_models  # noqa: F401 -- ensure model modules are loaded

    try:
        async with engine.connect() as conn:
            result = await conn.execute(
                text("SELECT version_num FROM alembic_version ORDER BY version_num")
            )
            applied_heads = sorted(result.scalars().all())
    except Exception as exc:
        raise RuntimeError(
            "Schéma DB absent ou inaccessible; exécutez `alembic upgrade head` "
            "avec un rôle de migration avant de démarrer l'API."
        ) from exc

    if applied_heads != expected_heads:
        raise RuntimeError(
            "La base n'est pas au head Alembic attendu "
            f"(appliqué={applied_heads}, attendu={expected_heads}); "
            "exécutez `alembic upgrade head` avant de démarrer l'API."
        )
    logger.info("Schéma DB vérifié au head Alembic %s.", applied_heads)


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
