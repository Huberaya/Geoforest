"""API tenant-scopée du coffre documentaire C7."""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timezone
from urllib.parse import quote, urlsplit

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.database import get_db
from app.core.security import ensure_operator_user, get_current_active_user
from app.models import Document, DocumentChecklistItem, DocumentLink, DocumentVersion, User, UserRole
from app.schemas.documents import (
    DocumentChecklistCreate,
    DocumentChecklistOut,
    DocumentDownloadLinkOut,
    DocumentListOut,
    DocumentOut,
    DocumentPatch,
    DocumentReviewIn,
    DocumentVersionOut,
)
from app.services.audit.service import model_snapshot, record_audit_event
from app.services.documents import clamav, storage
from app.services.documents.file_validation import FileValidationError
from app.services.documents.metadata import checklist_out, serialize_document, validate_checklist_scope, validate_document_targets
from app.services.documents.upload import cleanup_object, inspect_upload, store_version

router = APIRouter()
_READ_ROLES = {UserRole.admin, UserRole.compliance, UserRole.procurement, UserRole.analyst, UserRole.viewer}
_WRITE_ROLES = {UserRole.admin, UserRole.compliance, UserRole.procurement}
_REVIEW_ROLES = {UserRole.admin, UserRole.compliance, UserRole.procurement}
_CATEGORIES = [
    {"code": "land_rights", "label": "Droits fonciers / usage des terres"},
    {"code": "permit", "label": "Permis et autorisations"},
    {"code": "environment", "label": "Environnement / gestion forestière"},
    {"code": "contract", "label": "Contrat ou accord"},
    {"code": "social", "label": "Éléments sociaux / droits de tiers"},
    {"code": "audit_certification", "label": "Audit / certification / vérification tierce"},
    {"code": "other", "label": "Autre preuve"},
]


def _organization_id(user: User) -> uuid.UUID:
    ensure_operator_user(user)
    if user.role not in _READ_ROLES or user.organization_id is None:
        raise HTTPException(status_code=403, detail="Accès refusé.")
    return user.organization_id


def _require_role(user: User, allowed: set[UserRole]) -> uuid.UUID:
    organization_id = _organization_id(user)
    if user.role not in allowed:
        raise HTTPException(status_code=403, detail="Rôle insuffisant pour cette action.")
    return organization_id


def _parse_date(value: str | None, field_name: str) -> date | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Date invalide : {field_name}.") from None


def _clean_category(value: str) -> str:
    category = re.sub(r"[^a-z0-9_-]", "_", value.strip().lower().replace(" ", "_"))
    category = re.sub(r"_+", "_", category).strip("_")
    if not category or len(category) > 50:
        raise HTTPException(status_code=422, detail="Catégorie invalide.")
    return category


def _country_code(value: str | None) -> str | None:
    value = (value or "").strip().upper()
    if not value:
        return None
    if not re.fullmatch(r"[A-Z]{2}", value):
        raise HTTPException(status_code=422, detail="Le pays doit être un code ISO 3166-1 alpha-2.")
    return value


def _document_query(organization_id: uuid.UUID):
    return (
        select(Document)
        .where(Document.organization_id == organization_id)
        .options(selectinload(Document.versions), selectinload(Document.links))
    )


async def _get_document(
    db: AsyncSession, organization_id: uuid.UUID, document_id: uuid.UUID, *, allow_archived: bool = False
) -> Document:
    stmt = _document_query(organization_id).where(Document.id == document_id)
    if not allow_archived:
        stmt = stmt.where(Document.is_archived.is_(False))
    document = (await db.execute(stmt)).scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document introuvable.")
    return document


def _latest_clean_version(document: Document, version_id: uuid.UUID | None = None) -> DocumentVersion:
    version = next(
        (
            v for v in document.versions
            if v.scan_status == "clean"
            and (v.id == version_id if version_id is not None else v.version_number == document.current_version_number)
        ),
        None,
    )
    if version is None:
        raise HTTPException(status_code=404, detail="Version saine introuvable.")
    return version


def _upload_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FileValidationError):
        status = 413 if exc.code == "FILE_TOO_LARGE" else (415 if exc.code == "UNSUPPORTED_EXTENSION" else 422)
        return HTTPException(status_code=status, detail=f"{exc.code}: {str(exc)}")
    if isinstance(exc, clamav.MalwareDetected):
        return HTTPException(status_code=422, detail="MALWARE_DETECTED: Le fichier est refusé par le contrôle antivirus.")
    if isinstance(exc, clamav.ScannerUnavailable):
        return HTTPException(status_code=503, detail="SCANNER_UNAVAILABLE: Le contrôle antivirus est indisponible; le fichier n'a pas été enregistré.")
    if isinstance(exc, storage.StorageUnavailable):
        return HTTPException(status_code=503, detail="STORAGE_UNAVAILABLE: Le stockage documentaire est indisponible.")
    return HTTPException(status_code=500, detail="L'opération documentaire a échoué.")


@router.get("/documents/categories", summary="Catégories indicatives du coffre documentaire")
async def list_document_categories(
    current_user: User = Depends(get_current_active_user),
) -> dict:
    _organization_id(current_user)
    return {
        "items": _CATEGORIES,
        "note": "Taxonomie indicative et non exhaustive; elle ne définit pas à elle seule les pièces légalement requises.",
    }


@router.get("/documents/checklist", response_model=list[DocumentChecklistOut], summary="Checklist configurée par l'organisation")
async def list_document_checklist(
    scope_type: str | None = Query(default=None, pattern="^(organization|supplier|shipment|product|plot)$"),
    scope_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[DocumentChecklistOut]:
    organization_id = _organization_id(current_user)
    stmt = select(DocumentChecklistItem).where(
        DocumentChecklistItem.organization_id == organization_id,
        DocumentChecklistItem.is_active.is_(True),
    ).order_by(DocumentChecklistItem.created_at.desc())
    if scope_type:
        stmt = stmt.where(DocumentChecklistItem.scope_type == scope_type)
    if scope_id:
        stmt = stmt.where(DocumentChecklistItem.scope_id == scope_id)
    rows = (await db.execute(stmt.limit(300))).scalars().all()
    return [DocumentChecklistOut.model_validate(await checklist_out(db, row)) for row in rows]


@router.post("/documents/checklist", response_model=DocumentChecklistOut, status_code=201, summary="Ajouter un élément de checklist propre au tenant")
async def create_document_checklist_item(
    payload: DocumentChecklistCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DocumentChecklistOut:
    organization_id = _require_role(current_user, _WRITE_ROLES)
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="Le titre de checklist ne peut pas être vide.")
    await validate_checklist_scope(db, organization_id, payload.scope_type, payload.scope_id)
    if payload.source_url:
        parsed = urlsplit(payload.source_url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise HTTPException(status_code=422, detail="La référence de source doit utiliser une URL HTTPS.")
    item = DocumentChecklistItem(
        id=uuid.uuid4(),
        organization_id=organization_id,
        created_by_user_id=current_user.id,
        scope_type=payload.scope_type,
        scope_id=payload.scope_id,
        title=payload.title.strip(),
        category=_clean_category(payload.category),
        country_code=_country_code(payload.country_code),
        commodity_code=payload.commodity_code.strip() if payload.commodity_code else None,
        source_title=payload.source_title.strip() if payload.source_title else None,
        source_url=payload.source_url,
        note=payload.note.strip() if payload.note else None,
        is_active=True,
    )
    db.add(item)
    await db.flush()
    record_audit_event(
        db, request,
        organization_id=organization_id,
        actor_user_id=current_user.id,
        action="document.checklist_item_created",
        object_type="document_checklist_item",
        object_id=item.id,
        new_data={"title": item.title, "category": item.category, "scope_type": item.scope_type, "scope_id": str(item.scope_id) if item.scope_id else None, "source_url": item.source_url},
    )
    await db.commit()
    return DocumentChecklistOut.model_validate(await checklist_out(db, item))


@router.delete("/documents/checklist/{item_id}", status_code=204, summary="Désactiver un élément de checklist")
async def archive_document_checklist_item(
    item_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Response:
    organization_id = _require_role(current_user, _WRITE_ROLES)
    item = (await db.execute(select(DocumentChecklistItem).where(
        DocumentChecklistItem.id == item_id,
        DocumentChecklistItem.organization_id == organization_id,
        DocumentChecklistItem.is_active.is_(True),
    ))).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Élément de checklist introuvable.")
    previous = model_snapshot(item)
    item.is_active = False
    item.updated_at = datetime.now(timezone.utc)
    record_audit_event(
        db, request,
        organization_id=organization_id,
        actor_user_id=current_user.id,
        action="document.checklist_item_deactivated",
        object_type="document_checklist_item",
        object_id=item.id,
        previous_data=previous,
        new_data=model_snapshot(item),
    )
    await db.commit()
    return Response(status_code=204)


@router.get("/documents", response_model=DocumentListOut, summary="Lister les documents du tenant")
async def list_documents(
    q: str | None = Query(default=None, max_length=100),
    category: str | None = Query(default=None, max_length=50),
    scope_type: str | None = Query(default=None, pattern="^(supplier|shipment|product|plot)$"),
    scope_id: uuid.UUID | None = None,
    include_archived: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DocumentListOut:
    organization_id = _organization_id(current_user)
    if bool(scope_type) != bool(scope_id):
        raise HTTPException(status_code=422, detail="scope_type et scope_id doivent être fournis ensemble.")
    filters = [Document.organization_id == organization_id]
    if not include_archived:
        filters.append(Document.is_archived.is_(False))
    if category:
        filters.append(Document.category == _clean_category(category))
    stmt = _document_query(organization_id).where(*filters)
    count_stmt = select(func.count(func.distinct(Document.id))).where(*filters)
    if scope_type and scope_id:
        link_filter = (
            DocumentLink.organization_id == organization_id,
            DocumentLink.target_type == scope_type,
            DocumentLink.target_id == scope_id,
        )
        stmt = stmt.join(DocumentLink, DocumentLink.document_id == Document.id).where(*link_filter)
        count_stmt = count_stmt.join(DocumentLink, DocumentLink.document_id == Document.id).where(*link_filter)
    if q:
        like = f"%{q.strip().lower()}%"
        search_filter = func.lower(Document.title).like(like) | func.lower(Document.reference_number).like(like)
        stmt = stmt.where(search_filter)
        count_stmt = count_stmt.where(search_filter)
    total = (await db.execute(count_stmt)).scalar_one() or 0
    stmt = stmt.order_by(Document.updated_at.desc(), Document.id.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).scalars().unique().all()
    return DocumentListOut(items=[serialize_document(row) for row in rows], total=total, limit=limit, offset=offset)


@router.post("/documents", response_model=DocumentOut, status_code=201, summary="Déposer une nouvelle pièce sécurisée")
async def create_document(
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(..., min_length=1, max_length=200),
    category: str = Form(..., min_length=1, max_length=50),
    description: str | None = Form(default=None, max_length=4000),
    issuer_name: str | None = Form(default=None, max_length=200),
    reference_number: str | None = Form(default=None, max_length=120),
    issued_at: str | None = Form(default=None),
    expires_at: str | None = Form(default=None),
    country_code: str | None = Form(default=None),
    commodity_code: str | None = Form(default=None, max_length=50),
    supplier_id: uuid.UUID | None = Form(default=None),
    shipment_id: uuid.UUID | None = Form(default=None),
    product_id: uuid.UUID | None = Form(default=None),
    plot_id: uuid.UUID | None = Form(default=None),
    supplier_visible: bool = Form(default=False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DocumentOut:
    organization_id = _require_role(current_user, _WRITE_ROLES)
    if not title.strip():
        raise HTTPException(status_code=422, detail="Le titre est obligatoire.")
    issue_date = _parse_date(issued_at, "date d'émission")
    expiry_date = _parse_date(expires_at, "date d'expiration")
    if issue_date and expiry_date and expiry_date < issue_date:
        raise HTTPException(status_code=422, detail="La date d'expiration précède la date d'émission.")
    targets = await validate_document_targets(
        db, organization_id, supplier_id=supplier_id, shipment_id=shipment_id, product_id=product_id, plot_id=plot_id
    )
    if supplier_visible and not any(target_type == "supplier" for target_type, _ in targets):
        raise HTTPException(status_code=422, detail="Le partage au fournisseur exige d'associer un profil fournisseur.")
    try:
        data, mime, filename, sha256, scanner_name = await inspect_upload(file)
    except (FileValidationError, clamav.MalwareDetected, clamav.ScannerUnavailable) as exc:
        raise _upload_http_error(exc) from None

    document_id = uuid.uuid4()
    version_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    storage_key = None
    try:
        storage_key = await store_version(
            organization_id=organization_id,
            document_id=document_id,
            version_id=version_id,
            data=data,
            content_type=mime,
            sha256=sha256,
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
            country_code=_country_code(country_code),
            commodity_code=commodity_code.strip() if commodity_code else None,
            current_version_number=1,
            review_status="to_review",
            supplier_visible=supplier_visible,
            is_archived=False,
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
        for target_type, target_id in targets:
            document.links.append(DocumentLink(
                id=uuid.uuid4(),
                organization_id=organization_id,
                document_id=document_id,
                target_type=target_type,
                target_id=target_id,
                created_by_user_id=current_user.id,
            ))
        db.add(document)
        await db.flush()
        record_audit_event(
            db, request,
            organization_id=organization_id,
            actor_user_id=current_user.id,
            action="document.uploaded",
            object_type="document",
            object_id=document_id,
            new_data={
                "title": document.title,
                "category": document.category,
                "version_id": str(version_id),
                "version_number": 1,
                "file_size_bytes": len(data),
                "content_type": mime,
                "sha256": sha256,
                "expires_at": expiry_date.isoformat() if expiry_date else None,
                "links": [{"type": t, "id": str(i)} for t, i in targets],
            },
        )
        await db.commit()
        return serialize_document(document)
    except Exception as exc:
        await db.rollback()
        await cleanup_object(storage_key)
        if isinstance(exc, storage.StorageUnavailable):
            raise _upload_http_error(exc) from None
        raise


@router.post("/documents/{document_id}/versions", response_model=DocumentOut, status_code=201, summary="Ajouter une version immuable")
async def add_document_version(
    document_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DocumentOut:
    organization_id = _require_role(current_user, _WRITE_ROLES)
    document = await _get_document(db, organization_id, document_id)
    try:
        data, mime, filename, sha256, scanner_name = await inspect_upload(file)
    except (FileValidationError, clamav.MalwareDetected, clamav.ScannerUnavailable) as exc:
        raise _upload_http_error(exc) from None

    version_number = document.current_version_number + 1
    version_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    storage_key = None
    current_version = next(
        (version for version in document.versions if version.version_number == document.current_version_number),
        None,
    )
    previous = {
        "current_version_number": document.current_version_number,
        "current_version_id": str(current_version.id) if current_version else None,
        "current_version_sha256": current_version.sha256 if current_version else None,
        "review_status": document.review_status,
    }
    try:
        storage_key = await store_version(
            organization_id=organization_id,
            document_id=document_id,
            version_id=version_id,
            data=data,
            content_type=mime,
            sha256=sha256,
        )
        version = DocumentVersion(
            id=version_id,
            organization_id=organization_id,
            document_id=document_id,
            uploaded_by_user_id=current_user.id,
            version_number=version_number,
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
        document.current_version_number = version_number
        document.review_status = "to_review"
        document.review_note = None
        document.updated_at = now
        await db.flush()
        record_audit_event(
            db, request,
            organization_id=organization_id,
            actor_user_id=current_user.id,
            action="document.version_added",
            object_type="document",
            object_id=document.id,
            previous_data=previous,
            new_data={"version_id": str(version_id), "version_number": version_number, "file_size_bytes": len(data), "content_type": mime, "sha256": sha256},
        )
        await db.commit()
        return serialize_document(document)
    except Exception as exc:
        await db.rollback()
        await cleanup_object(storage_key)
        if isinstance(exc, storage.StorageUnavailable):
            raise _upload_http_error(exc) from None
        raise


@router.patch("/documents/{document_id}", response_model=DocumentOut, summary="Mettre à jour les métadonnées")
async def update_document(
    document_id: uuid.UUID,
    payload: DocumentPatch,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DocumentOut:
    organization_id = _require_role(current_user, _WRITE_ROLES)
    document = await _get_document(db, organization_id, document_id)
    previous = model_snapshot(document)
    values = payload.model_dump(exclude_unset=True)
    for required_field in ("title", "category", "supplier_visible"):
        if required_field in values and values[required_field] is None:
            raise HTTPException(status_code=422, detail=f"Le champ {required_field} ne peut pas être nul.")
    if "title" in values:
        values["title"] = values["title"].strip()
        if not values["title"]:
            raise HTTPException(status_code=422, detail="Le titre ne peut pas être vide.")
    if "category" in values:
        values["category"] = _clean_category(values["category"])
    if "country_code" in values:
        values["country_code"] = _country_code(values["country_code"])
    if values.get("supplier_visible") is True and not any(link.target_type == "supplier" for link in document.links):
        raise HTTPException(status_code=422, detail="Le partage au fournisseur exige d'associer un profil fournisseur.")
    for key, value in values.items():
        setattr(document, key, value.strip() if isinstance(value, str) and key not in {"country_code", "category"} else value)
    if document.issued_at and document.expires_at and document.expires_at < document.issued_at:
        raise HTTPException(status_code=422, detail="La date d'expiration précède la date d'émission.")
    document.updated_at = datetime.now(timezone.utc)
    record_audit_event(
        db, request,
        organization_id=organization_id,
        actor_user_id=current_user.id,
        action="document.metadata_updated",
        object_type="document",
        object_id=document.id,
        previous_data=previous,
        new_data=model_snapshot(document),
    )
    await db.commit()
    return serialize_document(document)


@router.post("/documents/{document_id}/review", response_model=DocumentOut, summary="Tracer une revue documentaire humaine")
async def review_document(
    document_id: uuid.UUID,
    payload: DocumentReviewIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DocumentOut:
    organization_id = _require_role(current_user, _REVIEW_ROLES)
    document = await _get_document(db, organization_id, document_id)
    previous = {"review_status": document.review_status, "review_note": document.review_note}
    document.review_status = payload.review_status
    document.review_note = payload.review_note.strip() if payload.review_note else None
    document.updated_at = datetime.now(timezone.utc)
    record_audit_event(
        db, request,
        organization_id=organization_id,
        actor_user_id=current_user.id,
        action="document.review_recorded",
        object_type="document",
        object_id=document.id,
        previous_data=previous,
        new_data={"review_status": document.review_status, "review_note": document.review_note},
    )
    await db.commit()
    return serialize_document(document)


@router.post("/documents/{document_id}/archive", response_model=DocumentOut, summary="Archiver sans supprimer les versions")
async def archive_document(
    document_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DocumentOut:
    organization_id = _require_role(current_user, _WRITE_ROLES)
    document = await _get_document(db, organization_id, document_id, allow_archived=True)
    if not document.is_archived:
        previous = model_snapshot(document)
        document.is_archived = True
        document.updated_at = datetime.now(timezone.utc)
        record_audit_event(
            db, request,
            organization_id=organization_id,
            actor_user_id=current_user.id,
            action="document.archived",
            object_type="document",
            object_id=document.id,
            previous_data=previous,
            new_data=model_snapshot(document),
        )
        await db.commit()
    return serialize_document(document)


@router.get("/documents/{document_id}/history", response_model=list[DocumentVersionOut], summary="Historique immuable des versions")
async def document_history(
    document_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> list[DocumentVersionOut]:
    organization_id = _organization_id(current_user)
    document = await _get_document(db, organization_id, document_id, allow_archived=True)
    return [DocumentVersionOut.model_validate(v) for v in sorted(document.versions, key=lambda row: row.version_number, reverse=True)]


@router.post("/documents/{document_id}/download-url", response_model=DocumentDownloadLinkOut, summary="Créer un lien de téléchargement temporaire")
async def create_document_download_url(
    document_id: uuid.UUID,
    request: Request,
    version_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DocumentDownloadLinkOut:
    organization_id = _organization_id(current_user)
    document = await _get_document(db, organization_id, document_id)
    version = _latest_clean_version(document, version_id)
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
        url = f"{settings.api_v1_prefix}/documents/{document.id}/content?version_id={version.id}"
    record_audit_event(
        db, request,
        organization_id=organization_id,
        actor_user_id=current_user.id,
        action="document.download_link_issued",
        object_type="document",
        object_id=document.id,
        new_data={"version_id": str(version.id), "presigned": presigned, "expires_in": 300 if presigned else None},
    )
    await db.commit()
    return DocumentDownloadLinkOut(url=url, presigned=presigned, expires_in=300 if presigned else None)


@router.get("/documents/{document_id}/content", include_in_schema=False)
async def download_document_content(
    document_id: uuid.UUID,
    request: Request,
    version_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> Response:
    organization_id = _organization_id(current_user)
    document = await _get_document(db, organization_id, document_id)
    version = _latest_clean_version(document, version_id)
    try:
        data = await run_in_threadpool(storage.get_bytes, version.storage_key)
    except storage.StorageUnavailable as exc:
        raise _upload_http_error(exc) from None
    record_audit_event(
        db, request,
        organization_id=organization_id,
        actor_user_id=current_user.id,
        action="document.downloaded",
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


@router.post("/documents/{document_id}/links", response_model=DocumentOut, summary="Rattacher une pièce à une autre ressource du même tenant")
async def add_document_link(
    document_id: uuid.UUID,
    request: Request,
    supplier_id: uuid.UUID | None = Form(default=None),
    shipment_id: uuid.UUID | None = Form(default=None),
    product_id: uuid.UUID | None = Form(default=None),
    plot_id: uuid.UUID | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> DocumentOut:
    organization_id = _require_role(current_user, _WRITE_ROLES)
    document = await _get_document(db, organization_id, document_id)
    targets = await validate_document_targets(
        db, organization_id, supplier_id=supplier_id, shipment_id=shipment_id, product_id=product_id, plot_id=plot_id
    )
    if not targets:
        raise HTTPException(status_code=422, detail="Sélectionnez au moins une ressource.")
    existing = {(link.target_type, link.target_id) for link in document.links}
    added = []
    for target_type, target_id in targets:
        if (target_type, target_id) not in existing:
            link = DocumentLink(
                id=uuid.uuid4(), organization_id=organization_id, document_id=document.id,
                target_type=target_type, target_id=target_id, created_by_user_id=current_user.id,
            )
            document.links.append(link)
            added.append({"type": target_type, "id": str(target_id)})
    if added:
        record_audit_event(
            db, request,
            organization_id=organization_id,
            actor_user_id=current_user.id,
            action="document.linked",
            object_type="document",
            object_id=document.id,
            new_data={"links_added": added},
        )
        await db.commit()
    return serialize_document(document)
