"""Tests sécurité et parcours du portail fournisseur."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models import User
from app.models.suppliers import Supplier, SupplierInvitation
from app.services.supplier_portal import (
    PURPOSE_INVITATION,
    PURPOSE_LOGIN,
    decode_supplier_link,
    hash_jti,
    issue_supplier_link,
)
import app.api.v1.endpoints.supplier_portal as supplier_portal_endpoint
import app.api.v1.endpoints.suppliers as suppliers_endpoint


def _token_from_url(url: str) -> str:
    fragment = parse_qs(urlparse(url).fragment)
    return fragment["token"][0]


async def _register_operator(client, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "SupplierPortalPass2026!",
            "first_name": "Opérateur",
            "organization_name": "Organisation Portail",
        },
    )
    assert response.status_code in (200, 201), response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _make_supplier(client, headers, *, email: str, name: str = "Coopérative Portail") -> dict:
    response = await client.post(
        "/api/v1/suppliers",
        headers=headers,
        json={
            "name": name,
            "supplier_type": "cooperative",
            "country": "CI",
            "contact_name": "Awa Traoré",
            "contact_email": email,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _invite(client, headers, supplier_id: str) -> dict:
    response = await client.post(f"/api/v1/suppliers/{supplier_id}/invite", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_invitation_is_hashed_one_time_and_profile_is_limited(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", None)
    operator_headers = await _register_operator(client, "portal-admin-1@example.com")
    supplier = await _make_supplier(client, operator_headers, email="awa@example.com")

    invitation_response = await _invite(client, operator_headers, supplier["id"])
    assert invitation_response["delivery_status"] == "ready_to_share"
    assert invitation_response["invitation_url"].startswith("http://localhost:3000/supplier-portal#token=")
    token = _token_from_url(invitation_response["invitation_url"])
    claims = decode_supplier_link(token)
    assert claims is not None
    assert claims["purpose"] == PURPOSE_INVITATION
    assert claims["type"] == "supplier_magic_link"
    assert claims["exp"] - claims["iat"] == settings.supplier_invitation_ttl_hours * 3600

    invitation = (await db_session.execute(
        select(SupplierInvitation).where(SupplierInvitation.id == invitation_response["invitation_id"])
    )).scalar_one()
    assert invitation.jti_hash == hash_jti(claims["jti"])
    assert token not in repr(invitation)
    assert invitation.sent_at is None

    accepted = await client.post("/api/v1/supplier-portal/accept-link", json={"token": token})
    assert accepted.status_code == 200, accepted.text
    tokens = accepted.json()
    assert tokens["user"]["role"] == "supplier"
    assert tokens["user"]["email"] == "awa@example.com"
    supplier_headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    profile_response = await client.get("/api/v1/supplier-portal/me", headers=supplier_headers)
    assert profile_response.status_code == 200, profile_response.text
    profile = profile_response.json()
    assert profile["supplier_id"] == supplier["id"]
    assert profile["completeness_total"] == 5
    assert profile["completeness_percent"] == 40  # contact + email déjà présents

    update_response = await client.patch(
        "/api/v1/supplier-portal/me",
        headers=supplier_headers,
        json={
            "address": "12 rue des Cacaoyers, Abidjan",
            "tax_id": "CI-123456",
            # Champs en dehors de la liste blanche : ignorés par le schéma.
            "name": "Tentative de renommage",
            "status": "active",
            "risk_rating": "high",
            "contact_email": "attacker@example.com",
        },
    )
    assert update_response.status_code == 200, update_response.text
    updated = update_response.json()
    assert updated["address"] == "12 rue des Cacaoyers, Abidjan"
    assert updated["tax_id"] == "CI-123456"
    assert updated["name"] == "Coopérative Portail"
    assert updated["status"] == "pending"
    assert updated["risk_rating"] == "unknown"
    assert updated["contact_email"] == "awa@example.com"
    assert updated["completeness_percent"] == 80

    replay = await client.post("/api/v1/supplier-portal/accept-link", json={"token": token})
    assert replay.status_code == 401

    operator_events = await client.get(
        "/api/v1/audit-log",
        headers=operator_headers,
        params={"object_type": "supplier", "object_id": supplier["id"]},
    )
    assert operator_events.status_code == 200
    actions = {event["action"] for event in operator_events.json()["items"]}
    assert {"supplier.invited", "supplier.invitation_accepted", "supplier.profile_updated_by_supplier"} <= actions
    update_event = next(
        event for event in operator_events.json()["items"]
        if event["action"] == "supplier.profile_updated_by_supplier"
    )
    assert update_event["actor_user_id"] == tokens["user"]["id"]
    assert update_event["ip_address"]
    assert update_event["previous_data"]["address"] is None
    assert update_event["new_data"]["address"] == "12 rue des Cacaoyers, Abidjan"

    stored_invitation = (await db_session.execute(
        select(SupplierInvitation).where(SupplierInvitation.id == invitation.id)
    )).scalar_one()
    assert stored_invitation.consumed_at is not None


@pytest.mark.asyncio
async def test_login_link_ttl_delivery_generic_response_and_single_use(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", None)
    operator_headers = await _register_operator(client, "portal-admin-2@example.com")
    supplier = await _make_supplier(client, operator_headers, email="login@example.com", name="Ferme Login")
    invitation = await _invite(client, operator_headers, supplier["id"])
    accepted = await client.post(
        "/api/v1/supplier-portal/accept-link",
        json={"token": _token_from_url(invitation["invitation_url"])},
    )
    assert accepted.status_code == 200

    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    delivered: dict[str, str] = {}

    async def fake_deliver(email: str, supplier_name: str, link: str, purpose: str) -> str:
        delivered.update(email=email, supplier_name=supplier_name, link=link, purpose=purpose)
        return "sent"

    monkeypatch.setattr(supplier_portal_endpoint, "deliver_supplier_link", fake_deliver)

    response = await client.post(
        "/api/v1/supplier-portal/request-link",
        json={"email": "LOGIN@example.com"},
    )
    assert response.status_code == 202
    assert "sera envoyé" in response.json()["message"]
    assert "token" not in response.json()["message"]
    assert delivered["email"] == "login@example.com"
    assert delivered["purpose"] == PURPOSE_LOGIN

    login_token = _token_from_url(delivered["link"])
    claims = decode_supplier_link(login_token)
    assert claims is not None
    assert claims["purpose"] == PURPOSE_LOGIN
    assert claims["exp"] - claims["iat"] == settings.supplier_magic_link_ttl_minutes * 60

    login_invitation = (await db_session.execute(
        select(SupplierInvitation).where(SupplierInvitation.jti_hash == hash_jti(claims["jti"]))
    )).scalar_one()
    assert login_invitation.purpose == PURPOSE_LOGIN
    assert login_invitation.sent_at is not None

    accepted_login = await client.post("/api/v1/supplier-portal/accept-link", json={"token": login_token})
    assert accepted_login.status_code == 200, accepted_login.text
    replay = await client.post("/api/v1/supplier-portal/accept-link", json={"token": login_token})
    assert replay.status_code == 401

    # L'endpoint public retourne le même message pour une adresse inconnue.
    unknown = await client.post(
        "/api/v1/supplier-portal/request-link",
        json={"email": "absent@example.com"},
    )
    assert unknown.status_code == 202
    assert unknown.json() == response.json()


@pytest.mark.asyncio
async def test_supplier_cannot_access_operator_business_routes(client, monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", None)
    operator_headers = await _register_operator(client, "portal-admin-3@example.com")
    supplier = await _make_supplier(client, operator_headers, email="restricted@example.com")
    invitation = await _invite(client, operator_headers, supplier["id"])
    accepted = await client.post(
        "/api/v1/supplier-portal/accept-link",
        json={"token": _token_from_url(invitation["invitation_url"])},
    )
    assert accepted.status_code == 200
    supplier_headers = {"Authorization": f"Bearer {accepted.json()['access_token']}"}

    supplier_b = await _make_supplier(
        client, operator_headers, email="restricted-b@example.com", name="Fournisseur B"
    )
    invitation_b = await _invite(client, operator_headers, supplier_b["id"])
    accepted_b = await client.post(
        "/api/v1/supplier-portal/accept-link",
        json={"token": _token_from_url(invitation_b["invitation_url"])},
    )
    assert accepted_b.status_code == 200
    supplier_b_headers = {"Authorization": f"Bearer {accepted_b.json()['access_token']}"}

    blocked_gets = [
        "/api/v1/suppliers",
        "/api/v1/products",
        "/api/v1/shipments",
        "/api/v1/plots",
        "/api/v1/dashboard/overview",
        "/api/v1/organizations/me",
        "/api/v1/organizations/stats",
        "/api/v1/audit-log",
        "/api/v1/users/",
        f"/api/v1/users/{accepted.json()['user']['id']}",
    ]
    for path in blocked_gets:
        response = await client.get(path, headers=supplier_headers)
        assert response.status_code == 403, f"{path}: {response.status_code} {response.text}"

    own_profile = await client.get("/api/v1/supplier-portal/me", headers=supplier_headers)
    other_profile = await client.get("/api/v1/supplier-portal/me", headers=supplier_b_headers)
    assert own_profile.json()["supplier_id"] == supplier["id"]
    assert other_profile.json()["supplier_id"] == supplier_b["id"]
    assert (await client.get(f"/api/v1/suppliers/{supplier_b['id']}", headers=supplier_headers)).status_code == 403
    assert (await client.patch(
        f"/api/v1/suppliers/{supplier_b['id']}",
        headers=supplier_headers,
        json={"name": "Modification interdite"},
    )).status_code == 403

    # Les référentiels publics ne révèlent aucune donnée de tenant.
    assert (await client.get("/api/v1/commodities", headers=supplier_headers)).status_code == 200
    assert (await client.get("/api/v1/users/me", headers=supplier_headers)).status_code == 200

    assert (await client.post(
        "/api/v1/products",
        headers=supplier_headers,
        json={"name": "Produit interdit", "commodity": "cocoa"},
    )).status_code == 403
    assert (await client.post(
        "/api/v1/suppliers",
        headers=supplier_headers,
        json={"name": "Autre fournisseur", "country": "CI", "supplier_type": "producer"},
    )).status_code == 403


@pytest.mark.asyncio
async def test_invitation_rotation_email_states_and_address_validation(client, db_session, monkeypatch):
    operator_email = "portal-admin-5@example.com"
    operator_headers = await _register_operator(client, operator_email)
    monkeypatch.setattr(settings, "smtp_host", None)

    missing = await client.post(
        "/api/v1/suppliers",
        headers=operator_headers,
        json={"name": "Sans email", "country": "CI", "supplier_type": "producer"},
    )
    assert missing.status_code == 201
    no_address = await client.post(
        f"/api/v1/suppliers/{missing.json()['id']}/invite",
        headers=operator_headers,
    )
    assert no_address.status_code == 422

    conflicting = await _make_supplier(
        client, operator_headers, email=operator_email, name="Email déjà opérateur"
    )
    conflict_response = await client.post(
        f"/api/v1/suppliers/{conflicting['id']}/invite",
        headers=operator_headers,
    )
    assert conflict_response.status_code == 409

    supplier = await _make_supplier(
        client, operator_headers, email="rotation@example.com", name="Fournisseur Rotation"
    )
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    deliveries = ["failed", "sent"]

    async def fake_deliver(email: str, supplier_name: str, link: str, purpose: str) -> str:
        return deliveries.pop(0)

    monkeypatch.setattr(suppliers_endpoint, "deliver_supplier_link", fake_deliver)
    first = await _invite(client, operator_headers, supplier["id"])
    assert first["delivery_status"] == "email_failed"
    assert first["invitation_url"]
    first_token = _token_from_url(first["invitation_url"])
    first_claims = decode_supplier_link(first_token)
    assert first_claims is not None

    first_row = (await db_session.execute(
        select(SupplierInvitation).where(SupplierInvitation.jti_hash == hash_jti(first_claims["jti"]))
    )).scalar_one()
    assert first_row.sent_at is None

    second = await _invite(client, operator_headers, supplier["id"])
    assert second["delivery_status"] == "email_sent"
    assert second["invitation_url"] is None
    second_row = (await db_session.execute(
        select(SupplierInvitation).where(SupplierInvitation.id == second["invitation_id"])
    )).scalar_one()
    assert first_row.revoked_at is not None
    assert second_row.sent_at is not None
    supplier_row = (await db_session.execute(
        select(Supplier).where(Supplier.id == supplier["id"])
    )).scalar_one()
    assert supplier_row.invite_sent_at is not None

    replay_old = await client.post(
        "/api/v1/supplier-portal/accept-link", json={"token": first_token}
    )
    assert replay_old.status_code == 401
    events = await client.get(
        "/api/v1/audit-log", headers=operator_headers,
        params={"object_type": "supplier", "object_id": supplier["id"]},
    )
    serialized_events = str(events.json())
    assert first_token not in serialized_events
    assert "supplier.invitation_revoked" in {event["action"] for event in events.json()["items"]}


@pytest.mark.asyncio
async def test_expired_or_tampered_supplier_links_are_rejected(client, monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", None)
    operator_headers = await _register_operator(client, "portal-admin-4@example.com")
    supplier = await _make_supplier(client, operator_headers, email="expiry@example.com")
    invitation = await _invite(client, operator_headers, supplier["id"])

    tampered = _token_from_url(invitation["invitation_url"]) + "x"
    rejected_tamper = await client.post("/api/v1/supplier-portal/accept-link", json={"token": tampered})
    assert rejected_tamper.status_code == 401

    expired_token, _, _ = issue_supplier_link(
        supplier_id=UUID(supplier["id"]),
        organization_id=UUID(decode_supplier_link(_token_from_url(invitation["invitation_url"]))["org_id"]),
        email="expiry@example.com",
        purpose=PURPOSE_INVITATION,
        now=datetime.now(timezone.utc) - timedelta(hours=settings.supplier_invitation_ttl_hours + 1),
    )
    assert decode_supplier_link(expired_token) is None
    expired = await client.post("/api/v1/supplier-portal/accept-link", json={"token": expired_token})
    assert expired.status_code == 401
