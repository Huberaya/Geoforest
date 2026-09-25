"""Tests Chantier 4 : Parcelles (Plots) & validation géospatiale."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models import User, UserRole
from app.services.gis.gis_validator import validate_geometry

# Un polygone valide ~10 ha à 6 décimales — coordonnées flottantes littérales pour que
# la précision soit bien préservée (repr(float) ne triche pas).
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

GOOD_POLYGON_FC = {
    "type": "FeatureCollection",
    "features": [
        {"type": "Feature", "geometry": GOOD_POLYGON, "properties": {"name": "Parcelle A"}},
    ],
}

BAD_PRECISION = {
    "type": "Polygon",
    "coordinates": [[[2.5, 9.5], [2.503, 9.5], [2.503, 9.503], [2.5, 9.503], [2.5, 9.5]]],
}

POINT_PARCEL = {
    "type": "Point",
    "coordinates": [2.500001, 9.500001],
}


def test_imported_precision_metadata_survives_float_normalization():
    """Un GeoJSON peut avoir des coordonnées source à 6 décimales mais être parsé en floats."""
    feature_collection = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"min_decimals": 6},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[2.5, 9.5], [2.503, 9.5], [2.503, 9.503], [2.5, 9.503], [2.5, 9.5]]],
            },
        }],
    }
    result = validate_geometry(feature_collection)
    assert result["min_decimals_found"] == 6
    assert result["valid"] is True


def test_imported_low_precision_metadata_is_not_overlooked():
    feature_collection = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"min_decimals": 4},
            "geometry": GOOD_POLYGON,
        }],
    }
    result = validate_geometry(feature_collection)
    assert result["valid"] is False
    assert result["min_decimals_found"] == 4
    assert any(error["code"] == "INSUFFICIENT_PRECISION" for error in result["errors"])


def test_four_hectares_is_not_more_than_four_for_non_cattle():
    result = validate_geometry(POINT_PARCEL, declared_area_ha=4, commodity_code="cocoa")
    assert result["valid"] is True
    assert result["eudr_geometry_rule"] == "POINT_ALLOWED"


def test_point_above_four_hectares_requires_polygon_except_cattle():
    result_non_cattle = validate_geometry(POINT_PARCEL, declared_area_ha=4.01, commodity_code="cocoa")
    assert result_non_cattle["valid"] is False
    assert any(issue["code"] == "POLYGON_REQUIRED" for issue in result_non_cattle["errors"])

    result_cattle = validate_geometry(POINT_PARCEL, declared_area_ha=6, commodity_code="cattle")
    assert result_cattle["valid"] is True
    assert result_cattle["eudr_geometry_rule"] == "POINT_ALLOWED"


@pytest.fixture
async def auth_headers(client):
    r = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "c4@test.com",
            "password": "TestPass2026!",
            "first_name": "Resp",
            "last_name": "Géo",
            "organization_name": "Géo SAS",
        },
    )
    assert r.status_code in (200, 201)
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


async def _supplier(client, headers, name="Ferme C4", contact_email=None):
    return (await client.post(
        "/api/v1/suppliers", headers=headers,
        json={
            "name": name,
            "supplier_type": "producer",
            "country": "CI",
            "contact_email": contact_email,
        },
    )).json()


async def _product(client, headers, name="Cacao C4", commodity="cocoa"):
    return (await client.post(
        "/api/v1/products", headers=headers, json={"name": name, "commodity": commodity},
    )).json()


async def _shipment(client, headers, sup, prod, ref="LOT-C4-001"):
    return (await client.post(
        "/api/v1/shipments", headers=headers,
        json={"reference": ref, "supplier_id": sup["id"], "product_id": prod["id"]},
    )).json()


async def test_plots_require_auth(client):
    r = await client.get("/api/v1/plots")
    assert r.status_code == 401


async def test_core_supply_chain_changes_are_audited(client, auth_headers):
    supplier = await _supplier(
        client, auth_headers, name="Audit supplier", contact_email="audit-supplier@example.com"
    )
    product = await _product(client, auth_headers, name="Audit product")
    shipment = await _shipment(client, auth_headers, supplier, product, ref="LOT-AUDIT")

    assert (await client.patch(
        f"/api/v1/suppliers/{supplier['id']}", headers=auth_headers,
        json={"region": "Plateaux"},
    )).status_code == 200
    assert (await client.patch(
        f"/api/v1/products/{product['id']}", headers=auth_headers,
        json={"description": "Produit mis à jour"},
    )).status_code == 200
    assert (await client.patch(
        f"/api/v1/shipments/{shipment['id']}", headers=auth_headers,
        json={"quantity": 20.5},
    )).status_code == 200

    invited = await client.post(f"/api/v1/suppliers/{supplier['id']}/invite", headers=auth_headers)
    assert invited.status_code == 200
    supplier_events = (await client.get(
        "/api/v1/audit-log", headers=auth_headers,
        params={"object_type": "supplier", "object_id": supplier["id"]},
    )).json()["items"]
    assert {event["action"] for event in supplier_events} == {
        "supplier.created", "supplier.updated", "supplier.invited",
    }
    invite_event = next(event for event in supplier_events if event["action"] == "supplier.invited")
    assert invite_event["new_data"]["invite_token_generated"] is True
    assert "invite_token" not in invite_event["new_data"]

    all_events = (await client.get("/api/v1/audit-log", headers=auth_headers)).json()["items"]
    actions = {event["action"] for event in all_events}
    assert {"product.created", "product.updated", "shipment.created", "shipment.updated"} <= actions
    shipment_create = next(event for event in all_events if event["action"] == "shipment.created")
    assert shipment_create["ip_address"]
    assert shipment_create["new_data"]["reference"] == "LOT-AUDIT"


async def test_audit_log_is_restricted_to_admin_and_compliance(client, auth_headers, db_session):
    user = (await db_session.execute(select(User).where(User.email == "c4@test.com"))).scalar_one()
    user.role = UserRole.viewer
    await db_session.commit()
    response = await client.get("/api/v1/audit-log", headers=auth_headers)
    assert response.status_code == 403


async def test_create_valid_plot(client, auth_headers):
    sup = await _supplier(client, auth_headers)
    prod = await _product(client, auth_headers)
    ship = await _shipment(client, auth_headers, sup, prod)

    r = await client.post(
        "/api/v1/plots", headers=auth_headers,
        json={
            "shipment_id": ship["id"],
            "name": "Parcelle A",
            "source": "geojson",
            "geojson": GOOD_POLYGON,
            "harvest_year": 2026,
        },
    )
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["status"] == "valid"
    assert p["area_ha"] is not None and p["area_ha"] > 8
    assert p["vertex_count"] == 5
    assert p["geometry_type"] == "Polygon"
    assert p["precision_ok"] is True
    assert p["min_decimals_found"] == 6
    assert p["eudr_geometry_rule"] == "POLYGON_REQUIRED"  # > 4 ha → polygone
    assert p["validation_errors"] == []
    assert p["centroid"] and len(p["centroid"]) == 2
    assert p["bbox"] and len(p["bbox"]) == 4
    assert p["supplier_name"] == sup["name"]
    assert p["product_name"] == prod["name"]
    shipment_check = await client.get(f"/api/v1/shipments/{ship['id']}", headers=auth_headers)
    assert shipment_check.json()["status"] == "awaiting_data"

    audit = await client.get("/api/v1/audit-log", headers=auth_headers, params={"object_id": p["id"]})
    assert audit.status_code == 200
    assert audit.json()["total"] == 1
    event = audit.json()["items"][0]
    assert event["action"] == "plot.created"
    assert event["actor_email"] == "c4@test.com"
    assert event["ip_address"]
    assert event["previous_data"] is None
    assert event["new_data"]["geometry"]


async def test_plot_rejects_bad_precision(client, auth_headers):
    sup = await _supplier(client, auth_headers, name="Bad Préc")
    prod = await _product(client, auth_headers, name="Prod BP")
    ship = await _shipment(client, auth_headers, sup, prod, ref="LOT-BP")

    r = await client.post(
        "/api/v1/plots", headers=auth_headers,
        json={"shipment_id": ship["id"], "name": "Bad", "geojson": BAD_PRECISION},
    )
    assert r.status_code == 201, r.text  # création mais status invalid
    p = r.json()
    assert p["status"] == "invalid"
    assert p["precision_ok"] is False
    codes = [e["code"] for e in p["validation_errors"]]
    assert "INSUFFICIENT_PRECISION" in codes


async def test_point_allowed_for_small_area(client, auth_headers):
    """Un point est techniquement valide sans surface mais le contrôle du seuil reste indéterminé."""
    sup = await _supplier(client, auth_headers, name="Point")
    prod = await _product(client, auth_headers, name="Prod Pt")
    ship = await _shipment(client, auth_headers, sup, prod, ref="LOT-PT")

    r = await client.post(
        "/api/v1/plots", headers=auth_headers,
        json={"shipment_id": ship["id"], "name": "Petit champ", "geojson": POINT_PARCEL},
    )
    assert r.status_code == 201
    p = r.json()
    assert p["geometry_type"] == "Point"
    assert p["status"] == "valid"
    assert p["eudr_geometry_rule"] == "POINT_ALLOWED"


async def test_gps_capture_metadata_is_persisted_and_audited(client, auth_headers):
    sup = await _supplier(client, auth_headers, name="GPS")
    prod = await _product(client, auth_headers, name="GPS cacao")
    ship = await _shipment(client, auth_headers, sup, prod, ref="LOT-GPS")
    captured_at = "2026-09-24T17:00:00Z"
    r = await client.post(
        "/api/v1/plots", headers=auth_headers,
        json={
            "shipment_id": ship["id"],
            "name": "Point terrain",
            "source": "gps",
            "geojson": POINT_PARCEL,
            "declared_area_ha": 3.2,
            "acquired_at": captured_at,
            "gps_accuracy_m": 7.5,
        },
    )
    assert r.status_code == 201, r.text
    plot = r.json()
    assert plot["source"] == "gps"
    assert plot["gps_accuracy_m"] == 7.5
    assert plot["acquired_at"].startswith("2026-09-24T17:00:00")
    event = (await client.get(
        "/api/v1/audit-log", headers=auth_headers, params={"object_id": plot["id"]}
    )).json()["items"][0]
    assert event["new_data"]["gps_accuracy_m"] == 7.5
    assert event["new_data"]["acquired_at"].startswith("2026-09-24T17:00:00")


async def test_cattle_establishment_point_over_four_hectares_is_not_forced_to_polygon(client, auth_headers):
    sup = await _supplier(client, auth_headers, name="Bovins")
    prod = await _product(client, auth_headers, name="Bovins vivants", commodity="cattle")
    ship = await _shipment(client, auth_headers, sup, prod, ref="LOT-CATTLE")
    r = await client.post(
        "/api/v1/plots", headers=auth_headers,
        json={
            "shipment_id": ship["id"],
            "name": "Établissement bovin",
            "geojson": POINT_PARCEL,
            "declared_area_ha": 6,
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "valid"
    assert r.json()["eudr_geometry_rule"] == "POINT_ALLOWED"
    assert not any(issue["code"] == "POLYGON_REQUIRED" for issue in r.json()["validation_errors"])


async def test_feature_collection_is_accepted(client, auth_headers):
    sup = await _supplier(client, auth_headers, name="FC")
    prod = await _product(client, auth_headers, name="Prod FC")
    ship = await _shipment(client, auth_headers, sup, prod, ref="LOT-FC")
    r = await client.post(
        "/api/v1/plots", headers=auth_headers,
        json={"shipment_id": ship["id"], "name": "FC", "geojson": GOOD_POLYGON_FC},
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "valid"


async def test_plot_crud_isolation(client, auth_headers):
    sup = await _supplier(client, auth_headers, name="Iso")
    prod = await _product(client, auth_headers, name="Prod Iso")
    ship = await _shipment(client, auth_headers, sup, prod, ref="LOT-ISO")
    r = await client.post(
        "/api/v1/plots", headers=auth_headers,
        json={"shipment_id": ship["id"], "name": "P1", "geojson": GOOD_POLYGON},
    )
    pid = r.json()["id"]

    # Détail OK
    r = await client.get(f"/api/v1/plots/{pid}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["area_ha"] > 5

    # Liste avec agrégats
    r = await client.get("/api/v1/plots", headers=auth_headers)
    assert r.json()["total"] == 1
    assert r.json()["total_area_ha"] > 5
    assert r.json()["invalid_count"] == 0
    assert "valid" in r.json()["by_status"]

    # Isolation : autre org ne voit pas
    r2 = await client.post(
        "/api/v1/auth/register",
        json={"email": "other-c4@test.com", "password": "TestPass2026!", "organization_name": "Autre"},
    )
    h2 = {"Authorization": f"Bearer {r2.json()['access_token']}"}
    r = await client.get(f"/api/v1/plots/{pid}", headers=h2)
    assert r.status_code == 404
    r = await client.get("/api/v1/plots", headers=h2)
    assert r.json()["total"] == 0
    audit = await client.get("/api/v1/audit-log", headers=h2)
    assert audit.status_code == 200
    # Un tenant voit son propre audit d'inscription, mais aucun événement de l'autre organisation.
    assert audit.json()["total"] == 2
    assert {event["action"] for event in audit.json()["items"]} == {
        "organization.created", "user.registered",
    }
    assert all(event["object_type"] in {"organization", "user"} for event in audit.json()["items"])


async def test_plot_delete_resets_unanalyzed_shipment_and_is_audited(client, auth_headers):
    sup = await _supplier(client, auth_headers, name="Delete plot")
    prod = await _product(client, auth_headers, name="Delete product")
    ship = await _shipment(client, auth_headers, sup, prod, ref="LOT-DELETE-PLOT")
    created = await client.post(
        "/api/v1/plots", headers=auth_headers,
        json={"shipment_id": ship["id"], "name": "À supprimer", "geojson": GOOD_POLYGON},
    )
    assert created.status_code == 201
    plot_id = created.json()["id"]

    deleted = await client.delete(f"/api/v1/plots/{plot_id}", headers=auth_headers)
    assert deleted.status_code == 204
    shipment_after = await client.get(f"/api/v1/shipments/{ship['id']}", headers=auth_headers)
    assert shipment_after.json()["status"] == "draft"
    audit = await client.get("/api/v1/audit-log", headers=auth_headers, params={"object_id": plot_id})
    actions = [event["action"] for event in audit.json()["items"]]
    assert actions == ["plot.deleted", "plot.created"]
    deleted_event = audit.json()["items"][0]
    assert deleted_event["previous_data"]["geometry"]
    assert deleted_event["new_data"] is None


async def test_plot_duplicate_internal_reference_rejected(client, auth_headers):
    sup = await _supplier(client, auth_headers, name="Dup ref")
    prod = await _product(client, auth_headers, name="Dup product")
    ship = await _shipment(client, auth_headers, sup, prod, ref="LOT-DUP-PLOT")
    payload = {
        "shipment_id": ship["id"],
        "internal_ref": "P-01",
        "geojson": GOOD_POLYGON,
    }
    first = await client.post("/api/v1/plots", headers=auth_headers, json=payload)
    assert first.status_code == 201
    duplicate = await client.post("/api/v1/plots", headers=auth_headers, json=payload)
    assert duplicate.status_code == 409
    second = await client.post(
        "/api/v1/plots", headers=auth_headers,
        json={**payload, "internal_ref": "P-02"},
    )
    assert second.status_code == 201
    conflict = await client.patch(
        f"/api/v1/plots/{second.json()['id']}", headers=auth_headers,
        json={"internal_ref": "P-01"},
    )
    assert conflict.status_code == 409


async def test_plot_shipment_must_belong_to_tenant(client, auth_headers):
    r = await client.post(
        "/api/v1/plots", headers=auth_headers,
        json={"shipment_id": str(uuid.uuid4()), "name": "X", "geojson": GOOD_POLYGON},
    )
    assert r.status_code == 422


async def test_revalidate_endpoint(client, auth_headers):
    sup = await _supplier(client, auth_headers, name="Reval")
    prod = await _product(client, auth_headers, name="Prod R")
    ship = await _shipment(client, auth_headers, sup, prod, ref="LOT-R")
    # D'abord avec mauvaise précision
    bad = await client.post(
        "/api/v1/plots", headers=auth_headers,
        json={"shipment_id": ship["id"], "name": "Bad", "geojson": BAD_PRECISION},
    )
    pid = bad.json()["id"]
    assert bad.json()["status"] == "invalid"

    # PATCH avec bonne géométrie → la revalidation se fait
    r = await client.patch(
        f"/api/v1/plots/{pid}", headers=auth_headers, json={"geojson": GOOD_POLYGON}
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "valid"

    # Endpoint validate explicite
    r = await client.post(f"/api/v1/plots/{pid}/validate", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["valid"] is True


async def test_dashboard_kpis_updated_with_plots(client, auth_headers):
    sup = await _supplier(client, auth_headers, name="K Ferme")
    prod = await _product(client, auth_headers, name="PK")
    ship = await _shipment(client, auth_headers, sup, prod, ref="LOT-K")
    await client.post(
        "/api/v1/plots", headers=auth_headers,
        json={"shipment_id": ship["id"], "name": "PK", "geojson": GOOD_POLYGON},
    )
    r = await client.get("/api/v1/dashboard/overview", headers=auth_headers)
    k = r.json()["kpis"]
    assert k["plots_total"] == 1
    # La validation géométrique ne signifie pas qu'une analyse de déforestation a été réalisée.
    assert k["plots_analyzed"] == 0
    assert k["plots_action_required"] == 0
    steps = {s["key"]: s["done"] for s in r.json()["onboarding"]["steps"]}
    assert steps["plot"] is True


async def test_user_mutations_are_audited_without_credentials(client, auth_headers):
    profile = await client.get("/api/v1/users/me", headers=auth_headers)
    assert profile.status_code == 200
    admin_id = profile.json()["id"]

    changed_profile = await client.patch(
        "/api/v1/users/me",
        headers=auth_headers,
        json={"first_name": "Auditée", "phone": "+33123456789"},
    )
    assert changed_profile.status_code == 200

    password_response = await client.post(
        "/api/v1/users/me/password",
        headers=auth_headers,
        json={"current_password": "TestPass2026!", "new_password": "ChangedPass2030!"},
    )
    assert password_response.status_code == 200

    invited = await client.post(
        "/api/v1/users/invite",
        headers=auth_headers,
        json={"email": "audited-member@test.com", "role": "viewer", "first_name": "Membre"},
    )
    assert invited.status_code == 201
    member_id = invited.json()["id"]

    deactivated = await client.delete(f"/api/v1/users/{member_id}", headers=auth_headers)
    assert deactivated.status_code == 200

    response = await client.get("/api/v1/audit-log", headers=auth_headers, params={"object_type": "user"})
    assert response.status_code == 200
    events = response.json()["items"]
    by_action = {event["action"]: event for event in events}

    assert {"user.registered", "user.profile_updated", "user.password_changed", "user.invited", "user.deactivated"} <= set(by_action)
    assert by_action["user.registered"]["object_id"] == admin_id
    assert by_action["user.profile_updated"]["previous_data"]["first_name"] == "Resp"
    assert by_action["user.profile_updated"]["new_data"]["first_name"] == "Auditée"
    assert by_action["user.profile_updated"]["ip_address"]
    assert by_action["user.password_changed"]["previous_data"] == {"credential_state": "password_configured"}
    assert by_action["user.password_changed"]["new_data"] == {"credential_state": "password_updated"}
    assert by_action["user.invited"]["object_id"] == member_id
    assert by_action["user.invited"]["new_data"]["email"] == "audited-member@test.com"
    assert "password_hash" not in by_action["user.invited"]["new_data"]
    assert "refresh_token_jti" not in by_action["user.invited"]["new_data"]
    assert by_action["user.deactivated"]["previous_data"]["is_active"] is True
    assert by_action["user.deactivated"]["new_data"]["is_active"] is False
    assert "TestPass2026!" not in str(events)
    assert "ChangedPass2030!" not in str(events)
