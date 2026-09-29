import os
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

from app.config import settings
from app.database import session_lock_engine
from app.documents.format_validation import validate_format_from_store
from app.documents.s3_store import S3Store
from app.documents.scanner import Scanner
from app.documents.storage import Blob, LocalStore, StorageError
from fastapi import HTTPException
from sqlalchemy import text


@lru_cache(maxsize=1)
def s3_store():
    return S3Store.from_settings(settings())


def store():
    if settings().document_storage_backend == "s3":
        return s3_store()
    return LocalStore(Path(settings().document_storage_root))


def store_for(record):
    backend = record.get("storage_backend", "local")
    if backend == "s3" and (
        settings().app_env != "test" or not settings().document_s3_api_test
    ):
        raise StorageError("S3_API_NOT_QUALIFIED")
    if backend == settings().document_storage_backend:
        return store()
    if backend == "s3":
        return s3_store()
    return LocalStore(Path(settings().document_storage_root))


def require_s3_schema(conn):
    if settings().app_env != "test" or not settings().document_s3_api_test:
        raise HTTPException(503, "Activation S3 non qualifiée sur ce serveur.")
    # Explicit local candidate gate. Never guess that adding SDK settings migrated SQL.
    if not conn.execute(
        text("SELECT to_regprocedure('authz.document_enqueue(uuid,uuid)') IS NOT NULL")
    ).scalar_one():
        raise HTTPException(503, "Le schéma documentaire S3 n’est pas installé.")


def configured():
    if not settings().documents_enabled:
        raise HTTPException(503, "Le dépôt documentaire est désactivé sur ce serveur.")


def capacity(required):
    """Fail closed before writes; concurrent users and other services still require monitoring."""
    if settings().document_storage_backend == "s3":
        return
    fd = store()._root_fd()
    try:
        info = os.fstatvfs(fd)
        if info.f_bavail * info.f_frsize < 256 * 1024**2 + required:
            raise HTTPException(
                507,
                "Capacité disque insuffisante : dépôt suspendu, contactez l’administrateur.",
            )
    finally:
        os.close(fd)


@contextmanager
def scan_slot():
    with session_lock_engine().connect() as conn:
        acquired = conn.execute(
            text(
                "SELECT pg_try_advisory_lock(hashtextextended('documents-global-scan',0))"
            )
        ).scalar()
        conn.commit()
        if not acquired:
            raise HTTPException(
                429, "Un contrôle documentaire est déjà en cours. Réessayez."
            )
        try:
            yield
        finally:
            conn.execute(
                text(
                    "SELECT pg_advisory_unlock(hashtextextended('documents-global-scan',0))"
                )
            )
            conn.commit()


def validate_format(blob: Blob, declared_mime):
    return validate_format_from_store(store(), blob, declared_mime)


def scan(blob):
    cfg = settings()
    return (
        Scanner(
            Path(cfg.clamav_executable),
            Path(cfg.clamav_database),
            library_path=Path(cfg.clamav_library_path)
            if cfg.clamav_library_path
            else None,
        )
        .scan(store(), blob)
        .json()
    )
