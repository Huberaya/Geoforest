"""Tests C12 du profil, du mot de passe et de la gestion des membres."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models import User, UserRole
from app.models.audit import AuditEvent

pytestmark = pytest.mark.asyncio


async def _register(client, email: str, organization_name: str) -> dict:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "SettingsTestPass123!",
            "organization_name": organization_name,
            "organization_country": "FR",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_profile_phone_is_returned_and_audited(client, db_session):
    registered = await _register(client, "settings-profile@example.com", "Tenant Profil")
    response = await client.patch(
        "/api/v1/users/me",
        headers=_headers(registered["access_token"]),
        json={"first_name": "Alice", "phone": "+33 2 40 00 00 00", "locale": "fr"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["phone"] == "+33 2 40 00 00 00"

    audit = (
        await db_session.execute(
            select(AuditEvent).where(
                AuditEvent.organization_id == uuid.UUID(registered["user"]["organization_id"]),
                AuditEvent.action == "user.profile_updated",
            )
        )
    ).scalars().one()
    assert audit.previous_data["phone"] is None
    assert audit.new_data["phone"] == "+33 2 40 00 00 00"
    assert "password_hash" not in audit.new_data
    assert "refresh_token_jti" not in audit.new_data

    # Le numéro reste disponible dans le profil propre, pas dans les vues génériques de membres.
    user_detail = await client.get(
        f"/api/v1/users/{registered['user']['id']}",
        headers=_headers(registered["access_token"]),
    )
    assert user_detail.status_code == 200
    assert "phone" not in user_detail.json()


async def test_password_change_audits_only_credential_state(client, db_session):
    registered = await _register(client, "settings-password@example.com", "Tenant Mot de passe")
    new_password = "NewSettingsPass456!"
    changed = await client.post(
        "/api/v1/users/me/password",
        headers=_headers(registered["access_token"]),
        json={"current_password": "SettingsTestPass123!", "new_password": new_password},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["message"] == "Mot de passe mis à jour."

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "settings-password@example.com", "password": new_password},
    )
    assert login.status_code == 200, login.text
    audit = (
        await db_session.execute(
            select(AuditEvent).where(
                AuditEvent.organization_id == uuid.UUID(registered["user"]["organization_id"]),
                AuditEvent.action == "user.password_changed",
            )
        )
    ).scalars().one()
    assert audit.previous_data == {"credential_state": "password_configured"}
    assert audit.new_data == {"credential_state": "password_updated"}
    assert new_password not in str(audit.previous_data)
    assert new_password not in str(audit.new_data)


async def test_admin_can_deactivate_only_a_member_in_the_same_tenant(client, db_session):
    tenant_a = await _register(client, "settings-admin-a@example.com", "Tenant Membres A")
    tenant_b = await _register(client, "settings-admin-b@example.com", "Tenant Membres B")
    org_a = uuid.UUID(tenant_a["user"]["organization_id"])
    org_b = uuid.UUID(tenant_b["user"]["organization_id"])
    member_a = User(
        organization_id=org_a,
        email="member-a@example.com",
        password_hash="placeholder-hash",
        role=UserRole.viewer,
        is_active=True,
    )
    member_b = User(
        organization_id=org_b,
        email="member-b@example.com",
        password_hash="placeholder-hash",
        role=UserRole.viewer,
        is_active=True,
    )
    db_session.add_all([member_a, member_b])
    await db_session.flush()

    deactivated = await client.delete(
        f"/api/v1/users/{member_a.id}",
        headers=_headers(tenant_a["access_token"]),
    )
    assert deactivated.status_code == 200, deactivated.text
    assert deactivated.json()["user_id"] == str(member_a.id)
    assert member_a.is_active is False

    cross_tenant = await client.delete(
        f"/api/v1/users/{member_b.id}",
        headers=_headers(tenant_a["access_token"]),
    )
    assert cross_tenant.status_code == 404
