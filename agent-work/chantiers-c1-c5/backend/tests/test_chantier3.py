"""Tests Chantier 3 : Fournisseurs, Produits, Lots."""
from __future__ import annotations

import pytest

from app.models.products import EUDR_COMMODITIES


@pytest.fixture
async def auth_headers(client: AsyncClient) -> dict[str, str]:
    r = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "c3@test.com",
            "password": "TestPass2026!",
            "first_name": "Resp",
            "last_name": "Conformité",
            "organization_name": "Choco SAS",
        },
    )
    assert r.status_code in (200, 201), r.text
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


# --------------------------------------------------------------------------- Commodités
async def test_commodities_lists_eudr_annex_i(client: AsyncClient, auth_headers):
    r = await client.get("/api/v1/commodities", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    codes = {c["code"] for c in data["items"]}
    # Les 7 commodités principales attendues (Annexe I EUDR)
    for must in ("cattle", "cocoa", "coffee", "rubber", "palm_oil", "soy", "wood"):
        assert must in codes, f"{must} doit être présent dans les commodités EUDR"
    # Chaque entrée a code/hs/label/category
    for c in data["items"]:
        assert set(c.keys()) == {"code", "hs", "label", "category"}
        assert len(c["hs"]) >= 4 and c["hs"].isdigit()
    assert "note" in data  # mention transparente sur le statut réglementaire


async def test_commodities_requires_auth(client: AsyncClient):
    r = await client.get("/api/v1/commodities")
    assert r.status_code == 401


# --------------------------------------------------------------------------- Fournisseurs
async def test_supplier_crud_and_isolation(client: AsyncClient, auth_headers):
    # Création
    r = await client.post(
        "/api/v1/suppliers",
        headers=auth_headers,
        json={
            "name": "Coopérative Cacao Kpalimé",
            "supplier_type": "cooperative",
            "country": "TG",
            "email": "contact@kpalime.coop",
            "contact_name": "Kofi Mensah",
        },
    )
    assert r.status_code == 201, r.text
    sup = r.json()
    assert sup["name"] == "Coopérative Cacao Kpalimé"
    assert sup["country"] == "TG"
    assert sup["status"] == "pending"
    assert sup["risk_rating"] == "unknown"
    assert sup["shipments_count"] == 0

    # Liste
    r = await client.get("/api/v1/suppliers", headers=auth_headers)
    assert r.status_code == 200
    lst = r.json()
    assert lst["total"] == 1
    assert lst["by_status"] == {"pending": 1}
    assert lst["by_risk"] == {"unknown": 1}

    # Détail
    r = await client.get(f"/api/v1/suppliers/{sup['id']}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["contact_name"] == "Kofi Mensah"

    # Mise à jour
    r = await client.patch(
        f"/api/v1/suppliers/{sup['id']}",
        headers=auth_headers,
        json={"status": "active", "region": "Plateaux"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "active"
    assert r.json()["region"] == "Plateaux"

    # Isolation inter-org : créer une 2e org, elle ne voit pas le fournisseur
    r2 = await client.post(
        "/api/v1/auth/register",
        json={"email": "other@test.com", "password": "TestPass2026!", "organization_name": "Compet"},
    )
    h2 = {"Authorization": f"Bearer {r2.json()['access_token']}"}
    r = await client.get("/api/v1/suppliers", headers=h2)
    assert r.json()["total"] == 0
    r = await client.get(f"/api/v1/suppliers/{sup['id']}", headers=h2)
    assert r.status_code == 404


async def test_supplier_duplicate_name_country_rejected(client: AsyncClient, auth_headers):
    payload = {"name": "Ferme A", "country": "CI", "supplier_type": "producer"}
    r = await client.post("/api/v1/suppliers", headers=auth_headers, json=payload)
    assert r.status_code == 201
    r = await client.post("/api/v1/suppliers", headers=auth_headers, json=payload)
    assert r.status_code == 409


async def test_supplier_role_required(client: AsyncClient, auth_headers):
    # Admin peut créer un fournisseur (rôle autorisé)
    r = await client.post(
        "/api/v1/suppliers",
        headers=auth_headers,
        json={"name": "Fournisseur rôle test", "country": "FR", "supplier_type": "other"},
    )
    assert r.status_code == 201, r.text
    # Viewer ne peut pas (rôle insuffisant) — testé indirectement via le code ;
    # l'invitation complète d'un viewer nécessitant l'envoi d'email arrive au chantier 8.


async def test_supplier_invite_generates_token(client: AsyncClient, auth_headers):
    r = await client.post(
        "/api/v1/suppliers",
        headers=auth_headers,
        json={"name": "Neg B", "country": "BR", "supplier_type": "trader", "email": "neg@b.br"},
    )
    sup = r.json()
    assert sup["portal_enabled"] is False
    r = await client.post(f"/api/v1/suppliers/{sup['id']}/invite", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["portal_enabled"] is True
    assert r.json()["email"] == "neg@b.br"


# --------------------------------------------------------------------------- Produits
async def test_product_commodity_validation(client: AsyncClient, auth_headers):
    r = await client.post(
        "/api/v1/products",
        headers=auth_headers,
        json={"name": "Fèves premium", "commodity": "not_a_commodity"},
    )
    assert r.status_code == 422


async def test_product_auto_hs_code(client: AsyncClient, auth_headers):
    r = await client.post(
        "/api/v1/products",
        headers=auth_headers,
        json={"name": "Cacao trace", "commodity": "cocoa"},
    )
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["commodity"] == "cocoa"
    assert p["commodity_label"] == "Cacao (fèves et brisures)"
    assert p["hs_code"] == "1801"  # auto depuis EUDR_COMMODITIES
    assert p["status"] == "active"
    assert p["shipments_count"] == 0


async def test_product_crud_and_list_filter(client: AsyncClient, auth_headers):
    await client.post("/api/v1/products", headers=auth_headers, json={"name": "Café vert", "commodity": "coffee"})
    await client.post("/api/v1/products", headers=auth_headers, json={"name": "Bois brut", "commodity": "wood"})
    r = await client.get("/api/v1/products", headers=auth_headers, params={"commodity": "coffee"})
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["commodity"] == "coffee"
    r = await client.get("/api/v1/products", headers=auth_headers)
    assert r.json()["total"] == 2


# --------------------------------------------------------------------------- Lots
async def _make_supplier(client, headers, **over):
    data = {"name": "Coop X", "country": "CI", "supplier_type": "cooperative", **over}
    return (await client.post("/api/v1/suppliers", headers=headers, json=data)).json()


async def _make_product(client, headers, name="Cacao std", commodity="cocoa"):
    return (await client.post("/api/v1/products", headers=headers, json={"name": name, "commodity": commodity})).json()


async def test_shipment_crud_and_kpi_cascade(client: AsyncClient, auth_headers):
    sup = await _make_supplier(client, auth_headers)
    prod = await _make_product(client, auth_headers)
    r = await client.post(
        "/api/v1/shipments",
        headers=auth_headers,
        json={
            "reference": "LOT-2026-001",
            "supplier_id": sup["id"],
            "product_id": prod["id"],
            "quantity": 1250.5,
            "unit": "kg",
            "country_of_production": "ci",
            "harvest_date": "2026-08-15",
        },
    )
    assert r.status_code == 201, r.text
    sh = r.json()
    assert sh["reference"] == "LOT-2026-001"
    assert sh["supplier_name"] == sup["name"]
    assert sh["product_name"] == prod["name"]
    assert sh["commodity"] == "cocoa"
    assert sh["country_of_production"] == "CI"  # normalisé majuscules
    assert sh["status"] == "draft"

    # Vérif détail
    r = await client.get(f"/api/v1/shipments/{sh['id']}", headers=auth_headers)
    assert r.status_code == 200

    # Liste avec filtre fournisseur
    r = await client.get("/api/v1/shipments", headers=auth_headers, params={"supplier_id": sup["id"]})
    assert r.json()["total"] == 1
    r = await client.get("/api/v1/shipments", headers=auth_headers, params={"status": "draft"})
    assert r.json()["total"] == 1
    r = await client.get("/api/v1/shipments", headers=auth_headers, params={"status": "ready"})
    assert r.json()["total"] == 0
    assert r.json()["by_status"]["draft"] == 1

    # Compteurs cascades
    sup_detail = (await client.get(f"/api/v1/suppliers/{sup['id']}", headers=auth_headers)).json()
    assert sup_detail["shipments_count"] == 1
    prod_detail = (await client.get(f"/api/v1/products/{prod['id']}", headers=auth_headers)).json()
    assert prod_detail["shipments_count"] == 1

    # Dashboard compteurs
    r = await client.get("/api/v1/dashboard/overview", headers=auth_headers)
    k = r.json()["kpis"]
    assert k["suppliers_count"] == 1
    assert k["products_count"] == 1
    assert k["shipments_count"] == 1


async def test_shipment_requires_valid_supplier_and_product(client: AsyncClient, auth_headers):
    r = await client.post(
        "/api/v1/shipments",
        headers=auth_headers,
        json={
            "reference": "BAD",
            "supplier_id": "00000000-0000-0000-0000-000000000000",
            "product_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert r.status_code == 422


async def test_shipment_duplicate_reference_rejected(client: AsyncClient, auth_headers):
    sup = await _make_supplier(client, auth_headers, name="A Coop")
    prod = await _make_product(client, auth_headers, name="P1")
    body = {"reference": "REF-1", "supplier_id": sup["id"], "product_id": prod["id"]}
    assert (await client.post("/api/v1/shipments", headers=auth_headers, json=body)).status_code == 201
    r = await client.post("/api/v1/shipments", headers=auth_headers, json=body)
    assert r.status_code == 409


async def test_shipment_delete_only_draft(client: AsyncClient, auth_headers):
    sup = await _make_supplier(client, auth_headers, name="Sup D")
    prod = await _make_product(client, auth_headers, name="PD")
    sh = (await client.post(
        "/api/v1/shipments",
        headers=auth_headers,
        json={"reference": "DEL-1", "supplier_id": sup["id"], "product_id": prod["id"]},
    )).json()
    # Passer en awaiting_data
    await client.patch(f"/api/v1/shipments/{sh['id']}", headers=auth_headers, json={"status": "awaiting_data"})
    # Supprimer doit échouer
    r = await client.delete(f"/api/v1/shipments/{sh['id']}", headers=auth_headers)
    assert r.status_code == 409
    # Remettre en draft et supprimer
    await client.patch(f"/api/v1/shipments/{sh['id']}", headers=auth_headers, json={"status": "draft"})
    r = await client.delete(f"/api/v1/shipments/{sh['id']}", headers=auth_headers)
    assert r.status_code == 204


async def test_onboarding_alerts_fire_on_first_create(client: AsyncClient, auth_headers):
    # 1er fournisseur → alerte succès onboarding
    sup = await _make_supplier(client, auth_headers, name="First Sup")
    prod = await _make_product(client, auth_headers, name="First Prod")
    sh = (await client.post(
        "/api/v1/shipments", headers=auth_headers,
        json={"reference": "FIRST", "supplier_id": sup["id"], "product_id": prod["id"]},
    )).json()

    r = await client.get("/api/v1/dashboard/overview", headers=auth_headers)
    alerts = r.json()["recent_alerts"]
    titles = [a["title"] for a in alerts]
    assert any("Premier fournisseur" in t for t in titles)
    assert any("Premier produit" in t for t in titles)
    assert any("Premier lot" in t for t in titles)
    # Étapes onboarding correspondantes à done
    steps = {s["key"]: s["done"] for s in r.json()["onboarding"]["steps"]}
    assert steps["supplier"] is True
    assert steps["product"] is True
    assert steps["team"] is False  # seul admin


async def test_supplier_cannot_be_archived_with_active_shipments(client: AsyncClient, auth_headers):
    sup = await _make_supplier(client, auth_headers, name="Cannot archive")
    prod = await _make_product(client, auth_headers, name="PArc")
    sh = (await client.post(
        "/api/v1/shipments", headers=auth_headers,
        json={"reference": "ACTV", "supplier_id": sup["id"], "product_id": prod["id"]},
    )).json()
    # Passer le lot en analyzed (état actif, non draft/rejected)
    await client.patch(f"/api/v1/shipments/{sh['id']}", headers=auth_headers, json={"status": "analyzed"})
    r = await client.delete(f"/api/v1/suppliers/{sup['id']}", headers=auth_headers)
    assert r.status_code == 409
