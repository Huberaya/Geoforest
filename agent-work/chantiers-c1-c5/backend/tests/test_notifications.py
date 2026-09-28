"""Tests du centre de notifications persistantes et des états destinataire."""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.security import create_access_token
from app.models import User, UserRole
from app.models.alerts import Alert, AlertCategory, AlertLevel
from app.services.notifications import create_alert

pytestmark = pytest.mark.asyncio


async def _register(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "CorrectHorse12!",
            "organization_name": f"Org {email}",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["access_token"]


async def _user_for_email(db_session, email: str) -> User:
    result = await db_session.execute(select(User).where(User.email == email))
    return result.scalar_one()


async def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_notifications_are_recipient_scoped_and_read_state_is_individual(client, db_session):
    admin_token = await _register(client, "notifications-admin@example.com")
    admin = await _user_for_email(db_session, "notifications-admin@example.com")
    teammate = User(
        organization_id=admin.organization_id,
        email="notifications-teammate@example.com",
        password_hash=None,
        role=UserRole.viewer,
        is_active=True,
    )
    db_session.add(teammate)
    await db_session.flush()
    teammate_token = create_access_token(teammate)

    private_alert, created = await create_alert(
        db_session,
        organization_id=admin.organization_id,
        user_id=admin.id,
        level=AlertLevel.warning,
        category=AlertCategory.supplier,
        title="Notification privée",
        message="Visible uniquement par son destinataire.",
        link="/suppliers",
        dedupe_key="test:recipient:private",
    )
    assert created is True
    shared_alert, created = await create_alert(
        db_session,
        organization_id=admin.organization_id,
        user_id=None,
        level=AlertLevel.info,
        category=AlertCategory.system,
        title="Notification partagée",
        message="Chaque membre dispose de son propre état de lecture.",
        link="/dashboard",
        dedupe_key="test:recipient:shared",
    )
    assert created is True

    admin_list = await client.get("/api/v1/alerts", headers=await _headers(admin_token))
    teammate_list = await client.get("/api/v1/alerts", headers=await _headers(teammate_token))
    assert admin_list.status_code == 200, admin_list.text
    assert teammate_list.status_code == 200, teammate_list.text
    admin_items = {item["id"]: item for item in admin_list.json()["items"]}
    teammate_items = {item["id"]: item for item in teammate_list.json()["items"]}
    assert str(private_alert.id) in admin_items
    assert str(private_alert.id) not in teammate_items
    assert str(shared_alert.id) in admin_items
    assert str(shared_alert.id) in teammate_items
    assert admin_list.json()["unread_count"] == 3  # bienvenue + privée + partagée
    assert teammate_list.json()["unread_count"] == 2  # bienvenue + partagée

    mark_read = await client.post(
        f"/api/v1/alerts/{shared_alert.id}/read",
        headers=await _headers(admin_token),
    )
    assert mark_read.status_code == 200, mark_read.text

    admin_shared = await client.get(
        "/api/v1/alerts",
        headers=await _headers(admin_token),
        params={"category": "system", "is_read": "true"},
    )
    teammate_shared = await client.get(
        "/api/v1/alerts",
        headers=await _headers(teammate_token),
        params={"category": "system", "is_read": "false"},
    )
    assert [item["id"] for item in admin_shared.json()["items"]] == [str(shared_alert.id)]
    assert admin_shared.json()["items"][0]["is_read"] is True
    assert [item["id"] for item in teammate_shared.json()["items"]] == [str(shared_alert.id)]
    assert teammate_shared.json()["items"][0]["is_read"] is False

    forbidden_recipient = await client.post(
        f"/api/v1/alerts/{private_alert.id}/read",
        headers=await _headers(teammate_token),
    )
    assert forbidden_recipient.status_code == 404

    mark_all = await client.post("/api/v1/alerts/read-all", headers=await _headers(admin_token))
    assert mark_all.status_code == 200, mark_all.text
    assert mark_all.json()["updated_count"] == 2
    admin_count = await client.get("/api/v1/alerts/unread-count", headers=await _headers(admin_token))
    teammate_count = await client.get("/api/v1/alerts/unread-count", headers=await _headers(teammate_token))
    assert admin_count.json()["count"] == 0
    assert teammate_count.json()["count"] == 2

    mark_unread = await client.post(
        f"/api/v1/alerts/{shared_alert.id}/unread",
        headers=await _headers(admin_token),
    )
    assert mark_unread.status_code == 200, mark_unread.text
    admin_count = await client.get("/api/v1/alerts/unread-count", headers=await _headers(admin_token))
    teammate_count = await client.get("/api/v1/alerts/unread-count", headers=await _headers(teammate_token))
    assert admin_count.json()["count"] == 1
    assert teammate_count.json()["count"] == 2


async def test_alerts_are_tenant_scoped_and_legacy_read_endpoint_is_compatible(client, db_session):
    owner_token = await _register(client, "notifications-owner@example.com")
    other_token = await _register(client, "notifications-other@example.com")
    owner = await _user_for_email(db_session, "notifications-owner@example.com")
    owner_list = await client.get("/api/v1/alerts", headers=await _headers(owner_token))
    welcome_id = owner_list.json()["items"][0]["id"]

    cross_tenant = await client.post(
        f"/api/v1/alerts/{welcome_id}/read",
        headers=await _headers(other_token),
    )
    assert cross_tenant.status_code == 404

    legacy_route = await client.post(
        f"/api/v1/dashboard/alerts/{welcome_id}/read",
        headers=await _headers(owner_token),
    )
    assert legacy_route.status_code == 200, legacy_route.text
    dashboard = await client.get("/api/v1/dashboard/overview", headers=await _headers(owner_token))
    welcome = next(item for item in dashboard.json()["recent_alerts"] if item["id"] == welcome_id)
    assert welcome["is_read"] is True

    # A supplier account cannot read the operator notification center.
    supplier_user = User(
        organization_id=owner.organization_id,
        email="notifications-supplier@example.com",
        role=UserRole.supplier,
        is_active=True,
    )
    db_session.add(supplier_user)
    await db_session.flush()
    supplier_response = await client.get(
        "/api/v1/alerts",
        headers=await _headers(create_access_token(supplier_user)),
    )
    assert supplier_response.status_code == 403


async def test_notification_creation_is_idempotent_and_rejects_external_links(client, db_session):
    token = await _register(client, "notifications-dedupe@example.com")
    user = await _user_for_email(db_session, "notifications-dedupe@example.com")
    first, first_created = await create_alert(
        db_session,
        organization_id=user.organization_id,
        user_id=user.id,
        level=AlertLevel.info,
        category=AlertCategory.system,
        title="Même événement",
        message="Première émission.",
        link="/dashboard",
        dedupe_key="test:idempotent:event",
    )
    second, second_created = await create_alert(
        db_session,
        organization_id=user.organization_id,
        user_id=user.id,
        level=AlertLevel.info,
        category=AlertCategory.system,
        title="Même événement répété",
        message="Deuxième émission.",
        link="/dashboard",
        dedupe_key="test:idempotent:event",
    )
    assert first_created is True
    assert second_created is False
    assert second.id == first.id

    with pytest.raises(ValueError, match="chemin interne"):
        await create_alert(
            db_session,
            organization_id=user.organization_id,
            user_id=user.id,
            level=AlertLevel.warning,
            category=AlertCategory.system,
            title="Lien externe interdit",
            link="https://example.test/",
            dedupe_key="test:unsafe-link",
        )

    listed = await client.get("/api/v1/alerts", headers=await _headers(token))
    assert listed.status_code == 200
    assert sum(item["id"] == str(first.id) for item in listed.json()["items"]) == 1


async def test_list_filters_and_limits_are_bounded(client):
    token = await _register(client, "notifications-filter@example.com")
    response = await client.get(
        "/api/v1/alerts",
        headers=await _headers(token),
        params={"limit": 101},
    )
    assert response.status_code == 422
    response = await client.get(
        "/api/v1/alerts",
        headers=await _headers(token),
        params={"is_read": "false", "category": "onboarding", "limit": 1, "offset": 0},
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["is_read"] is False


async def test_legacy_read_flag_is_preserved_and_can_be_overridden_per_user(client, db_session):
    token = await _register(client, "notifications-legacy@example.com")
    user = await _user_for_email(db_session, "notifications-legacy@example.com")
    welcome = (await db_session.execute(
        select(Alert).where(
            Alert.organization_id == user.organization_id,
            Alert.dedupe_key == "onboarding:welcome",
        )
    )).scalar_one()
    welcome.is_read = True
    await db_session.flush()

    before = await client.get("/api/v1/alerts", headers=await _headers(token))
    assert before.json()["items"][0]["is_read"] is True

    unread = await client.post(
        f"/api/v1/alerts/{welcome.id}/unread",
        headers=await _headers(token),
    )
    assert unread.status_code == 200
    after = await client.get("/api/v1/alerts", headers=await _headers(token))
    assert after.json()["items"][0]["is_read"] is False
