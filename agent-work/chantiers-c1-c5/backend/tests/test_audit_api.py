"""Tests C12 des filtres, permissions, cloisonnement et masquage du journal."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from app.core.security import create_access_token
from app.models import User, UserRole
from app.models.audit import AuditEvent

pytestmark = pytest.mark.asyncio


async def _register(client, email: str, organization_name: str) -> dict:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "AuditTestPass123!",
            "organization_name": organization_name,
            "organization_country": "FR",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_audit_filters_are_tenant_scoped_and_redact_precise_geodata(client, db_session):
    tenant_a = await _register(client, "audit-a@example.com", "Tenant Audit A")
    tenant_b = await _register(client, "audit-b@example.com", "Tenant Audit B")
    user_a_id = uuid.UUID(tenant_a["user"]["id"])
    org_a = uuid.UUID(tenant_a["user"]["organization_id"])
    org_b = uuid.UUID(tenant_b["user"]["organization_id"])
    object_id = uuid.uuid4()

    event_a = AuditEvent(
        organization_id=org_a,
        actor_user_id=user_a_id,
        action="plot.updated",
        object_type="plot",
        object_id=object_id,
        occurred_at=datetime(2026, 9, 27, 22, 30, tzinfo=timezone.utc),  # 00:30 le 28/09 à Paris
        ip_address="192.0.2.10",
        user_agent="test-agent",
        previous_data={
            "geometry": {"type": "Point", "coordinates": [12.3456789, 50.1234567]},
            "centroid": {"lon": 12.3456789, "lat": 50.1234567},
            "area_ha": 1.5,
        },
        new_data={"coordinates": [12.3456789, 50.1234567], "status": "valid"},
    )
    event_before_paris_day = AuditEvent(
        organization_id=org_a,
        actor_user_id=user_a_id,
        action="plot.updated",
        object_type="plot",
        object_id=uuid.uuid4(),
        occurred_at=datetime(2026, 9, 27, 21, 30, tzinfo=timezone.utc),  # 23:30 le 27/09 à Paris
    )
    event_b = AuditEvent(
        organization_id=org_b,
        actor_user_id=uuid.UUID(tenant_b["user"]["id"]),
        action="plot.updated",
        object_type="plot",
        object_id=uuid.uuid4(),
        occurred_at=datetime(2026, 9, 27, 22, 45, tzinfo=timezone.utc),
    )
    db_session.add_all([event_a, event_before_paris_day, event_b])
    await db_session.flush()

    response = await client.get(
        "/api/v1/audit-log",
        params={
            "object_type": "plot",
            "action": "plot.updated",
            "actor_user_id": str(user_a_id),
            "from_date": "2026-09-28",
            "to_date": "2026-09-28",
        },
        headers=_headers(tenant_a["access_token"]),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["actor_email"] == "audit-a@example.com"
    assert item["previous_data"]["geometry"] == "[donnée géospatiale masquée]"
    assert item["previous_data"]["centroid"] == "[donnée géospatiale masquée]"
    assert item["previous_data"]["area_ha"] == 1.5
    assert item["new_data"]["coordinates"] == "[donnée géospatiale masquée]"
    # Le masquage est une présentation API; le snapshot source est conservé intact en base.
    assert event_a.previous_data["geometry"]["coordinates"] == [12.3456789, 50.1234567]

    wrong_day = await client.get(
        "/api/v1/audit-log",
        params={"from_date": "2026-09-27", "to_date": "2026-09-27"},
        headers=_headers(tenant_a["access_token"]),
    )
    assert wrong_day.status_code == 200
    assert wrong_day.json()["total"] == 1
    assert wrong_day.json()["items"][0]["id"] == str(event_before_paris_day.id)


async def test_audit_rejects_invalid_range_and_nonprivileged_role(client, db_session):
    registered = await _register(client, "audit-viewer@example.com", "Tenant Audit Permissions")
    invalid_range = await client.get(
        "/api/v1/audit-log",
        params={"from_date": "2026-09-29", "to_date": "2026-09-28"},
        headers=_headers(registered["access_token"]),
    )
    assert invalid_range.status_code == 422

    user = await db_session.get(User, uuid.UUID(registered["user"]["id"]))
    assert user is not None
    user.role = UserRole.viewer
    await db_session.flush()
    denied = await client.get("/api/v1/audit-log", headers=_headers(create_access_token(user)))
    assert denied.status_code == 403
