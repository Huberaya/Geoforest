"""Validation du type réel des fichiers C7 (extension et signature ne suffisent pas seules)."""
from __future__ import annotations

import io
import re
import unicodedata
import zipfile
from pathlib import PurePosixPath

from app.core.config import settings


class FileValidationError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


_ALLOWED = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
_GENERIC_MIME = {"", "application/octet-stream", "binary/octet-stream"}
_MAX_DOCX_EXPANDED_BYTES = 100 * 1024 * 1024
_MAX_DOCX_ENTRIES = 1000
_MAX_DOCX_COMPRESSION_RATIO = 200


def sanitize_filename(filename: str) -> str:
    """Conserve un nom d'affichage sûr; ce nom n'est jamais utilisé comme clé objet."""
    raw = (filename or "").replace("\\", "/")
    name = PurePosixPath(raw).name
    name = unicodedata.normalize("NFC", name)
    name = "".join(ch for ch in name if ch.isprintable() and ch not in "\x00\r\n")
    name = re.sub(r"[<>:\"|?*]", "_", name).strip(" .")
    if not name or len(name) > 255:
        raise FileValidationError("INVALID_FILENAME", "Le nom du fichier est invalide.")
    return name


def _docx_is_valid(data: bytes) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            names = {info.filename for info in infos}
            if len(infos) > _MAX_DOCX_ENTRIES:
                return False
            if "[Content_Types].xml" not in names or "word/document.xml" not in names:
                return False
            total_expanded = 0
            for info in infos:
                path = PurePosixPath(info.filename)
                if path.is_absolute() or ".." in path.parts or info.flag_bits & 0x1:
                    return False
                total_expanded += info.file_size
                if total_expanded > _MAX_DOCX_EXPANDED_BYTES:
                    return False
                if info.compress_size == 0 and info.file_size > 0:
                    return False
                if info.compress_size > 0 and info.file_size / info.compress_size > _MAX_DOCX_COMPRESSION_RATIO:
                    return False
            content_types = archive.read("[Content_Types].xml")
            document_xml = archive.read("word/document.xml")
            return (
                b"wordprocessingml.document.main+xml" in content_types
                and len(document_xml) > 0
                and len(document_xml) <= 8 * 1024 * 1024
            )
    except (zipfile.BadZipFile, KeyError, OSError, RuntimeError, ValueError):
        return False


def _detect_mime(filename: str, data: bytes) -> str:
    ext = PurePosixPath(filename.replace("\\", "/")).suffix.lower()
    expected = _ALLOWED.get(ext)
    if expected is None:
        raise FileValidationError("UNSUPPORTED_EXTENSION", "Format refusé. Formats autorisés : PDF, JPG, PNG et DOCX.")

    if data.startswith(b"%PDF-") and b"%%EOF" in data[-4096:]:
        detected = "application/pdf"
    elif data.startswith(b"\x89PNG\r\n\x1a\n") and b"IEND" in data[-32:]:
        detected = "image/png"
    elif data.startswith(b"\xff\xd8\xff") and b"\xff\xd9" in data[-4096:]:
        detected = "image/jpeg"
    elif data.startswith(b"PK\x03\x04") and _docx_is_valid(data):
        detected = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        raise FileValidationError("SIGNATURE_MISMATCH", "La signature réelle du fichier ne correspond pas à un format autorisé.")

    if detected != expected:
        raise FileValidationError("EXTENSION_MISMATCH", "L'extension ne correspond pas au contenu réel du fichier.")
    return detected


def validate_upload(filename: str, declared_content_type: str | None, data: bytes) -> tuple[str, str]:
    """Valide la taille, le type réel et le nom; renvoie (MIME détecté, nom sûr)."""
    if not data:
        raise FileValidationError("EMPTY_FILE", "Le fichier est vide.")
    if len(data) > settings.document_upload_max_bytes:
        limit_mib = settings.document_upload_max_bytes / (1024 * 1024)
        label = f"{limit_mib:.1f}".rstrip("0").rstrip(".")
        raise FileValidationError("FILE_TOO_LARGE", f"La taille maximale autorisée est de {label} Mio.")

    safe_name = sanitize_filename(filename)
    detected = _detect_mime(safe_name, data)
    declared = (declared_content_type or "").split(";", 1)[0].strip().lower()
    if declared and declared not in _GENERIC_MIME and declared != detected:
        raise FileValidationError("DECLARED_MIME_MISMATCH", "Le type MIME déclaré ne correspond pas au contenu du fichier.")
    return detected, safe_name
