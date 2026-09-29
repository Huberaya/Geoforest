import hashlib
import json
import os
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from typing import Literal
from uuid import UUID

from app.config import settings
from app.database import transaction
from app.documents import processing
from app.documents.storage import Blob, StorageError
from app.events import event
from app.portal.security import require_supplier
from app.schemas import StrictModel
from app.security import authorize, require_identity
from app.supply.schemas import READERS, WRITERS
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import Field, model_validator
from sqlalchemy import text
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

REVIEWERS = {"Admin", "Compliance Manager"}
router = APIRouter(prefix="/api/v1/organizations/{org}/documents")
portal = APIRouter(prefix="/api/portal/documents")


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


@dataclass
class Access:
    org: UUID
    actor: object
    request: Request
    supplier_id: UUID | None = None

    @contextmanager
    def connection(self, write=False, review=False, snapshot=False):
        actor = (
            require_supplier(self.request)
            if self.supplier_id
            else require_identity(self.request)
        )
        if self.supplier_id and (
            actor.organization_id != self.org or actor.supplier_id != self.supplier_id
        ):
            raise HTTPException(401, "Session modifiée")
        with transaction(
            None if self.supplier_id else actor.id,
            self.org,
            actor.token_hash if self.supplier_id else None,
            isolation_level="REPEATABLE READ" if snapshot else None,
        ) as conn:
            if self.supplier_id:
                if review:
                    raise HTTPException(403, "Revue réservée à la conformité")
            else:
                authorize(
                    conn,
                    self.org,
                    actor,
                    REVIEWERS if review else WRITERS if write else READERS,
                )
            self.actor = actor
            yield conn

    def audit(self, conn, action, identifier, after):
        if not self.supplier_id:
            event(
                conn, self.org, self.actor, action, "document", identifier, None, after
            )
        else:
            conn.execute(
                text(
                    "INSERT INTO audit_events(organization_id,actor_kind,supplier_actor_id,action,object_type,object_id,new_value,source) VALUES(:o,'supplier',:s,:a,'document',:id,CAST(:v AS jsonb),'supplier_portal')"
                ),
                {
                    "o": self.org,
                    "s": self.supplier_id,
                    "a": action,
                    "id": identifier,
                    "v": json.dumps(after, default=str),
                },
            )


def staff_access(org: UUID, request: Request, identity=Depends(require_identity)):
    return Access(org, identity, request)


def portal_access(request: Request, session=Depends(require_supplier)):
    return Access(session.organization_id, session, request, session.supplier_id)


class Upload(StrictModel):
    request_id: UUID
    expected_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    supplier_id: UUID | None = None
    document_id: UUID | None = None
    plot_id: UUID | None = None
    plot_revision: int | None = Field(default=None, ge=1, strict=True)
    lot_id: UUID | None = None
    title: str = Field(min_length=3, max_length=160)
    original_name: str = Field(min_length=1, max_length=200)
    kind: Literal[
        "LAND_RIGHTS",
        "ENVIRONMENT",
        "FORESTRY",
        "RIGHTS",
        "TAX_TRADE",
        "CERTIFICATE",
        "OTHER",
    ] = "OTHER"
    issuer: str = Field(default="", max_length=200)
    valid_from: date | None = None
    valid_until: date | None = None
    claimed_mime: Literal["application/pdf", "image/jpeg", "image/png"]
    size: int = Field(ge=1, le=20 * 1024**2, strict=True)

    @model_validator(mode="after")
    def coherent(self):
        if (self.plot_id is None) != (self.plot_revision is None):
            raise ValueError("Parcelle et révision requises ensemble")
        if self.valid_from and self.valid_until and self.valid_until < self.valid_from:
            raise ValueError("Dates incohérentes")
        if any(ord(c) < 32 for c in self.original_name):
            raise ValueError("Nom invalide")
        return self


class Review(StrictModel):
    decision: Literal["ACCEPTED", "REJECTED", "NEEDS_INFORMATION"]
    note: str = Field(min_length=10, max_length=4000)


def record(conn, access, version, lock=False):
    r = (
        conn.execute(
            text(
                "SELECT *,expires_at>now() AS upload_active FROM document_versions WHERE organization_id=:o AND id=:v"
                + (" FOR UPDATE" if lock else "")
            ),
            {"o": access.org, "v": version},
        )
        .mappings()
        .first()
    )
    if not r or (access.supplier_id and r["supplier_id"] != access.supplier_id):
        raise HTTPException(404, "Version introuvable")
    return dict(r)


def dto(r):
    return {
        k: v
        for k, v in r.items()
        if k
        not in {
            "object_id",
            "input_sha256",
            "actor_id",
            "storage_backend",
            "storage_version",
        }
    } | {
        "processing_mode": "background"
        if r.get("storage_backend") == "s3"
        else "inline"
    }


def begin_upload(body, access):
    processing.configured()
    processing.capacity(body.size * 2)
    sid = access.supplier_id or body.supplier_id
    if not sid or (access.supplier_id and body.supplier_id not in (None, sid)):
        raise HTTPException(404, "Fournisseur introuvable")
    payload = body.model_dump(mode="json")
    hash_ = digest(payload)
    with access.connection(write=True) as conn:
        conn.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:k,0))"),
            {"k": f"document-quota:{access.org}"},
        )
        old = (
            conn.execute(
                text(
                    "SELECT * FROM document_versions WHERE organization_id=:o AND request_id=:r"
                ),
                {"o": access.org, "r": body.request_id},
            )
            .mappings()
            .first()
        )
        if old:
            if old["input_sha256"] != hash_:
                raise HTTPException(409, "Identifiant de requête déjà utilisé")
            return dto(dict(old))
        if (
            not access.supplier_id
            and not conn.execute(
                text(
                    "SELECT id FROM suppliers WHERE organization_id=:o AND id=:s AND archived_at IS NULL"
                ),
                {"o": access.org, "s": sid},
            ).first()
        ):
            raise HTTPException(404, "Fournisseur introuvable")
        if (
            access.supplier_id
            and not body.document_id
            and (body.plot_id or body.lot_id)
        ):
            raise HTTPException(
                422, "Le rattachement aux parcelles et lots est réservé à votre client"
            )
        for table, key, val in [
            ("plots", "id", body.plot_id),
            ("lots", "id", body.lot_id),
        ]:
            if (
                val
                and not access.supplier_id
                and not conn.execute(
                    text(
                        f"SELECT id FROM {table} WHERE organization_id=:o AND supplier_id=:s AND {key}=:v AND archived_at IS NULL"
                    ),
                    {"o": access.org, "s": sid, "v": val},
                ).first()
            ):
                raise HTTPException(404, "Rattachement introuvable")
        if (
            body.plot_id
            and not access.supplier_id
            and not conn.execute(
                text(
                    "SELECT revision FROM plot_geolocations WHERE organization_id=:o AND supplier_id=:s AND plot_id=:p AND revision=:r"
                ),
                {"o": access.org, "s": sid, "p": body.plot_id, "r": body.plot_revision},
            ).first()
        ):
            raise HTTPException(404, "Révision introuvable")
        quota = (
            conn.execute(
                text("SELECT * FROM authz.document_quota(:o,:s)"),
                {"o": access.org, "s": sid},
            )
            .mappings()
            .one()
        )
        if (
            quota["bytes"] + body.size > settings().document_quota_bytes
            or quota["count"] >= 2000
        ):
            raise HTTPException(
                409,
                "Quota documentaire atteint ; contactez l’administrateur du stockage",
            )
        doc = body.document_id
        if doc:
            existing = (
                conn.execute(
                    text(
                        "SELECT * FROM documents WHERE organization_id=:o AND supplier_id=:s AND id=:d"
                    ),
                    {"o": access.org, "s": sid, "d": doc},
                )
                .mappings()
                .first()
            )
            if not existing:
                raise HTTPException(404, "Document introuvable")
            if (body.plot_id, body.plot_revision, body.lot_id) != (
                existing["plot_id"],
                existing["plot_revision"],
                existing["lot_id"],
            ):
                raise HTTPException(409, "Les rattachements du document sont immuables")
        else:
            doc = conn.execute(
                text(
                    "INSERT INTO documents(organization_id,supplier_id,plot_id,plot_revision,lot_id) VALUES(:o,:s,:p,:r,:l) RETURNING id"
                ),
                {
                    "o": access.org,
                    "s": sid,
                    "p": body.plot_id,
                    "r": body.plot_revision,
                    "l": body.lot_id,
                },
            ).scalar_one()
        version = conn.execute(
            text(
                "SELECT COALESCE(max(version),0)+1 FROM document_versions WHERE organization_id=:o AND document_id=:d"
            ),
            {"o": access.org, "d": doc},
        ).scalar_one()
        is_s3 = settings().document_storage_backend == "s3"
        if is_s3:
            processing.require_s3_schema(conn)
            try:
                processing.store().check_security()
            except StorageError:
                raise HTTPException(503, "Stockage privé indisponible") from None
        storage_column = ",storage_backend" if is_s3 else ""
        storage_value = ",:backend" if is_s3 else ""
        r = (
            conn.execute(
                text(
                    f"INSERT INTO document_versions(organization_id,supplier_id,document_id,version,request_id,input_sha256,metadata,expected_size,actor_id,actor_kind{storage_column}) VALUES(:o,:s,:d,:v,:r,:h,CAST(:m AS jsonb),:n,:a,:k{storage_value}) RETURNING *"
                ),
                {
                    "o": access.org,
                    "s": sid,
                    "d": doc,
                    "v": version,
                    "r": body.request_id,
                    "h": hash_,
                    "m": json.dumps(payload),
                    "n": body.size,
                    "a": None if access.supplier_id else access.actor.id,
                    "k": "supplier" if access.supplier_id else "user",
                    "backend": "s3",
                },
            )
            .mappings()
            .one()
        )
        access.audit(
            conn,
            "document.upload_reserved",
            r["id"],
            {"size": body.size, "document_id": doc, "version": version},
        )
        return dto(dict(r))


def put_chunk(access, version, offset, data):
    processing.configured()
    processing.capacity(len(data))
    if not 1 <= len(data) <= 65536:
        raise HTTPException(413, "Bloc attendu : 1 à 65536 octets")
    with access.connection(write=True) as conn:
        r = record(conn, access, version, True)
        if r["state"] != "UPLOADING" or not r["upload_active"]:
            raise HTTPException(409, "Dépôt fermé ou expiré")
        if offset > r["received_size"] or offset + len(data) > r["expected_size"]:
            raise HTTPException(409, "Position ou taille incohérente")
        if r.get("storage_backend", "local") == "s3":
            processing.require_s3_schema(conn)
            try:
                processing.store_for(r).put_chunk(
                    access.org, version, offset, data, r["expected_size"]
                )
            except StorageError as exc:
                code = str(exc)
                if code in {
                    "INVALID_CHUNK_SIZE",
                    "INVALID_CHUNK_OFFSET",
                    "S3_IMMUTABLE_CONFLICT",
                }:
                    raise HTTPException(
                        409,
                        "Bloc incohérent : reprise par blocs de 64000 octets attendue",
                    ) from None
                raise HTTPException(
                    503, "Stockage privé indisponible ; le même bloc peut être réessayé"
                ) from None
            received = max(r["received_size"], offset + len(data))
            conn.execute(
                text(
                    "UPDATE document_versions SET received_size=:n WHERE organization_id=:o AND id=:v"
                ),
                {"n": received, "o": access.org, "v": version},
            )
            return {"received_size": received}
        if settings().document_storage_backend != "local":
            raise HTTPException(
                409,
                "Dépôt historique local : créez une nouvelle version sur ce serveur",
            )
        folder = processing.store()._tenant_fd(access.org, create=True)
        try:
            fd = os.open(
                "u-" + version.hex,
                os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,
                0o600,
                dir_fd=folder,
            )
            with os.fdopen(fd, "r+b") as f:
                size = os.fstat(f.fileno()).st_size
                if size < r["received_size"]:
                    raise HTTPException(
                        409, "Dépôt incomplet sur disque ; recommencez une version"
                    )
                f.truncate(r["received_size"])
                f.seek(offset)
                if offset < r["received_size"]:
                    if (
                        offset + len(data) > r["received_size"]
                        or f.read(len(data)) != data
                    ):
                        raise HTTPException(409, "Bloc de reprise différent")
                    return {"received_size": r["received_size"]}
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            conn.execute(
                text(
                    "UPDATE document_versions SET received_size=:n WHERE organization_id=:o AND id=:v"
                ),
                {"n": offset + len(data), "o": access.org, "v": version},
            )
            return {"received_size": offset + len(data)}
        finally:
            os.close(folder)


def finish(access, version):
    processing.configured()
    with access.connection(write=True) as conn:
        r = record(conn, access, version, True)
        if r.get("storage_backend", "local") == "s3":
            processing.require_s3_schema(conn)
            if r["state"] in ("SCAN_PASSED", "SCAN_REJECTED", "FORMAT_REJECTED"):
                return dto(r)
            if r["attempts"] >= 3 and r["state"] == "SCAN_UNAVAILABLE":
                raise HTTPException(
                    409, "Trois tentatives atteintes ; créez une nouvelle version"
                )
            if r["state"] == "UPLOADING" and (
                not r["upload_active"] or r["received_size"] != r["expected_size"]
            ):
                raise HTTPException(409, "Dépôt incomplet ou expiré")
            conn.execute(
                text("SELECT authz.document_enqueue(:o,:v)"),
                {"o": access.org, "v": version},
            )
            return dto(record(conn, access, version))
        if settings().document_storage_backend != "local":
            raise HTTPException(
                409,
                "Dépôt historique local : créez une nouvelle version sur ce serveur",
            )
    return finish_local(access, version)


def finish_local(access, version):
    with processing.scan_slot():
        with access.connection(write=True) as conn:
            r = record(conn, access, version, True)
            if r["state"] in ("SCAN_PASSED", "SCAN_REJECTED", "FORMAT_REJECTED"):
                return dto(r)
            if r["received_size"] != r["expected_size"] or (
                r["state"] == "UPLOADING" and not r["upload_active"]
            ):
                raise HTTPException(409, "Dépôt incomplet ou expiré")
            if r["attempts"] >= 3:
                raise HTTPException(
                    409, "Trois tentatives atteintes ; créez une nouvelle version"
                )
            conn.execute(
                text(
                    "UPDATE document_versions SET state='SCANNING',attempts=attempts+1 WHERE organization_id=:o AND id=:v"
                ),
                {"o": access.org, "v": version},
            )
        try:
            if r["object_id"]:
                blob = Blob(access.org, r["object_id"], r["expected_size"], r["sha256"])
            else:
                processing.capacity(r["expected_size"])
                folder = processing.store()._tenant_fd(access.org)
                try:
                    fd = os.open(
                        "u-" + version.hex, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=folder
                    )
                finally:
                    os.close(folder)
                with os.fdopen(fd, "rb") as f:
                    blob = processing.store().put_quarantined(
                        access.org,
                        iter(lambda: f.read(65536), b""),
                        declared_size=r["expected_size"],
                    )
                with access.connection(write=True) as conn:
                    conn.execute(
                        text(
                            "UPDATE document_versions SET object_id=:b,sha256=:h WHERE organization_id=:o AND id=:v"
                        ),
                        {
                            "o": access.org,
                            "v": version,
                            "b": blob.object_id,
                            "h": blob.sha256,
                        },
                    )
            if blob.sha256 != r["metadata"]["expected_sha256"]:
                result = {
                    "status": "SCAN_UNAVAILABLE",
                    "reason": "UPLOAD_INTEGRITY_FAILED",
                }
                state = "FORMAT_REJECTED"
            else:
                result = processing.scan(blob)
                state = result["status"]
            mime = None
            if state == "SCAN_PASSED":
                form = processing.validate_format(blob, r["metadata"]["claimed_mime"])
                if not form:
                    state = "FORMAT_REJECTED"
                    result["format_reason"] = "UNSUPPORTED_OR_INVALID_FORMAT"
                else:
                    mime = form["mime"]
                    result["format"] = form
        except (OSError, StorageError):
            state = "SCAN_UNAVAILABLE"
            result = {"status": state, "reason": "STORAGE_UNAVAILABLE"}
            mime = None
        with access.connection(write=True) as conn:
            conn.execute(
                text(
                    "UPDATE document_versions SET state=:s,scan_result=CAST(:r AS jsonb),mime=:m WHERE organization_id=:o AND id=:v"
                ),
                {
                    "o": access.org,
                    "v": version,
                    "s": state,
                    "r": json.dumps(result),
                    "m": mime,
                },
            )
            access.audit(
                conn,
                "document.scan_finished",
                version,
                {"state": state, "scan": result},
            )
            response = dto(record(conn, access, version))
        if r["object_id"] or state in (
            "SCAN_PASSED",
            "SCAN_REJECTED",
            "FORMAT_REJECTED",
        ):
            folder = processing.store()._tenant_fd(access.org)
            try:
                try:
                    os.unlink("u-" + version.hex, dir_fd=folder)
                except FileNotFoundError:
                    pass
            finally:
                os.close(folder)
        return response


def listing(access, supplier_id=None, page=1):
    with access.connection() as conn:
        sid = access.supplier_id or supplier_id
        rows = (
            conn.execute(
                text("""SELECT v.*,d.plot_id,d.plot_revision,d.lot_id,
          (SELECT jsonb_build_object('decision',r.decision,'note',r.note,'actor_id',r.actor_id,'created_at',r.created_at) FROM document_reviews r WHERE r.organization_id=v.organization_id AND r.version_id=v.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS review
          FROM document_versions v JOIN documents d ON(d.organization_id,d.id)=(v.organization_id,v.document_id)
          WHERE v.organization_id=:o AND (CAST(:s AS uuid) IS NULL OR v.supplier_id=CAST(:s AS uuid))
          ORDER BY v.created_at DESC,v.id DESC LIMIT 20 OFFSET :offset"""),
                {"o": access.org, "s": sid, "offset": (page - 1) * 20},
            )
            .mappings()
            .all()
        )
        total = conn.execute(
            text(
                "SELECT count(*) FROM document_versions WHERE organization_id=:o AND (CAST(:s AS uuid) IS NULL OR supplier_id=CAST(:s AS uuid))"
            ),
            {"o": access.org, "s": sid},
        ).scalar_one()
        return {
            "items": [dto(dict(r)) for r in rows],
            "total": total,
            "page": page,
            "enabled": settings().documents_enabled,
        }


def download(access, version):
    with access.connection() as conn:
        r = record(conn, access, version)
    if r["state"] != "SCAN_PASSED":
        raise HTTPException(
            409, "Fichier en quarantaine ou rejeté, téléchargement interdit"
        )
    try:
        f = processing.store_for(r).open_verified(
            Blob(
                access.org,
                r["object_id"],
                r["expected_size"],
                r["sha256"],
                r.get("storage_version"),
            )
        )
    except (OSError, StorageError):
        raise HTTPException(503, "Intégrité ou stockage indisponible") from None
    try:
        with access.connection() as conn:
            record(conn, access, version)
            access.audit(conn, "document.downloaded", version, {"sha256": r["sha256"]})
    except BaseException:
        f.close()
        raise
    ext = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}[r["mime"]]
    return StreamingResponse(
        iter(lambda: f.read(65536), b""),
        media_type=r["mime"],
        background=BackgroundTask(f.close),
        headers={
            "Content-Disposition": f'attachment; filename="document-{version}.{ext}"',
            "Content-Length": str(r["expected_size"]),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
        },
    )


@router.get("")
def staff_list(
    supplier_id: UUID | None = None,
    page: int = Query(1, ge=1, le=1000),
    a=Depends(staff_access),
):
    return listing(a, supplier_id, page)


@portal.get("")
def portal_list(page: int = Query(1, ge=1, le=1000), a=Depends(portal_access)):
    return listing(a, None, page)


@router.post("/uploads")
def staff_begin(body: Upload, a=Depends(staff_access)):
    return begin_upload(body, a)


@portal.post("/uploads")
def portal_begin(body: Upload, a=Depends(portal_access)):
    return begin_upload(body, a)


@router.put("/uploads/{version}/chunks")
async def staff_chunk(
    version: UUID, request: Request, offset: int = Query(ge=0), a=Depends(staff_access)
):
    from starlette.concurrency import run_in_threadpool

    return await run_in_threadpool(put_chunk, a, version, offset, await request.body())


@portal.put("/uploads/{version}/chunks")
async def portal_chunk(
    version: UUID, request: Request, offset: int = Query(ge=0), a=Depends(portal_access)
):
    from starlette.concurrency import run_in_threadpool

    return await run_in_threadpool(put_chunk, a, version, offset, await request.body())


@router.post("/uploads/{version}/finish")
def staff_finish(version: UUID, a=Depends(staff_access)):
    return finish(a, version)


@portal.post("/uploads/{version}/finish")
def portal_finish(version: UUID, a=Depends(portal_access)):
    return finish(a, version)


@router.get("/versions/{version}/download")
def staff_download(version: UUID, a=Depends(staff_access)):
    return download(a, version)


@portal.get("/versions/{version}/download")
def portal_download(version: UUID, a=Depends(portal_access)):
    return download(a, version)


@router.post("/versions/{version}/reviews")
def review(version: UUID, body: Review, a=Depends(staff_access)):
    with a.connection(review=True) as conn:
        r = record(conn, a, version)
        if r["state"] != "SCAN_PASSED":
            raise HTTPException(
                409, "La pièce doit avoir passé les contrôles techniques"
            )
        result = (
            conn.execute(
                text(
                    "INSERT INTO document_reviews(organization_id,supplier_id,version_id,decision,note,actor_id) VALUES(:o,:s,:v,:d,:n,:u) RETURNING *"
                ),
                {
                    "o": a.org,
                    "s": r["supplier_id"],
                    "v": version,
                    "d": body.decision,
                    "n": body.note,
                    "u": a.actor.id,
                },
            )
            .mappings()
            .one()
        )
        a.audit(conn, "document.reviewed", version, dict(result))
        return dict(result)
