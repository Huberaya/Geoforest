"""Pipeline d'upload C7 : limite, signature, antivirus puis stockage privé."""
from __future__ import annotations

import hashlib
import uuid

from fastapi import UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.services.documents import clamav, storage
from app.services.documents.file_validation import FileValidationError, validate_upload


async def inspect_upload(upload: UploadFile) -> tuple[bytes, str, str, str, str]:
    # Lire au plus limite + 1 octet évite de faire confiance au Content-Length fourni par le client.
    data = await upload.read(settings.document_upload_max_bytes + 1)
    if len(data) > settings.document_upload_max_bytes:
        limit_mib = settings.document_upload_max_bytes / (1024 * 1024)
        label = f"{limit_mib:.1f}".rstrip("0").rstrip(".")
        raise FileValidationError("FILE_TOO_LARGE", f"La taille maximale autorisée est de {label} Mio.")
    mime, filename = validate_upload(upload.filename or "", upload.content_type, data)
    scanner_name, scan_status = await run_in_threadpool(clamav.scan_bytes, data)
    if scan_status != "clean":
        raise clamav.ScannerUnavailable("Le scanner n'a pas confirmé que le fichier est sain.")
    digest = hashlib.sha256(data).hexdigest()
    return data, mime, filename, digest, scanner_name


async def store_version(
    *,
    organization_id: uuid.UUID,
    document_id: uuid.UUID,
    version_id: uuid.UUID,
    data: bytes,
    content_type: str,
    sha256: str,
) -> str:
    key = f"org/{organization_id}/documents/{document_id}/versions/{version_id}"
    await run_in_threadpool(storage.put_bytes, key, data, content_type, sha256)
    return key


async def cleanup_object(key: str | None) -> None:
    if not key:
        return
    try:
        await run_in_threadpool(storage.delete_object, key)
    except Exception:
        # Ne jamais divulguer la clé objet ou écraser l'erreur métier initiale.
        return
