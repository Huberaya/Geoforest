"""Routeur racine v1 — agrège tous les sous-routeurs."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.endpoints.audit import router as audit_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.dashboard import router as dashboard_router
from app.api.v1.endpoints.deforestation_screenings import router as deforestation_screenings_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.organizations import router as orgs_router
from app.api.v1.endpoints.plots import router as plots_router
from app.api.v1.endpoints.products import router as products_router
from app.api.v1.endpoints.shipments import router as shipments_router
from app.api.v1.endpoints.supplier_portal import router as supplier_portal_router
from app.api.v1.endpoints.suppliers import router as suppliers_router
from app.api.v1.endpoints.users import router as users_router

api_router = APIRouter()
api_router.include_router(health_router, prefix="/health", tags=["system"])
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(dashboard_router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(orgs_router, prefix="/organizations", tags=["organizations"])
api_router.include_router(users_router, prefix="/users", tags=["users"])
api_router.include_router(supplier_portal_router, prefix="/supplier-portal", tags=["supplier-portal"])
api_router.include_router(suppliers_router, prefix="", tags=["suppliers"])
api_router.include_router(products_router, prefix="", tags=["products"])
api_router.include_router(shipments_router, prefix="", tags=["shipments"])
api_router.include_router(plots_router, prefix="", tags=["plots"])
api_router.include_router(deforestation_screenings_router, prefix="", tags=["deforestation-screenings"])
api_router.include_router(audit_router, prefix="", tags=["audit"])
