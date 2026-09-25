from fastapi import APIRouter

from app.core.config import settings

router = APIRouter()


@router.get("/")
async def health_root():
    """Alias sur /api/v1/health/ — le endpoint principal /health est défini dans main.py."""
    return {"status": "ok", "version": settings.app_version, "env": settings.environment}
