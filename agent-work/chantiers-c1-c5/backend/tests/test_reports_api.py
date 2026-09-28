"""Tests C12 des synthèses et exports opérationnels."""
from __future__ import annotations

import uuid

import pytest

from app.core.security import create_access_token
from app.models import (
    DeclarationPreparation,
    Document,
    Plot,
    Product,
    RiskCase,
    Shipment,
    Supplier,
    User,
    UserRole,
)
from app.models.plots import PlotStatus
from app.models.suppliers import SupplierType

pytestmark = pytest.mark.asyncio


async def _register(client, email: str, organization_name: str) -> dict:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "ReportTestPass123!",
            "organization_name": organization_name,
            "organization_country": "FR",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_report_summary_and_supplier_csv_are_tenant_scoped_and_safe(client, db_session):
    tenant_a = await _register(client, "reports-a@example.com", "Tenant Rapports A")
    tenant_b = await _register(client, "reports-b@example.com", "Tenant Rapports B")
    org_a = uuid.UUID(tenant_a["user"]["organization_id"])
    org_b = uuid.UUID(tenant_b["user"]["organization_id"])

    supplier_a = Supplier(
        organization_id=org_a,
        name='=HYPERLINK("https://example.com")',
        country="FR",
        supplier_type=SupplierType.producer,
        contact_email="private-a@example.com",
    )
    supplier_b = Supplier(
        organization_id=org_b,
        name="Fournisseur secret B",
        country="BR",
    )
    db_session.add_all([supplier_a, supplier_b])
    await db_session.flush()

    overview = await client.get("/api/v1/reports/overview", headers=_headers(tenant_a["access_token"]))
    assert overview.status_code == 200, overview.text
    data = overview.json()
    suppliers_summary = next(item for item in data["datasets"] if item["key"] == "suppliers")
    assert suppliers_summary["total"] == 1
    assert data["notice"].startswith("Rapport de pilotage interne")

    exported = await client.get(
        "/api/v1/reports/export/suppliers",
        headers=_headers(tenant_a["access_token"]),
    )
    assert exported.status_code == 200, exported.text
    text = exported.content.decode("utf-8-sig")
    assert "'=HYPERLINK" in text  # protection contre l'injection de formules de tableur
    assert "Fournisseur secret B" not in text
    assert "private-a@example.com" not in text
    assert "contact_email" not in text
    assert exported.headers["cache-control"] == "no-store"


async def test_plot_csv_omits_precise_geometry_and_is_role_restricted(client, db_session):
    registered = await _register(client, "reports-plots@example.com", "Tenant Parcelles")
    organization_id = uuid.UUID(registered["user"]["organization_id"])
    supplier = Supplier(
        organization_id=organization_id,
        name="Fournisseur test",
        country="FR",
        supplier_type=SupplierType.producer,
    )
    product = Product(organization_id=organization_id, name="Café test", commodity="coffee")
    db_session.add_all([supplier, product])
    await db_session.flush()
    shipment = Shipment(
        organization_id=organization_id,
        reference="LOT-PLOT-01",
        supplier_id=supplier.id,
        product_id=product.id,
    )
    db_session.add(shipment)
    await db_session.flush()
    plot = Plot(
        organization_id=organization_id,
        shipment_id=shipment.id,
        internal_ref="PARCELLE-01",
        geometry={"type": "Point", "coordinates": [12.3456789, 50.1234567]},
        geometry_type="Point",
        area_ha=1.25,
        status=PlotStatus.valid,
    )
    db_session.add(plot)
    await db_session.flush()

    exported = await client.get(
        "/api/v1/reports/export/plots",
        headers=_headers(registered["access_token"]),
    )
    assert exported.status_code == 200, exported.text
    text = exported.content.decode("utf-8-sig")
    assert "PARCELLE-01" in text
    assert "LOT-PLOT-01" in text
    assert "12.3456789" not in text
    assert "50.1234567" not in text
    assert "coordinates" not in text

    user = await db_session.get(User, uuid.UUID(registered["user"]["id"]))
    assert user is not None
    user.role = UserRole.viewer
    await db_session.flush()
    viewer_token = create_access_token(user)
    denied = await client.get("/api/v1/reports/export/plots", headers=_headers(viewer_token))
    assert denied.status_code == 403


async def test_shipment_document_and_ddr_exports_exclude_free_text(client, db_session):
    registered = await _register(client, "reports-all@example.com", "Tenant Exports Complets")
    organization_id = uuid.UUID(registered["user"]["organization_id"])
    supplier = Supplier(
        organization_id=organization_id,
        name="Fournisseur rapport",
        country="FR",
        supplier_type=SupplierType.producer,
        notes="NOTE CONFIDENTIELLE FOURNISSEUR",
    )
    product = Product(
        organization_id=organization_id,
        name="Produit rapport",
        commodity="coffee",
        description="DESCRIPTION CONFIDENTIELLE",
    )
    db_session.add_all([supplier, product])
    await db_session.flush()
    shipment = Shipment(
        organization_id=organization_id,
        reference="LOT-REPORT-01",
        supplier_id=supplier.id,
        product_id=product.id,
        notes="NOTE CONFIDENTIELLE LOT",
    )
    db_session.add(shipment)
    await db_session.flush()
    document = Document(
        organization_id=organization_id,
        title="Permis de test",
        category="permit",
        description="NOTE CONFIDENTIELLE DOCUMENT",
    )
    db_session.add(document)
    case = RiskCase(
        organization_id=organization_id,
        shipment_id=shipment.id,
        case_reference="DDR-REPORT-01",
        status="prepared_for_declaration",
        decision_state="current",
        decision_outcome="no_or_negligible",
        decision_rationale="NOTE CONFIDENTIELLE DDR",
        regulatory_reference_version="test-reference-v1",
    )
    db_session.add(case)
    await db_session.flush()
    preparation = DeclarationPreparation(
        organization_id=organization_id,
        case_id=case.id,
        sequence_number=1,
        status="prepared_for_declaration",
        internal_format_version="internal-test-v1",
        snapshot={"internal": True},
        missing_fields=[],
    )
    db_session.add(preparation)
    await db_session.flush()

    for dataset in ("shipments", "documents", "ddr"):
        response = await client.get(
            f"/api/v1/reports/export/{dataset}",
            headers=_headers(registered["access_token"]),
        )
        assert response.status_code == 200, response.text
        text = response.content.decode("utf-8-sig")
        assert "NOTE CONFIDENTIELLE" not in text
        if dataset == "shipments":
            assert "LOT-REPORT-01" in text
        elif dataset == "documents":
            assert "Permis de test" in text
        else:
            assert "DDR-REPORT-01" in text
            assert "prepared_for_declaration" in text
            assert "declared" not in text.lower()

    overview = await client.get("/api/v1/reports/overview", headers=_headers(registered["access_token"]))
    ddr_summary = next(item for item in overview.json()["datasets"] if item["key"] == "ddr")
    assert ddr_summary["total"] == 1
    assert ddr_summary["preparations_total"] == 1
    assert ddr_summary["preparation_status_counts"] == {"prepared_for_declaration": 1}


async def test_supplier_role_cannot_access_operator_reports(client, db_session):
    registered = await _register(client, "reports-supplier@example.com", "Tenant Fournisseur")
    org_id = uuid.UUID(registered["user"]["organization_id"])
    portal_user = User(
        organization_id=org_id,
        email="portal-user@example.com",
        password_hash="test-hash",
        role=UserRole.supplier,
        is_active=True,
    )
    db_session.add(portal_user)
    await db_session.flush()
    token = create_access_token(portal_user)

    response = await client.get("/api/v1/reports/overview", headers=_headers(token))
    assert response.status_code == 403
