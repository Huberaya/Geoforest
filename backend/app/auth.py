import secrets
from urllib.parse import urlsplit

from app.config import settings
from app.database import transaction
from app.security import require_identity, token_hash
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import text

router = APIRouter(prefix="/api/auth")
oauth = OAuth()


def backchannel(url):
    origin = settings().oidc_backchannel_origin
    return origin.rstrip("/") + urlsplit(url).path if origin else url


async def oidc_client():
    if oauth.create_client("identity") is None:
        s = settings()
        oauth.register(
            "identity",
            client_id=s.oidc_client_id,
            client_secret=s.oidc_client_secret,
            server_metadata_url=backchannel(
                f"{s.oidc_issuer}/.well-known/openid-configuration"
            ),
            client_kwargs={
                "scope": "openid email profile",
                "code_challenge_method": "S256",
            },
        )
    client = oauth.create_client("identity")
    metadata = await client.load_server_metadata()
    if metadata.get("issuer") != settings().oidc_issuer:
        raise ValueError("OIDC discovery issuer mismatch")
    for key in ("token_endpoint", "jwks_uri", "userinfo_endpoint"):
        if key in metadata:
            metadata[key] = backchannel(metadata[key])
    return client


@router.get("/login")
async def login(request: Request):
    if settings().auth_provider == "clerk_development":
        return RedirectResponse("/sign-in", status_code=303)
    request.session.clear()
    params = {"acr_values": settings().admin_acr} if settings().admin_acr else {}
    return await (await oidc_client()).authorize_redirect(
        request, settings().public_origin + "/api/auth/callback", **params
    )


@router.get("/callback")
async def callback(request: Request):
    if settings().auth_provider != "oidc":
        raise HTTPException(404, "Parcours OIDC désactivé")
    try:
        token = await (await oidc_client()).authorize_access_token(request)
        claims = token.get("userinfo", {})
        if (
            claims.get("iss") != settings().oidc_issuer
            or not claims.get("sub")
            or claims.get("email_verified") is not True
        ):
            raise ValueError("Verified OIDC identity required")
        email = claims.get("email", "")
        name = claims.get("name") or email
        if not email or len(email) > 320 or len(name) > 200:
            raise ValueError("Invalid identity")
        raw, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
        with transaction() as conn:
            user_id = conn.execute(
                text("""INSERT INTO users(issuer,subject,email,display_name)
              VALUES(:i,:s,:e,:n) ON CONFLICT(issuer,subject)
              DO UPDATE SET email=excluded.email,display_name=excluded.display_name RETURNING id"""),
                {"i": claims["iss"], "s": claims["sub"], "e": email, "n": name},
            ).scalar_one()
            # Rotate an existing browser session on successful authentication.
            old = request.cookies.get(settings().session_cookie)
            if old:
                conn.execute(
                    text("UPDATE sessions SET revoked_at=now() WHERE token_hash=:h"),
                    {"h": token_hash(old)},
                )
            conn.execute(
                text("""INSERT INTO sessions(token_hash,user_id,csrf_token,acr,expires_at)
              VALUES(:h,:u,:c,:a,now()+make_interval(hours=>:hours))"""),
                {
                    "h": token_hash(raw),
                    "u": user_id,
                    "c": csrf,
                    "a": str(claims.get("acr", "")),
                    "hours": settings().session_hours,
                },
            )
            conn.execute(
                text("DELETE FROM sessions WHERE expires_at < now() - interval '1 day'")
            )
        request.session.clear()
        response = RedirectResponse("/", status_code=303)
        response.set_cookie(
            settings().session_cookie,
            raw,
            max_age=settings().session_hours * 3600,
            httponly=True,
            secure=settings().secure_cookie,
            samesite="lax",
            path="/",
        )
        return response
    except Exception:
        # No token, email, claims or external error details in browser/logs.
        request.session.clear()
        return RedirectResponse("/?auth_error=1", status_code=303)


@router.post("/logout", status_code=204)
def logout(identity=Depends(require_identity)):
    with transaction(identity.id) as conn:
        conn.execute(
            text("UPDATE sessions SET revoked_at=now() WHERE token_hash=:h"),
            {"h": identity.token_hash},
        )
    from fastapi import Response

    response = Response(status_code=204)
    response.delete_cookie(
        settings().session_cookie,
        path="/",
        secure=settings().secure_cookie,
        httponly=True,
        samesite="lax",
    )
    return response
