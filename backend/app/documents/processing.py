import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

from app.config import settings
from app.database import session_lock_engine
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
    with store().open_verified(blob) as f:
        data = f.read()
    if hashlib.sha256(data).hexdigest() != blob.sha256:
        return None
    env = {
        "PYTHONPATH": str(Path(__file__).resolve().parents[2]),
        "PATH": "/usr/bin:/bin",
        "LANG": "C",
        "OPENBLAS_NUM_THREADS": "1",
    }
    with tempfile.TemporaryFile() as output_file:
        proc = subprocess.Popen(
            [sys.executable, "-m", "app.documents.format_worker"],
            stdin=subprocess.PIPE,
            stdout=output_file,
            stderr=subprocess.DEVNULL,
            env=env,
            start_new_session=True,
        )
        try:
            proc.communicate(data, timeout=15)
            output_file.seek(0)
            output = output_file.read(4097)
            if proc.returncode or len(output) > 4096:
                return None
            result = json.loads(output)
            return result if result.get("mime") == declared_mime else None
        except (subprocess.TimeoutExpired, ValueError):
            return None
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.communicate()


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
