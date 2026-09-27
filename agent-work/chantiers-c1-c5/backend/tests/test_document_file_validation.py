"""Tests isolés des garde-fous d'upload C7; aucun stockage externe requis."""
from __future__ import annotations

import io
import zipfile

import pytest

from app.core.config import settings
from app.services.documents import clamav
from app.services.documents.file_validation import FileValidationError, sanitize_filename, validate_upload


def _minimal_docx() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            b'<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        )
        archive.writestr("word/document.xml", b'<w:document xmlns:w="urn:word"><w:body/></w:document>')
    return buffer.getvalue()


def test_validate_pdf_signature_and_mime() -> None:
    data = b"%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF"
    mime, filename = validate_upload("permit.pdf", "application/pdf", data)
    assert mime == "application/pdf"
    assert filename == "permit.pdf"


def test_validate_jpeg_and_png_signatures() -> None:
    jpeg = b"\xff\xd8\xff" + b"image" + b"\xff\xd9"
    png = b"\x89PNG\r\n\x1a\n" + b"header" + b"IEND" + b"\x00\x00\x00\x00"
    assert validate_upload("photo.jpg", "image/jpeg", jpeg)[0] == "image/jpeg"
    assert validate_upload("photo.png", "image/png", png)[0] == "image/png"


def test_validate_docx_container() -> None:
    mime, filename = validate_upload(
        "evidence.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _minimal_docx(),
    )
    assert mime.endswith("wordprocessingml.document")
    assert filename == "evidence.docx"


def test_reject_extension_signature_and_declared_mime_mismatches() -> None:
    with pytest.raises(FileValidationError, match="Format refusé") as unsupported:
        validate_upload("permit.exe", "application/pdf", b"%PDF-1.4\n%%EOF")
    assert unsupported.value.code == "UNSUPPORTED_EXTENSION"

    with pytest.raises(FileValidationError) as extension_mismatch:
        validate_upload("permit.jpg", "image/jpeg", b"%PDF-1.4\n%%EOF")
    assert extension_mismatch.value.code == "EXTENSION_MISMATCH"

    with pytest.raises(FileValidationError) as declared_mismatch:
        validate_upload("permit.pdf", "image/jpeg", b"%PDF-1.4\n%%EOF")
    assert declared_mismatch.value.code == "DECLARED_MIME_MISMATCH"


def test_sanitize_filename_discards_client_path() -> None:
    assert sanitize_filename("../../secret/report.pdf") == "report.pdf"
    assert sanitize_filename(r"C:\\users\\person\\file?.pdf") == "file_.pdf"


def test_reject_empty_and_over_limit_upload(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(FileValidationError) as empty:
        validate_upload("empty.pdf", "application/pdf", b"")
    assert empty.value.code == "EMPTY_FILE"

    monkeypatch.setattr(settings, "document_upload_max_bytes", 4)
    with pytest.raises(FileValidationError) as too_large:
        validate_upload("large.pdf", "application/pdf", b"%PDF-1.4\n%%EOF")
    assert too_large.value.code == "FILE_TOO_LARGE"


def test_clamav_fails_closed_without_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "clamav_host", "")
    with pytest.raises(clamav.ScannerUnavailable):
        clamav.scan_bytes(b"safe-looking-bytes")
