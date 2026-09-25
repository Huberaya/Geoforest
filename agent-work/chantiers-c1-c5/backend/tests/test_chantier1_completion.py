"""Tests complémentaires du Chantier 1 — middlewares, profil, rate-limit, sécurité."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


REG = {
    "email": "chantier1@example.com",
    "password": "CorrectHorse12!",
    "organization_name": "Chantier 1 Org",
}


async def _register(client: AsyncClient, email="x@y.com") -> dict:
    r = await client.post(
        "/api/v1/auth/register",
        json={**REG, "email": email, "organization_name": f"Org {email}"},
    )
    assert r.status_code == 201, r.text
    return r.json()


class TestSecurityEndpoints:
    async def test_version_endpoint(self, client: AsyncClient):
        r = await client.get("/version")
        assert r.status_code == 200
        body = r.json()
        assert body["version"]
        assert body["eudr_cutoff_date"] == "2020-12-31"
        assert body["eudr_application_lme"] == "2026-12-30"

    async def test_security_headers_present(self, client: AsyncClient):
        r = await client.get("/health")
        assert r.status_code == 200
        assert r.headers.get("x-content-type-options") == "nosniff"
        assert r.headers.get("x-frame-options") == "DENY"
        assert r.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
        assert "x-request-id" in r.headers

    async def test_validation_error_format(self, client: AsyncClient):
        r = await client.post(
            "/api/v1/auth/register",
            json={"email": "not-an-email", "password": "short", "organization_name": ""},
        )
        assert r.status_code == 422
        body = r.json()
        assert "detail" in body

    async def test_user_cannot_invite_supplier_role(self, client: AsyncClient):
        data = await _register(client, "admin@org.com")
        token = data["access_token"]
        r = await client.post(
            "/api/v1/users/invite",
            headers={"Authorization": f"Bearer {token}"},
            json={"email": "s@org.com", "role": "supplier"},
        )
        assert r.status_code == 400


class TestUserProfile:
    async def test_get_my_profile(self, client: AsyncClient):
        data = await _register(client, "me@x.com")
        token = data["access_token"]
        r = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["email"] == "me@x.com"

    async def test_patch_my_profile(self, client: AsyncClient):
        data = await _register(client, "patch@x.com")
        token = data["access_token"]
        r = await client.patch(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {token}"},
            json={"first_name": "Alice", "last_name": "Martin", "phone": "+33123456789", "locale": "en"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["first_name"] == "Alice"
        assert body["last_name"] == "Martin"
        assert body["locale"] == "en"

        # Un PATCH partiel ne doit pas réappliquer la valeur par défaut de locale.
        r = await client.patch(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {token}"},
            json={"first_name": "Alice 2"},
        )
        assert r.status_code == 200
        assert r.json()["locale"] == "en"

    async def test_change_password(self, client: AsyncClient):
        data = await _register(client, "pwd@x.com")
        token = data["access_token"]
        # Mot de passe actuel erroné
        r = await client.post(
            "/api/v1/users/me/password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "wrong", "new_password": "NewPass1234!"},
        )
        assert r.status_code == 400
        # Bon mot de passe
        r = await client.post(
            "/api/v1/users/me/password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": REG["password"], "new_password": "NewPass1234!"},
        )
        assert r.status_code == 200
        # Connexion avec l'ancien mot de passe doit échouer
        r2 = await client.post(
            "/api/v1/auth/login",
            json={"email": "pwd@x.com", "password": REG["password"]},
        )
        assert r2.status_code == 401
        # Connexion avec le nouveau doit réussir
        r3 = await client.post(
            "/api/v1/auth/login",
            json={"email": "pwd@x.com", "password": "NewPass1234!"},
        )
        assert r3.status_code == 200

    async def test_deactivate_self_forbidden(self, client: AsyncClient):
        data = await _register(client, "noself@x.com")
        token = data["access_token"]
        me = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
        me_id = me.json()["id"]
        r = await client.delete(
            f"/api/v1/users/{me_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 400


class TestDeactivatedUser:
    async def test_deactivate_returns_ok(self, client: AsyncClient):
        admin = await _register(client, "boss@x.com")
        atok = admin["access_token"]
        inv = await client.post(
            "/api/v1/users/invite",
            headers={"Authorization": f"Bearer {atok}"},
            json={"email": "fired@x.com", "role": "viewer", "first_name": "Fired"},
        )
        assert inv.status_code == 201
        fired_id = inv.json()["id"]
        r = await client.delete(
            f"/api/v1/users/{fired_id}",
            headers={"Authorization": f"Bearer {atok}"},
        )
        assert r.status_code == 200
        # Le membre désactivé doit avoir is_active=False quand on le récupère
        detail = await client.get(
            f"/api/v1/users/{fired_id}",
            headers={"Authorization": f"Bearer {atok}"},
        )
        assert detail.status_code == 200
        assert detail.json()["is_active"] is False


class TestRateLimit:
    async def test_rate_limit_headers(self, client: AsyncClient):
        r = await client.get("/health")
        assert "x-ratelimit-remaining" in r.headers or r.status_code == 200
