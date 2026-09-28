"""API regressions for the risk/DDR workflow, RBAC, tenant scope and internal prefill."""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Organization, User, UserRole

pytestmark = pytest.mark.asyncio


async def _register(client: AsyncClient, email: str, organization: str) -> dict:
    response = await client.post("/api/v1/auth/register", json={
        "email": email,
        "password": "TestPass2026!",
        "first_name": "Test",
        "last_name": "DDR",
        "organization_name": organization,
        "organization_country": "FR",
        "eori": "FR12345678901234",
    })
    assert response.status_code == 201, response.text
    return response.json()


async def _make_shipment(client: AsyncClient, headers: dict[str, str], suffix: str = "A", **overrides) -> dict:
    supplier_response = await client.post("/api/v1/suppliers", headers=headers, json={
        "name": f"Coop {suffix}", "country": "CI", "supplier_type": "cooperative",
    })
    assert supplier_response.status_code == 201, supplier_response.text
    product_response = await client.post("/api/v1/products", headers=headers, json={
        "name": f"Cacao {suffix}", "commodity": "cocoa", "description": "Fèves de cacao fermentées",
    })
    assert product_response.status_code == 201, product_response.text
    shipment_response = await client.post("/api/v1/shipments", headers=headers, json={
        "reference": f"DDR-{suffix}",
        "supplier_id": supplier_response.json()["id"],
        "product_id": product_response.json()["id"],
        "quantity": 100,
        "unit": "kg",
        "country_of_production": "CI",
        **overrides,
    })
    assert shipment_response.status_code == 201, shipment_response.text
    return shipment_response.json()


async def _make_case(client: AsyncClient, headers: dict[str, str], shipment_id: str, **overrides) -> dict:
    payload = {
        "shipment_id": shipment_id,
        "economic_role": "unknown",
        "company_size": "unknown",
        "role_confirmed": False,
        "assessment_route": "full",
        **overrides,
    }
    response = await client.post("/api/v1/risk-cases", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def test_case_creation_seeds_unconfirmed_origin_and_audit_event(client: AsyncClient, db_session: AsyncSession):
    auth = await _register(client, "risk-admin@example.com", "Risk tenant")
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    shipment = await _make_shipment(client, headers)

    case = await _make_case(client, headers, shipment["id"])

    assert case["shipment_reference"] == "DDR-A"
    assert case["status"] == "draft"
    assert case["decision_state"] == "none"
    assert len(case["origins"]) == 1
    assert case["origins"][0]["country_code"] == "CI"
    assert case["origins"][0]["benchmark_level"] == "standard"
    assert case["origins"][0]["origin_confirmed"] is False
    assert len(case["findings"]) >= 10

    from app.models.audit import AuditEvent
    event = (await db_session.execute(select(AuditEvent).where(
        AuditEvent.organization_id == auth["user"]["organization_id"],
        AuditEvent.action == "risk_case.created",
    ))).scalars().first()
    assert event is not None
    assert event.actor_user_id is not None
    assert event.ip_address
    assert event.new_data["shipment_id"] == shipment["id"]


async def test_case_and_shipment_are_tenant_scoped(client: AsyncClient):
    a = await _register(client, "risk-a@example.com", "Risk A")
    b = await _register(client, "risk-b@example.com", "Risk B")
    headers_a = {"Authorization": f"Bearer {a['access_token']}"}
    headers_b = {"Authorization": f"Bearer {b['access_token']}"}
    shipment_a = await _make_shipment(client, headers_a, "A2")
    case_a = await _make_case(client, headers_a, shipment_a["id"])

    hidden_case = await client.get(f"/api/v1/risk-cases/{case_a['id']}", headers=headers_b)
    forbidden_source = await client.post("/api/v1/risk-cases", headers=headers_b, json={
        "shipment_id": shipment_a["id"], "economic_role": "unknown", "company_size": "unknown",
        "role_confirmed": False, "assessment_route": "full",
    })
    hidden_list = await client.get("/api/v1/risk-cases", headers=headers_b)
    assert hidden_case.status_code == 404
    assert forbidden_source.status_code == 404
    assert hidden_list.status_code == 200 and hidden_list.json()["total"] == 0


async def test_viewer_can_read_but_cannot_create_case(client: AsyncClient, db_session: AsyncSession):
    auth = await _register(client, "risk-viewer@example.com", "Viewer tenant")
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    shipment = await _make_shipment(client, headers, "VIEW")
    user = (await db_session.execute(select(User).where(User.email == "risk-viewer@example.com"))).scalar_one()
    user.role = UserRole.viewer
    await db_session.flush()

    listing = await client.get("/api/v1/risk-cases", headers=headers)
    create = await client.post("/api/v1/risk-cases", headers=headers, json={
        "shipment_id": shipment["id"], "economic_role": "unknown", "company_size": "unknown",
        "role_confirmed": False, "assessment_route": "full",
    })
    assert listing.status_code == 200
    assert create.status_code == 403


async def test_viewer_does_not_receive_precise_plot_data(client: AsyncClient, db_session: AsyncSession):
    auth = await _register(client, "risk-plot-viewer@example.com", "Plot viewer tenant")
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    shipment = await _make_shipment(client, headers, "GEO")
    plot_response = await client.post("/api/v1/plots", headers=headers, json={
        "shipment_id": shipment["id"],
        "name": "Producteur sensible",
        "internal_ref": "FERME-001",
        "geojson": {"type": "Point", "coordinates": [2.123456, 48.123456]},
    })
    assert plot_response.status_code == 201, plot_response.text
    plot = plot_response.json()
    assert plot["geometry"] is not None
    case = await _make_case(client, headers, shipment["id"])
    assert case["origins"][0]["plot_id"] == plot["id"]
    preparation_response = await client.post(
        f"/api/v1/risk-cases/{case['id']}/declaration-preparations",
        headers=headers,
        json={"confirm_internal_prefill_only": True},
    )
    assert preparation_response.status_code == 201, preparation_response.text
    preparation = preparation_response.json()["declaration_preparations"][-1]
    delete_linked_plot = await client.delete(f"/api/v1/plots/{plot['id']}", headers=headers)
    assert delete_linked_plot.status_code == 409

    user = (await db_session.execute(select(User).where(User.email == "risk-plot-viewer@example.com"))).scalar_one()
    user.role = UserRole.viewer
    await db_session.flush()
    viewer_plot = await client.get(f"/api/v1/plots/{plot['id']}", headers=headers)
    viewer_case = await client.get(f"/api/v1/risk-cases/{case['id']}", headers=headers)
    assert viewer_plot.status_code == 200
    assert viewer_plot.json()["geo_data_redacted"] is True
    assert viewer_plot.json()["geometry"] is None
    assert viewer_plot.json()["centroid"] is None
    assert viewer_plot.json()["name"] is None
    assert viewer_case.status_code == 200
    assert viewer_case.json()["origins"][0]["plot_id"] is None
    assert viewer_case.json()["origins"][0]["plot_reference"] is None
    viewer_export = await client.get(
        f"/api/v1/risk-cases/{case['id']}/declaration-preparations/{preparation['id']}/export",
        headers=headers,
    )
    assert viewer_export.status_code == 403


async def test_article13_cannot_be_selected_without_documented_review(client: AsyncClient):
    auth = await _register(client, "risk-art13@example.com", "Article 13 tenant")
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    shipment = await _make_shipment(client, headers, "A13")
    response = await client.post("/api/v1/risk-cases", headers=headers, json={
        "shipment_id": shipment["id"], "economic_role": "unknown", "company_size": "unknown",
        "role_confirmed": False, "assessment_route": "article13_simplified",
    })
    assert response.status_code == 422
    assert response.json()["detail"] == "Données invalides"


async def test_article13_requires_confirmed_low_risk_origins(client: AsyncClient):
    auth = await _register(client, "risk-art13-low@example.com", "Article 13 low tenant")
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    shipment = await _make_shipment(client, headers, "A13LOW", country_of_production="GH")
    case = await _make_case(client, headers, shipment["id"])
    origin = case["origins"][0]

    confirmation = await client.patch(f"/api/v1/risk-cases/{case['id']}/origins/{origin['id']}", headers=headers, json={
        "origin_confirmed": True,
        "country_code": "GH",
        "location_description": "Exploitation identifiée et rapprochée de la pièce fournisseur.",
        "notes": "Confirmation recoupée avec plusieurs sources.",
    })
    assert confirmation.status_code == 200, confirmation.text
    route = await client.patch(f"/api/v1/risk-cases/{case['id']}", headers=headers, json={
        "assessment_route": "article13_simplified",
        "article13_complexity_assessed": True,
        "article13_mixing_assessed": True,
        "article13_assessment_note": "La chaîne courte et l'absence de mélange ont été documentées.",
    })
    assert route.status_code == 200, route.text
    assert route.json()["assessment_route"] == "article13_simplified"
    assert route.json()["origins"][0]["benchmark_level"] == "low"


async def test_no_or_negligible_decision_and_prefill_require_human_evidence(client: AsyncClient, db_session: AsyncSession):
    auth = await _register(client, "risk-complete@example.com", "Complete DDR tenant")
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    organization = await db_session.get(Organization, auth["user"]["organization_id"])
    assert organization is not None
    organization.address = "10 rue des Forêts, 44000 Nantes"
    await db_session.flush()
    shipment = await _make_shipment(client, headers, "COMPLETE", harvest_date="2026-08-15")
    case = await _make_case(client, headers, shipment["id"])

    premature = await client.post(f"/api/v1/risk-cases/{case['id']}/decisions", headers=headers, json={
        "outcome": "no_or_negligible", "rationale": "Une décision prématurée ne doit pas être acceptée.",
    })
    assert premature.status_code == 409
    assert premature.json()["detail"]["missing"]

    origin = case["origins"][0]
    updated = await client.patch(f"/api/v1/risk-cases/{case['id']}/origins/{origin['id']}", headers=headers, json={
        "origin_confirmed": True,
        "country_code": "CI",
        "location_description": "Zone de production identifiée par l'équipe achats.",
        "notes": "Confirmation recoupée avec la coopérative.",
    })
    assert updated.status_code == 200, updated.text
    updated = await client.patch(f"/api/v1/risk-cases/{case['id']}", headers=headers, json={
        "economic_role": "operator",
        "company_size": "medium",
        "role_confirmed": True,
        "role_confirmation_note": "Rôle et taille confirmés par le responsable conformité.",
        "product_scope_status": "confirmed_in_scope",
        "product_scope_note": "Code et description contrôlés sur l'Annexe I.",
    })
    assert updated.status_code == 200, updated.text

    for evidence_type in ("deforestation_free", "legality"):
        evidence_response = await client.post(f"/api/v1/risk-cases/{case['id']}/evidence", headers=headers, json={
            "evidence_type": evidence_type,
            "title": f"Source {evidence_type}",
            "summary": "Document examiné et pertinent pour le lot en cours.",
            "source_reference": f"REF-{evidence_type}",
        })
        assert evidence_response.status_code == 201, evidence_response.text
        evidence = next(item for item in evidence_response.json()["evidence_items"] if item["title"] == f"Source {evidence_type}")
        review_response = await client.patch(
            f"/api/v1/risk-cases/{case['id']}/evidence/{evidence['id']}",
            headers=headers,
            json={"review_status": "reviewed", "review_note": "Revue de cohérence effectuée."},
        )
        assert review_response.status_code == 200, review_response.text

    current = await client.get(f"/api/v1/risk-cases/{case['id']}", headers=headers)
    for finding in current.json()["findings"]:
        response = await client.patch(
            f"/api/v1/risk-cases/{case['id']}/findings/{finding['criterion']}",
            headers=headers,
            json={"assessment_status": "no_concern_identified", "rationale": "Examen documenté sans élément de préoccupation."},
        )
        assert response.status_code == 200, response.text

    decision = await client.post(f"/api/v1/risk-cases/{case['id']}/decisions", headers=headers, json={
        "outcome": "no_or_negligible",
        "rationale": "Les éléments documentés permettent cette décision humaine motivée.",
        "conditions_or_follow_up": "Réexamen annuel ou si une nouvelle information est reçue.",
    })
    assert decision.status_code == 200, decision.text
    assert decision.json()["decision_state"] == "current"
    assert decision.json()["decision_outcome"] == "no_or_negligible"

    preparation_response = await client.post(
        f"/api/v1/risk-cases/{case['id']}/declaration-preparations",
        headers=headers,
        json={"confirm_internal_prefill_only": True},
    )
    assert preparation_response.status_code == 201, preparation_response.text
    preparation = preparation_response.json()["declaration_preparations"][-1]
    assert preparation["status"] == "prepared_for_declaration"
    assert preparation["missing_fields"] == []
    assert preparation["snapshot"]["product"]["harvest_date"] == "2026-08-15"
    assert preparation["snapshot"]["official_schema"] is False

    from app.models.audit import AuditEvent
    event = (await db_session.execute(select(AuditEvent).where(
        AuditEvent.action == "risk_decision.recorded",
        AuditEvent.organization_id == auth["user"]["organization_id"],
    ))).scalars().one()
    assert event.actor_user_id is not None and event.ip_address
    assert event.new_data["outcome"] == "no_or_negligible"


async def test_incomplete_prefill_is_created_with_internal_only_notice(client: AsyncClient, db_session: AsyncSession):
    auth = await _register(client, "risk-prefill@example.com", "Prefill tenant")
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    shipment = await _make_shipment(client, headers, "PREFILL")
    case = await _make_case(client, headers, shipment["id"])

    response = await client.post(
        f"/api/v1/risk-cases/{case['id']}/declaration-preparations",
        headers=headers,
        json={"confirm_internal_prefill_only": True},
    )
    assert response.status_code == 201, response.text
    preparation = response.json()["declaration_preparations"][-1]
    assert preparation["status"] == "incomplete"
    assert preparation["missing_fields"]
    assert any("Date de production" in item for item in preparation["missing_fields"])
    assert any("Taille réglementaire" in item for item in preparation["missing_fields"])
    assert preparation["snapshot"]["official_schema"] is False
    assert preparation["snapshot"]["submitted_to_eudr_information_system"] is False
    assert preparation["snapshot"]["due_diligence"]["evidence_references"] == []
    assert "n'est pas un format officiel" in preparation["snapshot"]["notice"]

    exported = await client.get(
        f"/api/v1/risk-cases/{case['id']}/declaration-preparations/{preparation['id']}/export",
        headers=headers,
    )
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("application/json")
    from app.models.audit import AuditEvent
    audit = (await db_session.execute(select(AuditEvent).where(
        AuditEvent.action == "declaration_preparation.exported",
        AuditEvent.object_id == preparation["id"],
    ))).scalars().one()
    assert audit.ip_address
    assert audit.new_data["sensitive_geodata_included"] is False

    changed = await client.patch(f"/api/v1/shipments/{shipment['id']}", headers=headers, json={"country_of_production": "GH"})
    assert changed.status_code == 200, changed.text
    stale_export = await client.get(
        f"/api/v1/risk-cases/{case['id']}/declaration-preparations/{preparation['id']}/export",
        headers=headers,
    )
    assert stale_export.status_code == 409
