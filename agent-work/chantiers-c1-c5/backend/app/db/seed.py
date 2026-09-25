"""Seed de démonstration explicite, réservé aux environnements de développement."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.models import Organization, User, UserRole

logger = logging.getLogger(__name__)
DEMO_ORG_NAME = "Café Import SAS — Démo"


async def seed_if_empty(db: AsyncSession) -> None:
    """Crée le compte de démonstration seulement après opt-in et secrets locaux fournis."""
    if settings.environment.lower() not in {"development", "demo"}:
        logger.warning("Seed de démonstration refusé hors environnement development/demo.")
        return
    if not settings.demo_seed_enabled:
        return
    if not settings.demo_admin_email.strip() or not settings.demo_admin_password:
        logger.warning("Seed de démonstration ignoré : email/mot de passe non configurés.")
        return
    if len(settings.demo_admin_password) < 16:
        raise ValueError("DEMO_ADMIN_PASSWORD doit contenir au moins 16 caractères.")

    result = await db.execute(select(func.count()).select_from(User))
    if result.scalar_one() > 0:
        return

    org = Organization(
        name=DEMO_ORG_NAME,
        legal_name="Café Import SAS",
        country="FR",
        eori="FR12345678901234",
        address="1 rue du Port, 76600 Le Havre",
        contact_email=settings.demo_admin_email,
        plan="pme",
    )
    db.add(org)
    await db.flush()

    admin = User(
        organization_id=org.id,
        email=settings.demo_admin_email.strip().lower(),
        password_hash=hash_password(settings.demo_admin_password),
        first_name="Démo",
        last_name="Admin",
        role=UserRole.admin,
        is_active=True,
        email_verified_at=datetime.now(timezone.utc),
    )
    db.add(admin)
    await db.flush()
    logger.info("Organisation de démonstration créée pour %s.", admin.email)
