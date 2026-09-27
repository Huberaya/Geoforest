"""Routes documentaires du portail fournisseur, restreintes au fournisseur lié au compte."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_active_user
from app.models import Document, DocumentLink, DocumentVersion, User, UserRole
from app.models.suppliers import Supplier, SupplierStatus
from app.schemas.documents import DocumentDownloadLinkOut, DocumentListOut, DocumentOut
from app.services.audit.service import record_audit_event
from app.services.documents import clamav, storage
from app.services.documents.file_validation import FileValidationError
from app.services.documents.metadata import serialize_document
from app.services.documents.upload import cleanup_object, inspect_upload, store_version
from app.api.v1.endpoints.documents import _clean_category, _country_code, _parse_date, _upload_http_error

router = APIRouter()


async def _supplier_context(db: AsyncSession, user: User) -> Supplier:
    if user.role != UserRole.supplier or user.organization_id is None or user.supplier_id is None:
        raise HTTPException(status_code=403, detail="Accès réservé au portail du fournisseur associé au compte.")
    supplier = (await db.execute(select(Supplier).where(
        Supplier.id == user.supplier_id,
        Supplier.organization_id == user.organization_id,
        Supplier.portal_enabled.is_(True),
        Supplier.status.notin_((SupplierStatus.suspended, SupplierStatus.archived)),
    ))).scalar_one_or_none()
    if supplier is None:
        raise HTTPException(status_code=403, detail="Accès au portail fournisseur désactivé.")
    return supplier


async def _supplier_document(
    db: AsyncSession, supplier: Supplier, user: User, document_id: uuid.UUID
) -> Document:
    stmt = (
        select(Document)
        .join(DocumentLink, DocumentLink.document_id == Document.id)
        .where(
            Document.id == document_id,
            Document.organization_id == supplier.organization_id,
            Document.is_archived.is_(False),
            DocumentLink.organization_id == supplier.organization_id,
            DocumentLink.target_type == "supplier",
            DocumentLink.target_id == supplier.id,
            (Document.supplier_visible.is_(True) | (Document.created_by_user_id == user.id)),
        )
        .options(selectinload(Document.versions), selectinload(Document.links))
    )
    document = (await db.execute(stmt)).unique().scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document introuvable.")
    return document


def _clean_version(document: Document, version_id: uuid.UUID | None = None) -> DocumentVersion:
    version = next((
        v for v in document.versions
        if v.scan_status == "clean"
        and (v.id == version_id if version_id is not None else v.version_number == document.current_version_number)
    ), None)
    if version is None:
        raise HTTPException(status_code=404, detail="Version saine introuvable.")
    return version


def _serialize_supplier_document(document: Document, user: User) -> DocumentOut:
    """Redact private operator notes and never disclose cross-resource link metadata."""
    payload = serialize_document(document).model_dump()
    payload["description"] = document.description if document.created_by_user_id == user.id else None
    payload["review_note"] = None
    payload["links"] = [link for link in payload["links"] if link["target_type"] == "supplier"]
    return DocumentOut.model_validate(payload)


@router.get("", response_model=DocumentListOut, summary="Lister les pièces propres à mon fournisseur")
async def list_supplier_documents(
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DocumentListOut:
    supplier = await _supplier_context(db, current_user)
    where = (
        Document.organization_id == supplier.organization_id,
        DocumentLink.organization_id == supplier.organization_id,
        DocumentLink.target_type == "supplier",
        DocumentLink.target_id == supplier.id,
        Document.is_archived.is_(False),
        (Document.supplier_visible.is_(True) | (Document.created_by_user_id == current_user.id)),
    )
    stmt = (
        select(Document)
        .join(DocumentLink, DocumentLink.document_id == Document.id)
        .where(*where)
        .options(selectinload(Document.versions), selectinload(Document.links))
        .order_by(Document.updated_at.desc())
        .limit(min(max(limit, 1), 100))
        .offset(max(offset, 0))
    )
    rows = (await db.execute(stmt)).scalars().unique().all()
    total = (await db.execute(
        select(func.count(func.distinct(Document.id)))
        .join(DocumentLink, DocumentLink.document_id == Document.id)
        .where(*where)
    )).scalar_one()
    return DocumentListOut(
        items=[_serialize_supplier_document(doc, current_user) for doc in rows],
        total=total,
        limit=min(max(limit, 1), 100),
        offset=max(offset, 0),
    )


@router.post("", response_model=DocumentOut, status_code=201, summary="Déposer une pièce pour mon fournisseur")
async def create_supplier_document(
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(..., min_length=1, max_length=200),
    category: str = Form(..., min_length=1, max_length=50),
    description: str | None = Form(default=None, max_length=4000),
    issuer_name: str | None = Form(default=None, max_length=200),
    reference_number: str | None = Form(default=None, max_length=120),
    issued_at: str | None = Form(default=None),
    expires_at: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DocumentOut:
    supplier = await _supplier_context(db, current_user)
    if not title.strip():
        raise HTTPException(status_code=422, detail="Le titre est obligatoire.")
    issue_date = _parse_date(issued_at, "date d'émission")
    expiry_date = _parse_date(expires_at, "date d'expiration")
    if issue_date and expiry_date and expiry_date < issue_date:
        raise HTTPException(status_code=422, detail="La date d'expiration précède la date d'émission.")
    try:
        data, mime, filename, sha256, scanner_name = await inspect_upload(file)
    except (FileValidationError, clamav.MalwareDetected, clamav.ScannerUnavailable) as exc:
        raise _upload_http_error(exc) from None

    organization_id = supplier.organization_id
    document_id, version_id = uuid.uuid4(), uuid.uuid4()
    now = datetime.now(timezone.utc)
    storage_key = None
    try:
        storage_key = await store_version(
            organization_id=organization_id, document_id=document_id, version_id=version_id,
            data=data, content_type=mime, sha256=sha256,
        )
        document = Document(
            id=document_id,
            organization_id=organization_id,
            created_by_user_id=current_user.id,
            title=title.strip(),
            category=_clean_category(category),
            description=description.strip() if description else None,
            issuer_name=issuer_name.strip() if issuer_name else None,
            reference_number=reference_number.strip() if reference_number else None,
            issued_at=issue_date,
            expires_at=expiry_date,
            country_code=_country_code(supplier.country),
            current_version_number=1,
            review_status="to_review",
            supplier_visible=True,
            links=[],
            created_at=now,
            updated_at=now,
        )
        version = DocumentVersion(
            id=version_id,
            organization_id=organization_id,
            document_id=document_id,
            uploaded_by_user_id=current_user.id,
            version_number=1,
            storage_key=storage_key,
            original_filename=filename,
            content_type=mime,
            file_size_bytes=len(data),
            sha256=sha256,
            scan_status="clean",
            scanner_name=scanner_name,
            scanned_at=now,
            created_at=now,
        )
        document.versions.append(version)
        document.links.append(DocumentLink(
            id=uuid.uuid4(),
            organization_id=organization_id,
            document_id=document_id,
            target_type="supplier",
            target_id=supplier.id,
            created_by_user_id=current_user.id,
        ))
        db.add(document)
        await db.flush()
        record_audit_event(
            db, request,
            organization_id=organization_id,
            actor_user_id=current_user.id,
            action="document.uploaded_by_supplier",
            object_type="document",
            object_id=document_id,
            new_data={
                "title": document.title,
                "category": document.category,
                "supplier_id": str(supplier.id),
                "version_id": str(version_id),
                "version_number": 1,
                "file_size_bytes": len(data),
                "content_type": mime,
                "sha256": sha256,
                "expires_at": expiry_date.isoformat() if expiry_date else None,
            },
        )
        await db.commit()
        return _serialize_supplier_document(document, current_user)
    except Exception as exc:
        await db.rollback()
        await cleanup_object(storage_key)
        if isinstance(exc, storage.StorageUnavailable):
            raise _upload_http_error(exc) from None
        raise


@router.post("/{document_id}/versions", response_model=DocumentOut, status_code=201, summary="Ajouter une version à ma propre pièce")
async def add_supplier_document_version(
    document_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DocumentOut:
    supplier = await _supplier_context(db, current_user)
    document = await _supplier_document(db, supplier, current_user, document_id)
    if document.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Vous ne pouvez ajouter une version qu'à un document déposé par votre compte.")
    try:
        data, mime, filename, sha256, scanner_name = await inspect_upload(file)
    except (FileValidationError, clamav.MalwareDetected, clamav.ScannerUnavailable) as exc:
        raise _upload_http_error(exc) from None
    version_number = document.current_version_number + 1
    version_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    storage_key = None
    current_version = next((v for v in document.versions if v.version_number == document.current_version_number), None)
    previous = {
        "current_version_number": document.current_version_number,
        "current_version_id": str(current_version.id) if current_version else None,
        "current_version_sha256": current_version.sha256 if current_version else None,
        "review_status": document.review_status,
    }
    try:
        storage_key = await store_version(
            organization_id=supplier.organization_id, document_id=document.id, version_id=version_id,
            data=data, content_type=mime, sha256=sha256,
        )
        version = DocumentVersion(
            id=version_id, organization_id=supplier.organization_id, document_id=document.id,
            uploaded_by_user_id=current_user.id, version_number=version_number, storage_key=storage_key,
            original_filename=filename, content_type=mime, file_size_bytes=len(data), sha256=sha256,
            scan_status="clean", scanner_name=scanner_name, scanned_at=now, created_at=now,
        )
        document.versions.append(version)
        document.current_version_number = version_number
        document.review_status = "to_review"
        document.review_note = None
        document.updated_at = now
        await db.flush()
        record_audit_event(
            db, request, organization_id=supplier.organization_id, actor_user_id=current_user.id,
            action="document.version_added_by_supplier", object_type="document", object_id=document.id,
            previous_data=previous,
            new_data={"version_id": str(version_id), "version_number": version_number, "file_size_bytes": len(data), "content_type": mime, "sha256": sha256},
        )
        await db.commit()
        return _serialize_supplier_document(document, current_user)
    except Exception as exc:
        await db.rollback()
        await cleanup_object(storage_key)
        if isinstance(exc, storage.StorageUnavailable):
            raise _upload_http_error(exc) from None
        raise


@router.post("/{document_id}/download-url", response_model=DocumentDownloadLinkOut, summary="Créer un lien temporaire pour une pièce visible au fournisseur")
async def supplier_document_download_url(
    document_id: uuid.UUID,
    request: Request,
    version_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DocumentDownloadLinkOut:
    supplier = await _supplier_context(db, current_user)
    document = await _supplier_document(db, supplier, current_user, document_id)
    version = _clean_version(document, version_id)
    try:
        url = await run_in_threadpool(
            storage.presigned_get_url,
            version.storage_key,
            expires_in=300,
            filename=version.original_filename,
            content_type=version.content_type,
        )
    except storage.StorageUnavailable as exc:
        raise _upload_http_error(exc) from None
    presigned = bool(url)
    if not url:
        url = f"{settings.api_v1_prefix}/supplier-portal/documents/{document.id}/content?version_id={version.id}"
    record_audit_event(
        db, request,
        organization_id=supplier.organization_id,
        actor_user_id=current_user.id,
        action="document.download_link_issued",
        object_type="document",
        object_id=document.id,
        new_data={"version_id": str(version.id), "presigned": presigned, "expires_in": 300 if presigned else None},
    )
    await db.commit()
    return DocumentDownloadLinkOut(url=url, presigned=presigned, expires_in=300 if presigned else None)


@router.get("/{document_id}/content", include_in_schema=False)
async def supplier_document_content(
    document_id: uuid.UUID,
    request: Request,
    version_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Response:
    supplier = await _supplier_context(db, current_user)
    document = await _supplier_document(db, supplier, current_user, document_id)
    version = _clean_version(document, version_id)
    try:
        data = await run_in_threadpool(storage.get_bytes, version.storage_key)
    except storage.StorageUnavailable as exc:
        raise _upload_http_error(exc) from None
    record_audit_event(
        db, request,
        organization_id=supplier.organization_id,
        actor_user_id=current_user.id,
        action="document.downloaded_by_supplier",
        object_type="document",
        object_id=document.id,
        new_data={"version_id": str(version.id), "sha256": version.sha256},
    )
    await db.commit()
    filename = quote(version.original_filename, safe="")
    return Response(
        content=data,
        media_type=version.content_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
