"""Tests C7 API : isolation des tenants, portail fournisseur, upload, dashboard et associations."""
from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.security import create_access_token
from app.models import Document, DocumentLink, Organization, User, UserRole
from app.models.audit import AuditEvent
from app.models.suppliers import Supplier, SupplierStatus, SupplierType


def _auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user)}"}


async def _organization_user(db_session, *, email: str, role: UserRole = UserRole.admin):
    organization = Organization(name=f"Org {uuid.uuid4().hex[:8]}", country="FR")
    db_session.add(organization)
    await db_session.flush()
    user = User(
        organization_id=organization.id,
        email=email,
        role=role,
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()
    return organization, user


@pytest.mark.asyncio
async def test_document_lists_are_tenant_scoped(client, db_session) -> None:
    org_a, user_a = await _organization_user(db_session, email=f"a-{uuid.uuid4().hex}@test.local")
    org_b, user_b = await _organization_user(db_session, email=f"b-{uuid.uuid4().hex}@test.local")
    doc_a = Document(organization_id=org_a.id, created_by_user_id=user_a.id, title="Pièce A", category="permit")
    doc_b = Document(organization_id=org_b.id, created_by_user_id=user_b.id, title="Pièce B", category="permit")
    db_session.add_all([doc_a, doc_b])
    await db_session.flush()

    response_a = await client.get("/api/v1/documents", headers=_auth(user_a))
    response_b = await client.get("/api/v1/documents", headers=_auth(user_b))
    assert response_a.status_code == 200
    assert [item["title"] for item in response_a.json()["items"]] == ["Pièce A"]
    assert response_b.status_code == 200
    assert [item["title"] for item in response_b.json()["items"]] == ["Pièce B"]


@pytest.mark.asyncio
async def test_supplier_portal_only_lists_documents_for_its_own_profile(client, db_session) -> None:
    organization, operator = await _organization_user(db_session, email=f"op-{uuid.uuid4().hex}@test.local")
    supplier_a = Supplier(
        organization_id=organization.id, name="Supplier A", country="CI",
        supplier_type=SupplierType.producer, status=SupplierStatus.active, portal_enabled=True,
    )
    supplier_b = Supplier(
        organization_id=organization.id, name="Supplier B", country="GH",
        supplier_type=SupplierType.producer, status=SupplierStatus.active, portal_enabled=True,
    )
    db_session.add_all([supplier_a, supplier_b])
    await db_session.flush()
    supplier_user = User(
        organization_id=organization.id,
        supplier_id=supplier_a.id,
        email=f"supplier-{uuid.uuid4().hex}@test.local",
        role=UserRole.supplier,
        is_active=True,
    )
    db_session.add(supplier_user)
    await db_session.flush()

    visible = Document(
        organization_id=organization.id, created_by_user_id=operator.id,
        title="Pièce fournisseur A", category="permit", supplier_visible=True,
    )
    hidden = Document(
        organization_id=organization.id, created_by_user_id=operator.id,
        title="Pièce interne A", category="permit", supplier_visible=False,
        description="Note strictement interne",
    )
    other = Document(
        organization_id=organization.id, created_by_user_id=operator.id,
        title="Pièce fournisseur B", category="permit", supplier_visible=True,
    )
    db_session.add_all([visible, hidden, other])
    await db_session.flush()
    db_session.add_all([
        DocumentLink(organization_id=organization.id, document_id=visible.id, target_type="supplier", target_id=supplier_a.id, created_by_user_id=operator.id),
        DocumentLink(organization_id=organization.id, document_id=hidden.id, target_type="supplier", target_id=supplier_a.id, created_by_user_id=operator.id),
        DocumentLink(organization_id=organization.id, document_id=other.id, target_type="supplier", target_id=supplier_b.id, created_by_user_id=operator.id),
    ])
    await db_session.flush()

    response = await client.get("/api/v1/supplier-portal/documents", headers=_auth(supplier_user))
    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["title"] for item in items] == ["Pièce fournisseur A"]
    assert items[0]["description"] is None
    assert items[0]["review_note"] is None
    assert all(link["target_type"] == "supplier" for link in items[0]["links"])


@pytest.mark.asyncio
async def test_supplier_cannot_use_operator_document_routes(client, db_session) -> None:
    organization, _ = await _organization_user(db_session, email=f"op-{uuid.uuid4().hex}@test.local")
    supplier = Supplier(
        organization_id=organization.id, name="Supplier", country="CI",
        supplier_type=SupplierType.producer, status=SupplierStatus.active, portal_enabled=True,
    )
    db_session.add(supplier)
    await db_session.flush()
    user = User(
        organization_id=organization.id, supplier_id=supplier.id,
        email=f"supplier-{uuid.uuid4().hex}@test.local", role=UserRole.supplier, is_active=True,
    )
    db_session.add(user)
    await db_session.flush()

    response = await client.get("/api/v1/documents", headers=_auth(user))
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_upload_records_metadata_audit_without_storing_binary_in_database(
    client, db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    organization, user = await _organization_user(db_session, email=f"upload-{uuid.uuid4().hex}@test.local")
    payload = b"mock scanned file"
    digest = hashlib.sha256(payload).hexdigest()

    async def fake_inspect(_upload):
        return payload, "application/pdf", "evidence.pdf", digest, "ClamAV-test"

    async def fake_store(**kwargs):
        return f"org/{kwargs['organization_id']}/documents/{kwargs['document_id']}/versions/{kwargs['version_id']}"

    async def fake_cleanup(_key):
        return None

    monkeypatch.setattr("app.api.v1.endpoints.documents.inspect_upload", fake_inspect)
    monkeypatch.setattr("app.api.v1.endpoints.documents.store_version", fake_store)
    monkeypatch.setattr("app.api.v1.endpoints.documents.cleanup_object", fake_cleanup)

    response = await client.post(
        "/api/v1/documents",
        headers=_auth(user),
        data={"title": "Permis local", "category": "permit", "expires_at": "2027-02-01"},
        files={"file": ("evidence.pdf", b"client bytes", "application/pdf")},
    )
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["title"] == "Permis local"
    assert result["latest_version"]["sha256"] == digest
    assert result["latest_version"]["scan_status"] == "clean"
    assert "storage_key" not in result["latest_version"]

    stored = (await db_session.execute(select(Document).where(Document.id == uuid.UUID(result["id"])))).scalar_one()
    assert stored.organization_id == organization.id
    audit = (await db_session.execute(select(AuditEvent).where(
        AuditEvent.object_type == "document", AuditEvent.object_id == stored.id,
    ))).scalars().all()
    assert len(audit) == 1
    assert audit[0].actor_user_id == user.id
    assert audit[0].ip_address
    assert audit[0].action == "document.uploaded"


@pytest.mark.asyncio
async def test_dashboard_uses_document_expiry_and_configured_checklist(client, db_session) -> None:
    from app.models import DocumentChecklistItem, DocumentVersion

    organization, user = await _organization_user(db_session, email=f"dash-doc-{uuid.uuid4().hex}@test.local")
    document = Document(
        organization_id=organization.id,
        created_by_user_id=user.id,
        title="Permit expiring soon",
        category="permit",
        expires_at=date.today() + timedelta(days=10),
        current_version_number=1,
    )
    version = DocumentVersion(
        organization_id=organization.id,
        document=document,
        uploaded_by_user_id=user.id,
        version_number=1,
        storage_key=f"test/{uuid.uuid4().hex}",
        original_filename="permit.pdf",
        content_type="application/pdf",
        file_size_bytes=10,
        sha256="0" * 64,
        scan_status="clean",
        scanner_name="ClamAV-test",
        scanned_at=datetime.now(timezone.utc),
    )
    checklist_item = DocumentChecklistItem(
        organization_id=organization.id,
        created_by_user_id=user.id,
        scope_type="organization",
        scope_id=None,
        title="Configured item without matching evidence",
        category="land_rights",
        is_active=True,
    )
    db_session.add_all([document, version, checklist_item])
    await db_session.flush()

    response = await client.get("/api/v1/dashboard/overview", headers=_auth(user))
    assert response.status_code == 200, response.text
    kpis = response.json()["kpis"]
    assert kpis["documents_expiring_soon"] == 1
    assert kpis["documents_missing"] == 1


@pytest.mark.asyncio
async def test_upload_fails_closed_when_clamav_is_unavailable(client, db_session, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import settings

    _, user = await _organization_user(db_session, email=f"clamav-{uuid.uuid4().hex}@test.local")
    monkeypatch.setattr(settings, "clamav_host", "")
    response = await client.post(
        "/api/v1/documents",
        headers=_auth(user),
        data={"title": "Should not persist", "category": "permit"},
        files={"file": ("valid.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")},
    )
    assert response.status_code == 503
    assert "SCANNER_UNAVAILABLE" in response.json()["detail"]
    documents = (await db_session.execute(select(Document).where(Document.title == "Should not persist"))).scalars().all()
    assert documents == []


@pytest.mark.asyncio
async def test_document_can_be_linked_to_tenant_product(client, db_session) -> None:
    from app.models import Product

    organization, user = await _organization_user(db_session, email=f"product-doc-{uuid.uuid4().hex}@test.local")
    product = Product(organization_id=organization.id, name="Cacao brut", commodity="cocoa")
    document = Document(organization_id=organization.id, created_by_user_id=user.id, title="Product proof", category="other")
    db_session.add_all([product, document])
    await db_session.flush()

    response = await client.post(
        f"/api/v1/documents/{document.id}/links",
        headers=_auth(user),
        data={"product_id": str(product.id)},
    )
    assert response.status_code == 200, response.text
    assert response.json()["links"] == [{
        "target_type": "product",
        "target_id": str(product.id),
        "display_label": None,
    }]

    foreign_org, _ = await _organization_user(db_session, email=f"foreign-{uuid.uuid4().hex}@test.local")
    foreign_product = Product(organization_id=foreign_org.id, name="Foreign product", commodity="cocoa")
    db_session.add(foreign_product)
    await db_session.flush()
    rejected = await client.post(
        f"/api/v1/documents/{document.id}/links",
        headers=_auth(user),
        data={"product_id": str(foreign_product.id)},
    )
    assert rejected.status_code == 404
