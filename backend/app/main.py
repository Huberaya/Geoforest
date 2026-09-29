from contextlib import asynccontextmanager
from uuid import UUID

from app.auth import router as auth_router
from app.clerk_routes import router as clerk_router
from app.config import settings
from app.database import transaction
from app.diligence.routes import router as diligence_router
from app.documents.compliance import router as compliance_router
from app.documents.routes import portal as documents_portal
from app.documents.routes import router as documents_router
from app.events import event
from app.forest.routes import router as forest_router
from app.geospatial.routes import router as geospatial_router
from app.middleware import RequestBoundary
from app.plots.portal import router as plot_portal_router
from app.plots.routes import router as plots_router
from app.portal.routes import router as portal_router
from app.readiness import UnsafeRuntimeDatabase, verify_ready_connection
from app.runtime_gate import RuntimeReadinessGate
from app.schemas import MemberInput, OrganizationCreate, OrganizationUpdate
from app.security import authorize, mfa_satisfied, require_identity, require_mfa
from app.supply.routes import router as supply_router
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware


@asynccontextmanager
async def lifespan(app):
    if settings().app_env == "production":
        # Fail closed before accepting traffic; orchestration also probes readiness.
        try:
            with transaction() as conn:
                verify_ready_connection(conn)
        except (SQLAlchemyError, UnsafeRuntimeDatabase):
            raise RuntimeError(
                "Production database checks failed; consult the deployment runbook"
            ) from None
    yield


app = FastAPI(
    title="GeoForest Trace — socle sécurisé",
    lifespan=lifespan,
    version="0.8.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.add_middleware(RequestBoundary)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings().session_secret,
    session_cookie="gft-oidc-flow",
    max_age=600,
    same_site="lax",
    https_only=settings().secure_cookie,
)
app.add_middleware(RuntimeReadinessGate)
app.add_middleware(
    TrustedHostMiddleware, allowed_hosts=settings().allowed_hosts.split(",")
)
app.include_router(auth_router)
app.include_router(clerk_router)
app.include_router(documents_router)
app.include_router(documents_portal)
app.include_router(compliance_router)
app.include_router(diligence_router)
app.include_router(geospatial_router)
app.include_router(forest_router)
app.include_router(plots_router)
app.include_router(plot_portal_router)
app.include_router(supply_router)
app.include_router(portal_router)


@app.exception_handler(IntegrityError)
async def integrity_error(request: Request, exc):
    return JSONResponse(
        {
            "detail": "Référence déjà utilisée ou relation incompatible. Aucun changement enregistré."
        },
        status_code=409,
    )


@app.exception_handler(SQLAlchemyError)
async def database_error(request: Request, exc):
    return JSONResponse(
        {
            "detail": "Opération indisponible. Réessayez ou contactez votre administrateur."
        },
        status_code=503,
    )


@app.get("/health/live")
def liveness():
    return {"status": "ok"}


@app.get("/health/ready")
def readiness():
    with transaction() as conn:
        try:
            return verify_ready_connection(conn)
        except UnsafeRuntimeDatabase:
            raise HTTPException(503, "Configuration de données non prête") from None


@app.get("/api/v1/me")
def me(identity=Depends(require_identity)):
    with transaction(identity.id) as conn:
        orgs = (
            conn.execute(
                text("""SELECT o.id,o.name,o.version,m.role,m.supplier_id
          FROM organizations o JOIN memberships m ON m.organization_id=o.id
          WHERE m.user_id=:u ORDER BY o.created_at,o.id"""),
                {"u": identity.id},
            )
            .mappings()
            .all()
        )
    return {
        "user": {
            "id": identity.id,
            "email": identity.email,
            "name": identity.display_name,
        },
        "csrf_token": identity.csrf_token,
        "organizations": orgs,
        "environment": settings().app_env,
        "admin_mfa_required": bool(settings().admin_acr),
        "admin_mfa_satisfied": mfa_satisfied(identity),
    }


@app.post("/api/v1/organizations", status_code=201)
def create_organization(body: OrganizationCreate, identity=Depends(require_identity)):
    require_mfa(identity)
    with transaction(identity.id) as conn:
        # Serialize provisioning for an identity to keep the abuse bound deterministic.
        conn.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:id,0))"),
            {"id": str(identity.id)},
        )
        if (
            conn.execute(
                text(
                    "SELECT count(*) FROM memberships WHERE user_id=:u AND role='Admin'"
                ),
                {"u": identity.id},
            ).scalar_one()
            >= 10
        ):
            raise HTTPException(
                409, "Limite de dix organisations administrées atteinte"
            )
        org = conn.execute(
            text("SELECT authz.create_organization(:n)"), {"n": body.name}
        ).scalar_one()
    return {"id": org, "name": body.name, "version": 1, "role": "Admin"}


@app.patch("/api/v1/organizations/{org}")
def rename(org: UUID, body: OrganizationUpdate, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, {"Admin"})
        before = (
            conn.execute(
                text("SELECT name,version FROM organizations WHERE id=:o FOR UPDATE"),
                {"o": org},
            )
            .mappings()
            .one()
        )
        if before["version"] != body.version:
            raise HTTPException(
                409, "Organisation modifiée entre-temps : rechargez la page"
            )
        conn.execute(
            text("UPDATE organizations SET name=:n,version=version+1 WHERE id=:o"),
            {"n": body.name, "o": org},
        )
        event(
            conn,
            org,
            identity,
            "organization.updated",
            "organization",
            org,
            dict(before),
            {"name": body.name, "version": body.version + 1},
        )
    return {"id": org, "name": body.name, "version": body.version + 1}


@app.get("/api/v1/organizations/{org}/members")
def members(org: UUID, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, {"Admin"})
        return (
            conn.execute(
                text("""SELECT m.user_id,m.role,m.supplier_id,u.email,u.display_name
          FROM memberships m JOIN users u ON u.id=m.user_id WHERE organization_id=:o ORDER BY u.email"""),
                {"o": org},
            )
            .mappings()
            .all()
        )


@app.put("/api/v1/organizations/{org}/members")
def set_member(org: UUID, body: MemberInput, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, {"Admin"})
        conn.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:o,0))"),
            {"o": str(org)},
        )
        matches = (
            conn.execute(
                text("SELECT id FROM users WHERE lower(email)=lower(:e)"),
                {"e": body.email},
            )
            .scalars()
            .all()
        )
        if len(matches) != 1:
            raise HTTPException(
                422,
                "Le compte doit se connecter une première fois avec une adresse vérifiée et unique",
            )
        target = matches[0]
        if (
            body.role == "Supplier"
            and not conn.execute(
                text(
                    "SELECT 1 FROM suppliers WHERE organization_id=:o AND id=:s AND archived_at IS NULL"
                ),
                {"o": org, "s": body.supplier_id},
            ).first()
        ):
            raise HTTPException(
                422, "Choisissez une fiche fournisseur active de cette organisation"
            )
        old = (
            conn.execute(
                text(
                    "SELECT role,supplier_id FROM memberships WHERE organization_id=:o AND user_id=:u"
                ),
                {"o": org, "u": target},
            )
            .mappings()
            .first()
        )
        protect_last_admin(conn, org, old, body.role)
        conn.execute(
            text("""INSERT INTO memberships(organization_id,user_id,role,supplier_id) VALUES(:o,:u,:r,:s)
          ON CONFLICT(organization_id,user_id) DO UPDATE SET role=excluded.role,supplier_id=excluded.supplier_id"""),
            {"o": org, "u": target, "r": body.role, "s": body.supplier_id},
        )
        event(
            conn,
            org,
            identity,
            "membership.updated" if old else "membership.created",
            "membership",
            target,
            dict(old) if old else None,
            {"role": body.role, "supplier_id": body.supplier_id},
        )
    return {"user_id": target, "role": body.role, "supplier_id": body.supplier_id}


def protect_last_admin(conn, org, old, new_role=None):
    if old and old["role"] == "Admin" and new_role != "Admin":
        count = conn.execute(
            text(
                "SELECT count(*) FROM memberships WHERE organization_id=:o AND role='Admin'"
            ),
            {"o": org},
        ).scalar_one()
        if count <= 1:
            raise HTTPException(
                409, "Le dernier administrateur ne peut pas être retiré ou rétrogradé"
            )


@app.delete("/api/v1/organizations/{org}/members/{user_id}", status_code=204)
def remove_member(org: UUID, user_id: UUID, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, {"Admin"})
        conn.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:o,0))"),
            {"o": str(org)},
        )
        old = (
            conn.execute(
                text(
                    "SELECT role,supplier_id FROM memberships WHERE organization_id=:o AND user_id=:u"
                ),
                {"o": org, "u": user_id},
            )
            .mappings()
            .first()
        )
        if not old:
            raise HTTPException(404, "Membre introuvable")
        protect_last_admin(conn, org, old)
        event(
            conn,
            org,
            identity,
            "membership.removed",
            "membership",
            user_id,
            dict(old),
            None,
        )
        conn.execute(
            text("DELETE FROM memberships WHERE organization_id=:o AND user_id=:u"),
            {"o": org, "u": user_id},
        )


@app.get("/api/v1/organizations/{org}/audit")
def audit(
    org: UUID, limit: int = Query(50, ge=1, le=100), identity=Depends(require_identity)
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, {"Admin", "Compliance Manager"})
        return (
            conn.execute(
                text("""SELECT id,actor_id,actor_kind,supplier_actor_id,action,object_type,object_id,previous_value,new_value,source,created_at
           FROM audit_events WHERE organization_id=:o ORDER BY created_at DESC,id DESC LIMIT :l"""),
                {"o": org, "l": limit},
            )
            .mappings()
            .all()
        )


@app.api_route(
    "/api/v1/{retired:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
def retired_endpoint(retired: str, identity=Depends(require_identity)):
    raise HTTPException(
        410,
        "Fonctionnalité indisponible : ancien prototype retiré. Aucune analyse ni déclaration réglementaire réalisée.",
    )
