import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from app.config import settings
from app.database import transaction
from fastapi import HTTPException, Request
from sqlalchemy import text


@dataclass(frozen=True)
class Identity:
    id: UUID
    email: str
    display_name: str
    csrf_token: str
    token_hash: str
    acr: str


def token_hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


def require_identity(request: Request):
    raw = request.cookies.get(settings().session_cookie, "")
    if not raw or len(raw) > 256:
        raise HTTPException(401, "Connexion requise")
    with transaction() as conn:
        row = (
            conn.execute(
                text("""SELECT u.id,u.email,u.display_name,s.csrf_token,s.token_hash,s.acr,s.expires_at,u.issuer
          FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.token_hash=:h AND s.revoked_at IS NULL"""),
                {"h": token_hash(raw)},
            )
            .mappings()
            .first()
        )
    if not row or row["expires_at"] <= datetime.now(timezone.utc):
        raise HTTPException(401, "Session expirée ou révoquée")
    if settings().auth_provider == "clerk_development":
        if (
            row["issuer"] != settings().clerk_issuer
            or row["acr"] != "clerk-development"
        ):
            raise HTTPException(401, "Fournisseur de session incompatible")
    elif settings().auth_provider == "clerk_production":
        from app.clerk_identity import parse_production_marker

        if row["issuer"] != settings().clerk_issuer or not parse_production_marker(
            row["acr"]
        ):
            raise HTTPException(401, "Fournisseur de session incompatible")
    elif row["acr"] == "clerk-development" or row["acr"].startswith(
        "clerk-production:"
    ):
        raise HTTPException(401, "Fournisseur de session incompatible")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if request.headers.get("origin") != settings().public_origin:
            raise HTTPException(403, "Origine non autorisée")
        if not secrets.compare_digest(
            request.headers.get("x-csrf-token", ""), row["csrf_token"]
        ):
            raise HTTPException(403, "Protection CSRF : rechargez la page")
    return Identity(**{k: row[k] for k in Identity.__dataclass_fields__})


def mfa_satisfied(identity):
    if settings().auth_provider == "clerk_production":
        from app.clerk_identity import parse_production_marker

        proof = parse_production_marker(identity.acr)
        return bool(proof and proof[1] > int(datetime.now(timezone.utc).timestamp()))
    expected = settings().admin_acr
    return not expected or identity.acr == expected


def require_mfa(identity):
    if not mfa_satisfied(identity):
        raise HTTPException(
            403,
            "Double authentification récente requise : utilisez Sécurité du compte puis Vérifier mon identité."
            if settings().auth_provider == "clerk_production"
            else "Authentification renforcée requise pour une action administrateur",
        )


def authorize(conn, org, identity, roles=None):
    role = conn.execute(text("SELECT authz.member_role(:o)"), {"o": org}).scalar()
    if role is None:
        raise HTTPException(404, "Organisation introuvable")
    if roles and role not in roles:
        raise HTTPException(403, "Permission insuffisante")
    if role == "Admin" and roles and "Admin" in roles:
        require_mfa(identity)
    return role
