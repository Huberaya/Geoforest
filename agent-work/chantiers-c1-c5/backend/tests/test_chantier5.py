"""Tests C5 : dépistage prudent, provenance, absence de repli simulé et isolation tenant."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models import User, UserRole
from app.services.satellite import deforestation_screening as screening

GOOD_POLYGON = {
    "type": "Polygon",
    "coordinates": [[
        [2.500001, 9.500001],
        [2.503001, 9.500001],
        [2.503001, 9.503001],
        [2.500001, 9.503001],
        [2.500001, 9.500001],
    ]],
}
POINT = {"type": "Point", "coordinates": [2.500001, 9.500001]}


@pytest.fixture(autouse=True)
def reset_shared_api_rate_limit():
    # Le middleware utilise un compteur global par IP; isoler ces tests chargés du reste de la suite.
    from app.core.rate_limiter import api_limiter

    api_limiter.reset("127.0.0.1")
    yield
    api_limiter.reset("127.0.0.1")


@pytest.fixture
async def auth_headers(client):
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "c5@test.com",
            "password": "TestPass2026!",
            "first_name": "Analyste",
            "last_name": "C5",
            "organization_name": "Forêt C5",
        },
    )
    assert response.status_code in (200, 201), response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _supplier(client, headers, name="Fournisseur C5"):
    response = await client.post(
        "/api/v1/suppliers",
        headers=headers,
        json={"name": name, "supplier_type": "producer", "country": "CI"},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _product(client, headers, name="Cacao C5", commodity="cocoa"):
    response = await client.post(
        "/api/v1/products", headers=headers,
        json={"name": name, "commodity": commodity},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _plot(client, headers, geometry=GOOD_POLYGON, ref="LOT-C5"):
    supplier = await _supplier(client, headers, f"Fournisseur {ref}")
    product = await _product(client, headers, f"Produit {ref}")
    shipment_response = await client.post(
        "/api/v1/shipments", headers=headers,
        json={"reference": ref, "supplier_id": supplier["id"], "product_id": product["id"]},
    )
    assert shipment_response.status_code == 201, shipment_response.text
    plot_response = await client.post(
        "/api/v1/plots", headers=headers,
        json={"shipment_id": shipment_response.json()["id"], "name": ref, "geojson": geometry},
    )
    assert plot_response.status_code == 201, plot_response.text
    return plot_response.json()


def test_loss_year_decoder_handles_legend_codes_and_mapped_years():
    assert screening._decode_year(1) == 2001
    assert screening._decode_year(25) == 2025
    assert screening._decode_year(2021) == 2021
    assert screening._decode_year("2021.0") == 2021


def test_threshold_percentages_use_the_v113_legend_codes(monkeypatch):
    assert "umd_tree_cover_density_2000__threshold = 1" in screening._sql_for_threshold(10)
    assert "umd_tree_cover_density_2000__threshold = 5" in screening._sql_for_threshold(30)
    with pytest.raises(ValueError, match="10 % et 30 %"):
        screening._sql_for_threshold(20)

    monkeypatch.setattr(settings, "gfw_dataset_version", "v1.12")
    with pytest.raises(screening.GFWProviderError, match="GFW_THRESHOLD_MAPPING_UNVERIFIED"):
        screening._sql_for_threshold(10)


def test_malformed_provider_payload_cannot_be_misread_as_no_signal():
    with pytest.raises(screening.GFWProviderError, match="GFW_INVALID_RESPONSE"):
        screening._extract_rows({"status": "success"})
    with pytest.raises(screening.GFWProviderError, match="GFW_INVALID_RESPONSE"):
        screening._normalize_rows([{"unexpected": "shape"}])


@pytest.mark.asyncio
async def test_empty_success_is_no_signal_not_compliance(monkeypatch):
    monkeypatch.setattr(settings, "gfw_live_enabled", True)
    monkeypatch.setattr(settings, "gfw_contract_verified", True)
    monkeypatch.setattr(settings, "gfw_api_key", "test-key")

    async def fake_query(_geometry, _threshold):
        return {}

    monkeypatch.setattr(screening, "query_gfw_yearly_loss", fake_query)
    outcome = await screening.screen_plot(GOOD_POLYGON, 10.0)
    assert outcome.status == screening.ScreeningStatus.no_signal_observed
    assert outcome.review_required is True
    assert not hasattr(outcome, "compliant")
    assert "ne prouve pas" in outcome.message


@pytest.mark.asyncio
async def test_signal_after_cutoff_is_flagged_and_year_2021_is_uncertain(monkeypatch):
    monkeypatch.setattr(settings, "gfw_live_enabled", True)
    monkeypatch.setattr(settings, "gfw_contract_verified", True)
    monkeypatch.setattr(settings, "gfw_api_key", "test-key")

    async def fake_query(_geometry, threshold):
        if threshold == 10:
            return {2020: 0.2, 2021: 0.1, 2023: 0.4}
        return {2020: 0.05, 2021: 0.02}

    monkeypatch.setattr(screening, "query_gfw_yearly_loss", fake_query)
    outcome = await screening.screen_plot(GOOD_POLYGON, 10.0)

    assert outcome.status == screening.ScreeningStatus.signal_post_2020
    assert outcome.review_required is True
    assert outcome.first_post_cutoff_year_10pct == 2021
    assert outcome.boundary_year_uncertainty is True
    assert outcome.pre_cutoff_loss_ha_10pct == pytest.approx(0.2)
    assert outcome.post_cutoff_loss_ha_10pct == pytest.approx(0.5)
    assert outcome.post_cutoff_loss_ha_30pct == pytest.approx(0.02)
    assert not hasattr(outcome, "compliant")
    assert not hasattr(outcome, "confidence_score")


@pytest.mark.asyncio
async def test_point_geometry_is_not_buffered_or_sent_to_provider(monkeypatch):
    async def should_not_call_provider(*_args, **_kwargs):
        raise AssertionError("Un point ne doit pas être bufferisé ni interrogé pour le MVP C5.")

    monkeypatch.setattr(screening, "query_gfw_yearly_loss", should_not_call_provider)
    outcome = await screening.screen_plot(POINT, 2.0)
    assert outcome.status == screening.ScreeningStatus.non_evaluable
    assert outcome.error_code == "POLYGON_REQUIRED_FOR_SCREENING"
    assert "aucun tampon" in outcome.message


@pytest.mark.asyncio
async def test_unconfigured_provider_returns_explicit_unavailable_not_mock(monkeypatch):
    monkeypatch.setattr(settings, "gfw_live_enabled", False)
    monkeypatch.setattr(settings, "gfw_api_key", "")
    outcome = await screening.screen_plot(GOOD_POLYGON, 10.0)
    assert outcome.status == screening.ScreeningStatus.source_unavailable
    assert outcome.error_code == "GFW_NOT_CONFIGURED"
    assert outcome.loss_by_year == ()
    assert outcome.post_cutoff_loss_ha_10pct is None
    assert "simulé" in outcome.message


@pytest.mark.asyncio
async def test_live_provider_requires_explicit_contract_verification(monkeypatch):
    monkeypatch.setattr(settings, "gfw_live_enabled", True)
    monkeypatch.setattr(settings, "gfw_api_key", "test-key")
    monkeypatch.setattr(settings, "gfw_contract_verified", False)

    async def must_not_call_provider(*_args, **_kwargs):
        raise AssertionError("Aucun appel live avant validation explicite du contrat.")

    monkeypatch.setattr(screening, "query_gfw_yearly_loss", must_not_call_provider)
    outcome = await screening.screen_plot(GOOD_POLYGON, 10.0)
    assert outcome.status == screening.ScreeningStatus.source_unavailable
    assert outcome.error_code == "GFW_CONTRACT_NOT_VERIFIED"
    assert outcome.loss_by_year == ()


@pytest.mark.asyncio
async def test_provider_uses_pinned_json_route_and_no_redirect(monkeypatch):
    monkeypatch.setattr(settings, "gfw_live_enabled", True)
    monkeypatch.setattr(settings, "gfw_contract_verified", True)
    monkeypatch.setattr(settings, "gfw_api_key", "unit-test-secret")
    monkeypatch.setattr(settings, "gfw_dataset_version", "v1.13")
    calls = []

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {
                "data": [
                    {"umd_tree_cover_loss__year": 2021, "area__ha": 0.75},
                ],
                "status": "success",
            }

    class FakeClient:
        def __init__(self, **kwargs):
            calls.append({"client_kwargs": kwargs})

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, *, headers, json):
            calls.append({"url": url, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(screening.httpx, "AsyncClient", FakeClient)
    rows = await screening.query_gfw_yearly_loss(GOOD_POLYGON, 10)

    request = next(call for call in calls if "url" in call)
    assert request["url"].endswith("/dataset/umd_tree_cover_loss/v1.13/query/json")
    assert calls[0]["client_kwargs"]["follow_redirects"] is False
    assert request["json"]["geometry"]["type"] == "Polygon"
    assert "umd_tree_cover_density_2000__threshold = 1" in request["json"]["sql"]
    assert rows == {2021: 0.75}
    assert "unit-test-secret" not in str(rows)


@pytest.mark.asyncio
async def test_deprecated_redirect_is_an_error_not_a_followed_source_result(monkeypatch):
    monkeypatch.setattr(settings, "gfw_live_enabled", True)
    monkeypatch.setattr(settings, "gfw_contract_verified", True)
    monkeypatch.setattr(settings, "gfw_api_key", "unit-test-secret")

    class RedirectResponse:
        status_code = 308

    class RedirectClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, *_args, **_kwargs):
            return RedirectResponse()

    monkeypatch.setattr(screening.httpx, "AsyncClient", RedirectClient)
    with pytest.raises(screening.GFWProviderError, match="GFW_LEGACY_REDIRECT"):
        await screening.query_gfw_yearly_loss(GOOD_POLYGON, 10)


@pytest.mark.asyncio
async def test_api_persists_source_unavailable_in_audit_and_keeps_plot_valid(
    client, auth_headers, db_session, monkeypatch
):
    monkeypatch.setattr(settings, "gfw_live_enabled", False)
    monkeypatch.setattr(settings, "gfw_api_key", "")
    monkeypatch.setattr(settings, "gfw_contract_verified", False)
    plot = await _plot(client, auth_headers)
    response = await client.post(
        f"/api/v1/plots/{plot['id']}/deforestation-screenings",
        headers=auth_headers,
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "source_unavailable"
    assert data["post_cutoff_loss_ha_10pct"] is None
    assert "compliant" not in data
    assert "confidence_score" not in data
    assert data["dataset_version"] == "v1.13"

    history = await client.get(
        f"/api/v1/plots/{plot['id']}/deforestation-screenings",
        headers=auth_headers,
    )
    assert history.status_code == 200
    assert history.json()["total"] == 1
    assert history.json()["items"][0]["screening_id"] == data["screening_id"]

    audit = await client.get(
        "/api/v1/audit-log", headers=auth_headers,
        params={"object_type": "plot", "object_id": plot["id"]},
    )
    screening_event = next(
        event for event in audit.json()["items"]
        if event["action"] == "plot.deforestation_screened"
    )
    assert screening_event["actor_email"] == "c5@test.com"
    assert screening_event["ip_address"]
    assert screening_event["previous_data"] is None
    assert screening_event["new_data"]["screening_id"] == data["screening_id"]
    assert screening_event["new_data"]["error_code"] == "GFW_NOT_CONFIGURED"

    plot_after = await client.get(f"/api/v1/plots/{plot['id']}", headers=auth_headers)
    assert plot_after.json()["status"] == "valid"


@pytest.mark.asyncio
async def test_api_screening_is_tenant_isolated(client, auth_headers):
    plot = await _plot(client, auth_headers, ref="LOT-ISOLATED")
    other = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "other-c5@test.com",
            "password": "TestPass2026!",
            "organization_name": "Autre C5",
        },
    )
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    run = await client.post(
        f"/api/v1/plots/{plot['id']}/deforestation-screenings",
        headers=other_headers,
    )
    assert run.status_code == 404
    history = await client.get(
        f"/api/v1/plots/{plot['id']}/deforestation-screenings",
        headers=other_headers,
    )
    assert history.status_code == 404
    candidates = await client.get("/api/v1/deforestation-screenings/candidates", headers=other_headers)
    assert candidates.status_code == 200
    assert candidates.json()["total"] == 0


@pytest.mark.asyncio
async def test_api_screening_success_records_signal_and_second_run_previous_snapshot(client, auth_headers, monkeypatch):
    plot = await _plot(client, auth_headers, ref="LOT-SUCCESS")
    monkeypatch.setattr(settings, "gfw_live_enabled", True)
    monkeypatch.setattr(settings, "gfw_contract_verified", True)
    monkeypatch.setattr(settings, "gfw_api_key", "test-key")

    async def fake_query(_geometry, threshold):
        return {2021: 0.1} if threshold == 10 else {2021: 0.04}

    monkeypatch.setattr(screening, "query_gfw_yearly_loss", fake_query)
    first = await client.post(
        f"/api/v1/plots/{plot['id']}/deforestation-screenings", headers=auth_headers
    )
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "signal_post_2020"
    assert first.json()["boundary_year_uncertainty"] is True

    second = await client.post(
        f"/api/v1/plots/{plot['id']}/deforestation-screenings", headers=auth_headers
    )
    assert second.status_code == 200, second.text
    assert second.json()["screening_id"] != first.json()["screening_id"]

    history = await client.get(
        f"/api/v1/plots/{plot['id']}/deforestation-screenings", headers=auth_headers
    )
    assert history.json()["total"] == 2
    assert history.json()["items"][0]["screening_id"] == second.json()["screening_id"]

    audit = await client.get(
        "/api/v1/audit-log", headers=auth_headers,
        params={"object_type": "plot", "object_id": plot["id"]},
    )
    screening_events = [event for event in audit.json()["items"] if event["action"] == "plot.deforestation_screened"]
    assert len(screening_events) == 2
    assert screening_events[0]["previous_data"]["screening_id"] == first.json()["screening_id"]
    assert screening_events[0]["new_data"]["screening_id"] == second.json()["screening_id"]


@pytest.mark.asyncio
async def test_viewer_cannot_launch_screening(client, auth_headers, db_session):
    plot = await _plot(client, auth_headers, ref="LOT-VIEWER")
    user = (await db_session.execute(
        select(User).where(User.email == "c5@test.com")
    )).scalar_one()
    user.role = UserRole.viewer
    await db_session.commit()
    response = await client.post(
        f"/api/v1/plots/{plot['id']}/deforestation-screenings", headers=auth_headers
    )
    assert response.status_code == 403
