"""Services pour la création et la consultation des notifications in-app."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserRole
from app.models.alerts import Alert, AlertCategory, AlertLevel, AlertRecipientState


def _visible_to_user(organization_id: UUID, user_id: UUID):
    return and_(
        Alert.organization_id == organization_id,
        or_(Alert.user_id.is_(None), Alert.user_id == user_id),
    )


def _read_state(user_id: UUID):
    # Les lignes historiques utilisent Alert.is_read; un état individuel le surcharge.
    return func.coalesce(AlertRecipientState.is_read, Alert.is_read)


def safe_internal_link(link: str | None) -> str | None:
    """Retourne uniquement un chemin relatif interne utilisable par le routeur UI."""
    if not link or not link.startswith("/") or link.startswith("//") or "\\" in link:
        return None
    parsed = urlsplit(link)
    if parsed.scheme or parsed.netloc or parsed.path.startswith("//"):
        return None
    if any(ord(char) < 32 for char in link):
        return None
    return link


def serialize_alert(alert: Alert, is_read: bool) -> dict[str, Any]:
    return {
        "id": str(alert.id),
        "level": alert.level.value,
        "category": alert.category.value,
        "title": alert.title,
        "message": alert.message,
        "link": safe_internal_link(alert.link),
        "context": alert.context if isinstance(alert.context, dict) else {},
        "is_read": bool(is_read),
        "created_at": alert.created_at.isoformat() if alert.created_at else None,
    }


async def create_alert(
    db: AsyncSession,
    *,
    organization_id: UUID,
    level: AlertLevel,
    category: AlertCategory,
    title: str,
    message: str | None = None,
    link: str | None = None,
    context: dict[str, Any] | None = None,
    user_id: UUID | None = None,
    dedupe_key: str | None = None,
) -> tuple[Alert, bool]:
    """Ajoute une alerte dans la transaction métier; renvoie (alerte, créée)."""
    clean_title = title.strip()
    if not clean_title or len(clean_title) > 200:
        raise ValueError("Le titre de notification doit contenir entre 1 et 200 caractères.")
    if link is not None and safe_internal_link(link) != link:
        raise ValueError("Le lien d'une notification doit être un chemin interne relatif.")
    if dedupe_key is not None:
        dedupe_key = dedupe_key.strip()
        if not dedupe_key or len(dedupe_key) > 180:
            raise ValueError("La clé d'idempotence doit contenir entre 1 et 180 caractères.")

    if user_id is not None:
        recipient = await db.execute(
            select(User.id).where(
                User.id == user_id,
                User.organization_id == organization_id,
                User.is_active.is_(True),
                User.role != UserRole.supplier,
            )
        )
        if recipient.scalar_one_or_none() is None:
            raise ValueError("Le destinataire doit être un membre interne actif du même tenant.")

    if dedupe_key is not None:
        existing = await db.execute(
            select(Alert).where(
                Alert.organization_id == organization_id,
                Alert.dedupe_key == dedupe_key,
            )
        )
        match = existing.scalar_one_or_none()
        if match is not None:
            return match, False

    alert = Alert(
        organization_id=organization_id,
        user_id=user_id,
        level=level,
        category=category,
        title=clean_title,
        message=message,
        link=link,
        context=context or {},
        dedupe_key=dedupe_key,
        is_read=False,
    )
    if dedupe_key is None:
        db.add(alert)
        await db.flush()
        return alert, True

    # La contrainte unique protège aussi contre deux événements concurrents.
    try:
        async with db.begin_nested():
            db.add(alert)
            await db.flush()
    except IntegrityError:
        existing = await db.execute(
            select(Alert).where(
                Alert.organization_id == organization_id,
                Alert.dedupe_key == dedupe_key,
            )
        )
        match = existing.scalar_one_or_none()
        if match is None:
            raise
        return match, False
    return alert, True


def _dialect_insert(db: AsyncSession):
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
        return insert
    if dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
        return insert
    return None


async def _upsert_recipient_states(
    db: AsyncSession,
    values: list[dict[str, Any]],
) -> None:
    if not values:
        return
    insert_for_dialect = _dialect_insert(db)
    if insert_for_dialect is None:
        for value in values:
            result = await db.execute(
                select(AlertRecipientState).where(
                    AlertRecipientState.alert_id == value["alert_id"],
                    AlertRecipientState.user_id == value["user_id"],
                )
            )
            state = result.scalar_one_or_none()
            if state is None:
                db.add(AlertRecipientState(**value))
            else:
                state.is_read = value["is_read"]
                state.read_at = value["read_at"]
                state.updated_at = value["updated_at"]
        await db.flush()
        return

    # Batches avoid oversized parameter lists in SQLite while keeping PostgreSQL atomic.
    for start in range(0, len(values), 200):
        batch = values[start : start + 200]
        insert_stmt = insert_for_dialect(AlertRecipientState).values(batch)
        upsert_stmt = insert_stmt.on_conflict_do_update(
            index_elements=[AlertRecipientState.alert_id, AlertRecipientState.user_id],
            set_={
                "is_read": insert_stmt.excluded.is_read,
                "read_at": insert_stmt.excluded.read_at,
                "updated_at": insert_stmt.excluded.updated_at,
            },
        )
        await db.execute(upsert_stmt)


async def set_user_alert_read(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
    alert_id: UUID,
    is_read: bool,
) -> Alert | None:
    """Modifie l'état de lecture si l'alerte est visible par ce membre."""
    result = await db.execute(
        select(Alert).where(
            Alert.id == alert_id,
            _visible_to_user(organization_id, user_id),
        )
    )
    alert = result.scalar_one_or_none()
    if alert is None:
        return None
    now = datetime.now(timezone.utc)
    await _upsert_recipient_states(
        db,
        [{
            "alert_id": alert.id,
            "user_id": user_id,
            "is_read": is_read,
            "read_at": now if is_read else None,
            "updated_at": now,
        }],
    )
    return alert


async def mark_all_user_alerts_read(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
) -> int:
    """Marque toutes les notifications visibles non lues pour un membre uniquement."""
    read_state = _read_state(user_id)
    result = await db.execute(
        select(Alert.id)
        .outerjoin(
            AlertRecipientState,
            and_(
                AlertRecipientState.alert_id == Alert.id,
                AlertRecipientState.user_id == user_id,
            ),
        )
        .where(
            _visible_to_user(organization_id, user_id),
            read_state.is_(False),
        )
    )
    alert_ids = list(result.scalars().all())
    now = datetime.now(timezone.utc)
    await _upsert_recipient_states(
        db,
        [
            {"alert_id": alert_id, "user_id": user_id, "is_read": True, "read_at": now, "updated_at": now}
            for alert_id in alert_ids
        ],
    )
    return len(alert_ids)


async def count_user_unread_alerts(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
) -> int:
    read_state = _read_state(user_id)
    result = await db.execute(
        select(func.count(Alert.id))
        .select_from(Alert)
        .outerjoin(
            AlertRecipientState,
            and_(
                AlertRecipientState.alert_id == Alert.id,
                AlertRecipientState.user_id == user_id,
            ),
        )
        .where(
            _visible_to_user(organization_id, user_id),
            read_state.is_(False),
        )
    )
    return int(result.scalar_one() or 0)


async def unread_alert_counts_by_level(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
) -> dict[str, int]:
    read_state = _read_state(user_id)
    result = await db.execute(
        select(Alert.level, func.count(Alert.id))
        .select_from(Alert)
        .outerjoin(
            AlertRecipientState,
            and_(
                AlertRecipientState.alert_id == Alert.id,
                AlertRecipientState.user_id == user_id,
            ),
        )
        .where(
            _visible_to_user(organization_id, user_id),
            read_state.is_(False),
        )
        .group_by(Alert.level)
    )
    counts = {level.value: int(count) for level, count in result.all()}
    return {level.value: counts.get(level.value, 0) for level in AlertLevel}


async def list_user_alerts(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
    limit: int = 25,
    offset: int = 0,
    is_read: bool | None = None,
    level: AlertLevel | None = None,
    category: AlertCategory | None = None,
) -> dict[str, Any]:
    read_state = _read_state(user_id)
    predicates = [_visible_to_user(organization_id, user_id)]
    if is_read is not None:
        predicates.append(read_state.is_(is_read))
    if level is not None:
        predicates.append(Alert.level == level)
    if category is not None:
        predicates.append(Alert.category == category)

    query = (
        select(Alert, read_state.label("recipient_is_read"))
        .outerjoin(
            AlertRecipientState,
            and_(
                AlertRecipientState.alert_id == Alert.id,
                AlertRecipientState.user_id == user_id,
            ),
        )
        .where(*predicates)
        .order_by(read_state.asc(), Alert.created_at.desc(), Alert.id.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(query)
    rows = result.all()
    count_result = await db.execute(
        select(func.count(Alert.id))
        .select_from(Alert)
        .outerjoin(
            AlertRecipientState,
            and_(
                AlertRecipientState.alert_id == Alert.id,
                AlertRecipientState.user_id == user_id,
            ),
        )
        .where(*predicates)
    )
    total = int(count_result.scalar_one() or 0)
    unread_count = await count_user_unread_alerts(db, organization_id=organization_id, user_id=user_id)
    return {
        "items": [serialize_alert(alert, bool(recipient_is_read)) for alert, recipient_is_read in rows],
        "total": total,
        "unread_count": unread_count,
        "limit": limit,
        "offset": offset,
    }


async def recent_user_alerts(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
    limit: int = 8,
) -> list[dict[str, Any]]:
    read_state = _read_state(user_id)
    result = await db.execute(
        select(Alert, read_state.label("recipient_is_read"))
        .outerjoin(
            AlertRecipientState,
            and_(
                AlertRecipientState.alert_id == Alert.id,
                AlertRecipientState.user_id == user_id,
            ),
        )
        .where(_visible_to_user(organization_id, user_id))
        .order_by(read_state.asc(), Alert.created_at.desc(), Alert.id.desc())
        .limit(limit)
    )
    return [serialize_alert(alert, bool(is_read)) for alert, is_read in result.all()]
