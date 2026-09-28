import secrets
from dataclasses import dataclass
from uuid import UUID

from app.config import settings
from app.database import transaction
from app.security import token_hash
from fastapi import HTTPException, Request
from sqlalchemy import text


@dataclass(frozen=True)
class SupplierSession:
    organization_id: UUID
    supplier_id: UUID
    token_hash: str
    csrf_token: str
    supplier_name: str
    organization_name: str
    expires_at: object


def same_origin(request):
    if request.headers.get("origin") != settings().public_origin:
        raise HTTPException(403, "Origine non autorisée")


def require_supplier(request: Request):
    raw = request.cookies.get(settings().portal_cookie, "")
    if not raw or len(raw) > 256:
        raise HTTPException(401, "Accès fournisseur requis")
    hashed = token_hash(raw)
    with transaction() as conn:
        record = (
            conn.execute(
                text("SELECT * FROM authz.supplier_session_info(:h)"), {"h": hashed}
            )
            .mappings()
            .first()
        )
    if not record:
        raise HTTPException(
            401, "Accès expiré ou révoqué. Demandez un nouveau lien à votre client."
        )
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        same_origin(request)
        if not secrets.compare_digest(
            request.headers.get("x-csrf-token", ""), record["csrf_token"]
        ):
            raise HTTPException(403, "Protection CSRF : rechargez la page")
    return SupplierSession(**dict(record), token_hash=hashed)
