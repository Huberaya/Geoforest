import os
from contextlib import contextmanager
from pathlib import Path

from app.config import settings
from app.database import session_lock_engine
from app.documents.format_validation import validate_format_from_store
from app.documents.scanner import Scanner
from app.documents.storage import Blob, LocalStore
from fastapi import HTTPException
from sqlalchemy import text


def store():
    return LocalStore(Path(settings().document_storage_root))


def configured():
    if not settings().documents_enabled:
        raise HTTPException(503, "Le dépôt documentaire est désactivé sur ce serveur.")


def capacity(required):
    """Fail closed before writes; concurrent users and other services still require monitoring."""
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
