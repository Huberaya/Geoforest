"""Short-session bridges. Development and production remain separate modes."""

import secrets
from datetime import datetime, timezone
from functools import lru_cache

import httpx
from app.clerk_identity import (
    ClerkAuthenticationError,
    ClerkDevelopmentConfig,
    ClerkDevelopmentVerifier,
    ClerkProductionConfig,
    ClerkProductionVerifier,
    parse_production_marker,
    production_marker,
)
from app.config import settings
from app.database import transaction
from app.security import token_hash
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import text

router = APIRouter(prefix="/api/auth/clerk")
MARKER = "clerk-development"


def check_origin(request):
    if settings().auth_provider not in {"clerk_development", "clerk_production"}:
        raise HTTPException(404, "Authentification Clerk désactivée")
    if request.headers.get("origin") != settings().public_origin:
        raise HTTPException(403, "Origine non autorisée")


@lru_cache(maxsize=1)
def verifier():
    s = settings()
    production = s.auth_provider == "clerk_production"
    config_class = ClerkProductionConfig if production else ClerkDevelopmentConfig
    verifier_class = ClerkProductionVerifier if production else ClerkDevelopmentVerifier
    return verifier_class(
        config_class(s.clerk_issuer, s.public_origin, s.clerk_secret_key),
        httpx.Client(
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=4)
        ),
    )


def verified_identity(request: Request):
    check_origin(request)
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer ") or len(authorization) > 16400:
        raise HTTPException(401, "Preuve Clerk requise")
    try:
        identity = verifier().verify(authorization[7:])
    except ClerkAuthenticationError:
        raise HTTPException(401, "Session Clerk non vérifiable") from None
    return identity


@router.post("/assurance")
def assurance(request: Request):
    if settings().auth_provider != "clerk_production":
        raise HTTPException(404, "Parcours production désactivé")
    identity = verified_identity(request)
    if not identity.mfa_enrolled:
        raise HTTPException(
            403, "Activez la double authentification dans Sécurité du compte."
        )
    if identity.mfa_expires_at <= int(datetime.now(timezone.utc).timestamp()):
        # Contract consumed by Clerk's useReverification; NEVER authorize based on UI success.
        return JSONResponse(
            {
                "clerk_error": {
                    "type": "forbidden",
                    "reason": "reverification-error",
                    "metadata": {
                        "reverification": {"level": "multi_factor", "afterMinutes": 5}
                    },
                }
            },
            status_code=403,
        )
    return {"verified": True}


@router.post("/exchange")
def exchange(request: Request):
    identity = verified_identity(request)
    production = settings().auth_provider == "clerk_production"
    marker = production_marker(identity) if production else MARKER
    now = datetime.now(timezone.utc)
    # No clock leeway carried into application cookies. At most 60 seconds,
    # including with a custom five-minute Clerk JWT. Every renewal rechecks revocation.
    ttl = min(60, identity.expires_at - int(now.timestamp()))
    if ttl < 10:
        raise HTTPException(401, "Renouvelez votre preuve Clerk")
    expiry = datetime.fromtimestamp(int(now.timestamp()) + ttl, timezone.utc)
    old = request.cookies.get(settings().session_cookie, "")
    if len(old) > 256:
        raise HTTPException(401, "Cookie invalide")
    with transaction() as conn:
        uid = conn.execute(
            text("""INSERT INTO users(issuer,subject,email,display_name)
            VALUES(:i,:s,:e,:n) ON CONFLICT(issuer,subject)
            DO UPDATE SET email=excluded.email,display_name=excluded.display_name RETURNING id"""),
            {
                "i": identity.issuer,
                "s": identity.subject,
                "e": identity.email,
                "n": identity.display_name,
            },
        ).scalar_one()
        row = (
            conn.execute(
                text(
                    "SELECT user_id,csrf_token,acr,revoked_at FROM sessions WHERE token_hash=:h FOR UPDATE"
                ),
                {"h": token_hash(old)},
            )
            .mappings()
            .first()
            if old
            else None
        )
        # A logout must beat any queued refresh using the revoked cookie.
        if row and row["revoked_at"] is not None:
            raise HTTPException(401, "Session fermée : reconnectez-vous")
        previous_proof = (
            parse_production_marker(row["acr"]) if row and production else None
        )
        same_session = (
            previous_proof is not None and previous_proof[0] == identity.session_id
            if production
            else row is not None and row["acr"] == MARKER
        )
        if row and row["user_id"] == uid and same_session:
            raw, csrf = old, row["csrf_token"]
            conn.execute(
                text("UPDATE sessions SET expires_at=:e,acr=:a WHERE token_hash=:h"),
                {"e": expiry, "h": token_hash(raw), "a": marker},
            )
        else:
            if old:
                conn.execute(
                    text("UPDATE sessions SET revoked_at=now() WHERE token_hash=:h"),
                    {"h": token_hash(old)},
                )
            raw, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
            conn.execute(
                text("""INSERT INTO sessions(token_hash,user_id,csrf_token,acr,expires_at)
                VALUES(:h,:u,:c,:a,:e)"""),
                {"h": token_hash(raw), "u": uid, "c": csrf, "a": marker, "e": expiry},
            )
        conn.execute(
            text("DELETE FROM sessions WHERE expires_at < now() - interval '1 day'")
        )
    response = JSONResponse(
        {
            "csrf_token": csrf,
            "expires_at": int(expiry.timestamp()),
            "user_id": str(uid),
            "admin_mfa_satisfied": identity.mfa_expires_at > int(now.timestamp())
            if production
            else False,
        }
    )
    response.set_cookie(
        settings().session_cookie,
        raw,
        max_age=ttl,
        httponly=True,
        secure=settings().secure_cookie,
        samesite="lax",
        path="/",
    )
    return response


@router.post("/logout", status_code=204)
def logout(request: Request):
    check_origin(request)
    # Origin plus a non-simple header prevents cross-origin logout CSRF, even
    # when the local short-lived session is already expired.
    if request.headers.get("x-gft-logout") != "1":
        raise HTTPException(403, "Confirmation de déconnexion requise")
    raw = request.cookies.get(settings().session_cookie, "")
    if raw and len(raw) <= 256:
        with transaction() as conn:
            conn.execute(
                text(
                    "UPDATE sessions SET revoked_at=now() WHERE token_hash=:h AND (acr=:a OR acr LIKE 'clerk-production:%')"
                ),
                {"h": token_hash(raw), "a": MARKER},
            )
    response = Response(status_code=204)
    response.delete_cookie(
        settings().session_cookie,
        path="/",
        secure=settings().secure_cookie,
        httponly=True,
        samesite="lax",
    )
    return response
