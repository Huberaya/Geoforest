"""Tests Chantier 2 : endpoint dashboard overview et alertes."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _register(client: AsyncClient, email: str) -> str:
    r = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "CorrectHorse12!",
            "organization_name": f"Org {email}",
        },
    )
    assert r.status_code == 201
    return r.json()["access_token"]


class TestDashboardOverview:
    async def test_overview_requires_auth(self, client: AsyncClient):
        r = await client.get("/api/v1/dashboard/overview")
        assert r.status_code == 401

    async def test_overview_shape(self, client: AsyncClient):
        tok = await _register(client, "dash@x.com")
        r = await client.get(
            "/api/v1/dashboard/overview",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 200
        body = r.json()
        assert "kpis" in body
        assert "recent_alerts" in body
        assert "onboarding" in body
        assert "generated_at" in body

        kpis = body["kpis"]
        # Seul users_count est peuplé au chantier 2
        assert kpis["users_count"] == 1
        assert kpis["suppliers_count"] == 0
        assert kpis["plots_total"] == 0
        assert "alerts_by_level" in kpis
        assert set(kpis["alerts_by_level"].keys()) == {"critical", "warning", "info", "success"}

        # La 1re visite crée les alertes d'onboarding
        assert isinstance(body["recent_alerts"], list)
        assert len(body["recent_alerts"]) >= 1
        welcome = next((a for a in body["recent_alerts"] if "Bienvenue" in a["title"]), None)
        assert welcome is not None
        assert welcome["is_read"] is False

        # Onboarding
        ob = body["onboarding"]
        assert ob["total"] == 6
        assert ob["completed"] == 0  # seul admin, pas d'invité
        assert any(s["key"] == "supplier" for s in ob["steps"])

    async def test_isolation_between_orgs(self, client: AsyncClient):
        a_tok = await _register(client, "a_dash@x.com")
        b_tok = await _register(client, "b_dash@x.com")

        a = await client.get(
            "/api/v1/dashboard/overview", headers={"Authorization": f"Bearer {a_tok}"}
        )
        b = await client.get(
            "/api/v1/dashboard/overview", headers={"Authorization": f"Bearer {b_tok}"}
        )
        a_alerts = {x["title"] for x in a.json()["recent_alerts"]}
        b_alerts = {x["title"] for x in b.json()["recent_alerts"]}
        # Chaque orga doit voir sa propre alerte de bienvenue
        assert a_alerts == b_alerts  # même contenu
        # Mais les IDs sont différents (id d'alerte distincts par org)
        a_ids = {x["id"] for x in a.json()["recent_alerts"]}
        b_ids = {x["id"] for x in b.json()["recent_alerts"]}
        assert a_ids.isdisjoint(b_ids)

    async def test_mark_alert_read(self, client: AsyncClient):
        tok = await _register(client, "alertread@x.com")
        ov = await client.get(
            "/api/v1/dashboard/overview", headers={"Authorization": f"Bearer {tok}"}
        )
        alert_id = ov.json()["recent_alerts"][0]["id"]
        r = await client.post(
            f"/api/v1/dashboard/alerts/{alert_id}/read",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r.status_code == 200
        # Recharger le dashboard et vérifier qu'elle est lue
        ov2 = await client.get(
            "/api/v1/dashboard/overview", headers={"Authorization": f"Bearer {tok}"}
        )
        a = next(x for x in ov2.json()["recent_alerts"] if x["id"] == alert_id)
        assert a["is_read"] is True

    async def test_mark_other_org_alert_404(self, client: AsyncClient):
        a_tok = await _register(client, "orgA@x.com")
        b_tok = await _register(client, "orgB@x.com")
        ov = await client.get(
            "/api/v1/dashboard/overview", headers={"Authorization": f"Bearer {a_tok}"}
        )
        a_alert_id = ov.json()["recent_alerts"][0]["id"]
        r = await client.post(
            f"/api/v1/dashboard/alerts/{a_alert_id}/read",
            headers={"Authorization": f"Bearer {b_tok}"},
        )
        assert r.status_code == 404
