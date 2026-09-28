import json

import pytest
from app.config import settings
from app.database import transaction
from app.security import token_hash
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_geometry import square
from test_supply import invitation, portal, product, supplier, workspace

# Fixtures imported explicitly from the existing supply integration suite.
assert workspace


def body(sid, ref="PARC-01"):
    return {
        "supplier_id": sid,
        "reference": ref,
        "name": "Parcelle synthétique en océan",
        "country": "FR",
        "commodity": "cocoa",
        "geometry": square(),
        "acknowledge_warnings": True,
    }


def create(client, path, sid, ref="PARC-01"):
    r = client.post(path + "/plots", json=body(sid, ref))
    assert r.status_code == 201, r.text
    return r.json()


def test_plot_crud_versions_and_archived_history(client, workspace):
    _, _, path = workspace
    s = supplier(client, path)
    p = create(client, path, s["id"])
    assert client.get(path + "/plots").json()["total"] == 1
    assert client.get(path + "/plots?q=PARC-01").json()["total"] == 1
    assert client.get(path + "/plots?bbox=-31,-1,-29,1").json()["total"] == 1
    assert client.get(path + "/plots?bbox=0,0,1,1").json()["total"] == 0
    assert client.get(path + "/plots?bbox=170,-1,-170,1").status_code == 422
    edit = {
        **p["payload"],
        "geometry": square(-30, 0, 0.002),
        "version": 1,
        "acknowledge_warnings": True,
    }
    r = client.put(path + "/plots/" + p["id"], json=edit)
    assert r.status_code == 200, r.text
    assert r.json()["current_revision"] == 2
    assert client.put(path + "/plots/" + p["id"], json=edit).status_code == 409
    old = client.get(path + f"/plots/{p['id']}/revisions/1").json()
    assert old["payload"]["geometry"] == square()
    assert (
        client.post(path + f"/plots/{p['id']}/archive", json={"version": 2}).status_code
        == 200
    )
    assert client.get(path + "/plots").json()["total"] == 0
    assert client.get(path + "/plots?include_archived=true").json()["total"] == 1
    assert client.get(path + f"/plots/{p['id']}").json()["current_revision"] == 2


def test_geometry_revision_immutable_and_relation_fks(client, workspace):
    u, o, path = workspace
    s = supplier(client, path)
    p = create(client, path, s["id"])
    with pytest.raises(DBAPIError), transaction(u["id"], o) as conn:
        conn.execute(text("UPDATE plot_geolocations SET payload='{}'"))
    with pytest.raises(DBAPIError), transaction(u["id"], o) as conn:
        conn.execute(text("DELETE FROM plot_geolocations"))
    with pytest.raises(DBAPIError), transaction(u["id"], o) as conn:
        conn.execute(
            text("UPDATE plots SET current_revision=99 WHERE id=:id"), {"id": p["id"]}
        )


def test_warnings_require_acknowledgement_and_overlap_explained(client, workspace):
    _, _, path = workspace
    s = supplier(client, path)
    p = create(client, path, s["id"])
    r = client.post(path + "/plots/check", json={"geometry": square()})
    assert r.status_code == 200, r.text
    assert r.json()["spatial_relations"][0]["kind"] == "DUPLICATE"
    assert (
        client.post(
            path + "/plots",
            json={**body(s["id"], "PARC-02"), "acknowledge_warnings": False},
        ).status_code
        == 409
    )
    r = client.post(
        path + "/plots/check", json={"geometry": square(-29.9995, 0, 0.001)}
    )
    assert r.json()["spatial_relations"][0]["kind"] == "OVERLAP"
    assert (
        client.post(
            path + "/plots/check",
            json={"geometry": square(), "exclude_plot_id": p["id"]},
        ).json()["spatial_relations"]
        == []
    )


@pytest.mark.parametrize("role", ["Analyst", "Viewer", "Supplier"])
def test_plot_readonly_and_supplier_isolation(
    client, workspace, identity, signin, membership, role
):
    _, o, path = workspace
    sa = supplier(client, path, "SUP-A")
    sb = supplier(client, path, "SUP-B")
    pa = create(client, path, sa["id"])
    pb = create(client, path, sb["id"], "PARC-B")
    u = identity()
    membership(o, u["id"], role, sa["id"] if role == "Supplier" else None)
    signin(client, u)
    assert client.post(path + "/plots", json=body(sa["id"], "NO-01")).status_code == 403
    if role == "Supplier":
        assert client.get(path + "/plots").json()["total"] == 1
        assert client.get(path + "/plots/" + pb["id"]).status_code == 404
        check = client.post(path + "/plots/check", json={"geometry": square()}).json()
        assert [r["id"] for r in check["spatial_relations"]] == [pa["id"]]
        with transaction(u["id"], o) as c:
            assert len(c.execute(text("SELECT * FROM plot_geolocations")).all()) == 1


def test_cross_tenant_no_spatial_existence_leak(
    client, workspace, identity, signin, org
):
    _, oa, path = workspace
    sa = supplier(client, path)
    pa = create(client, path, sa["id"])
    b = identity()
    ob = org(b["id"])
    signin(client, b)
    bp = f"/api/v1/organizations/{ob}"
    sb = supplier(client, bp)
    assert client.get(bp + "/plots/" + pa["id"]).status_code == 404
    assert (
        client.post(bp + "/plots/check", json={"geometry": square()}).json()[
            "spatial_relations"
        ]
        == []
    )
    assert client.post(bp + "/plots", json=body(sa["id"])).status_code == 404
    with transaction(b["id"], ob) as c:
        assert c.execute(text("SELECT * FROM plots")).all() == []
    with pytest.raises(DBAPIError), transaction(b["id"], ob) as c:
        c.execute(
            text(
                "INSERT INTO plots(organization_id,supplier_id,reference) VALUES(:o,:s,'BAD-01')"
            ),
            {"o": ob, "s": sa["id"]},
        )
    assert client.get(path + "/plots").status_code == 404
    assert sb["id"] != sa["id"] and oa != ob


def test_import_preview_apply_replay_source_and_atomic_failure(client, workspace):
    _, _, path = workspace
    s = supplier(client, path)
    raw = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": square(),
                    "properties": {"name": "Fictif 1"},
                },
                {
                    "type": "Feature",
                    "geometry": square(),
                    "properties": {"name": "Fictif 2"},
                },
            ],
        }
    )
    args = {
        "supplier_id": s["id"],
        "country": "FR",
        "reference_prefix": "IMP",
        "file_format": "geojson",
        "source_text": raw,
    }
    preview = client.post(path + "/plots/import-preview", json=args)
    assert preview.status_code == 200, preview.text
    assert preview.json()["batch_intersections"][0]["kind"] == "DUPLICATE"
    apply = {**args, "confirmed": True, "preview_checksum": preview.json()["checksum"]}
    r = client.post(path + "/plots/import", json=apply)
    assert r.status_code == 200, r.text
    assert r.json()["created_count"] == 2
    assert client.get(path + f"/plot-imports/{r.json()['id']}/source").text == raw
    assert client.post(path + "/plots/import", json=apply).json()["replayed"]
    assert (
        client.post(path + "/plots/import", json={**apply, "country": "CI"}).status_code
        == 409
    )
    mixed = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "geometry": square()},
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [-30, 0],
                                [-29.99, 0.01],
                                [-30, 0.01],
                                [-29.99, 0],
                                [-30, 0],
                            ]
                        ],
                    },
                },
            ],
        }
    )
    invalid = client.post(
        path + "/plots/import-preview",
        json={**args, "source_text": mixed, "reference_prefix": "BAD"},
    )
    assert invalid.status_code == 422
    assert client.get(path + "/plots").json()["total"] == 2


def test_lot_snapshot_pinned_and_supplier_mismatch(client, workspace):
    _, _, path = workspace
    s = supplier(client, path)
    p = create(client, path, s["id"])
    prod = product(client, path, s["id"])
    lot = client.post(
        path + "/lots",
        json={
            "reference": "LOT-01",
            "supplier_id": s["id"],
            "product_id": prod["id"],
            "quantity": "10",
            "unit": "KG",
        },
    ).json()
    route = path + f"/lots/{lot['id']}/plots"
    r = client.put(
        route, json={"version": 1, "plots": [{"plot_id": p["id"], "revision": 1}]}
    )
    assert r.status_code == 200, r.text
    assert client.put(route, json={"version": 1, "plots": []}).status_code == 409
    client.put(
        path + "/plots/" + p["id"],
        json={
            **p["payload"],
            "version": 1,
            "geometry": square(side=0.002),
            "acknowledge_warnings": True,
        },
    )
    snapshot = client.get(route).json()["items"][0]
    assert (
        snapshot["revision"] == 1
        and snapshot["current_revision"] == 2
        and snapshot["payload"]["geometry"] == square()
    )
    other = supplier(client, path, "SUP-B")
    pb = create(client, path, other["id"], "PARC-B")
    assert (
        client.put(
            route, json={"version": 2, "plots": [{"plot_id": pb["id"], "revision": 1}]}
        ).status_code
        == 422
    )
    assert client.get(route).json()["items"][0]["revision"] == 1
    assert (
        client.post(path + f"/plots/{p['id']}/archive", json={"version": 2}).status_code
        == 200
    )
    assert client.get(route).json()["items"][0]["archived_at"]
    assert client.put(route, json={"version": 2, "plots": []}).status_code == 200


def test_portal_proposals_corrections_adoption_and_immutable_submissions(
    client, workspace
):
    _, o, path = workspace
    s = supplier(client, path)
    pc, _ = portal(invitation(client, path, s["id"]))
    payload = {
        k: v
        for k, v in body(s["id"]).items()
        if k not in {"supplier_id", "acknowledge_warnings"}
    }
    created = pc.post("/api/portal/plot-proposals", json={"payload": payload})
    assert created.status_code == 201, created.text
    p = created.json()
    url = "/api/portal/plot-proposals/" + p["id"]
    assert (
        pc.post(url + "/submit", json={"version": 1, "confirmed": False}).status_code
        == 422
    )
    assert (
        pc.post(url + "/submit", json={"version": 1, "confirmed": True}).status_code
        == 200
    )
    assert pc.put(url, json={"version": 2, "payload": payload}).status_code == 409
    review = path + f"/plot-proposals/{p['id']}/review"
    r = client.post(
        review,
        json={
            "version": 2,
            "decision": "CHANGES_REQUESTED",
            "note": "Vérifiez le contour synthétique",
        },
    )
    assert r.status_code == 200, r.text
    assert (
        pc.put(
            url, json={"version": 3, "payload": {**payload, "name": "Nom corrigé"}}
        ).status_code
        == 200
    )
    assert (
        pc.post(url + "/submit", json={"version": 4, "confirmed": True}).status_code
        == 200
    )
    assert (
        client.post(
            review,
            json={
                "version": 5,
                "decision": "ACCEPTED",
                "note": "Confirmation manquante",
            },
        ).status_code
        == 422
    )
    adopted = client.post(
        review,
        json={
            "version": 5,
            "decision": "ACCEPTED",
            "confirmed": True,
            "note": "Adoption explicite, sans verdict EUDR",
        },
    )
    assert adopted.status_code == 200, adopted.text
    plot = client.get(path + "/plots/" + adopted.json()["adopted_plot_id"]).json()
    assert (
        plot["payload"]["name"] == "Nom corrigé"
        and plot["source_kind"] == "SUPPLIER_PORTAL"
    )
    assert len(client.get(path + f"/plot-proposals/{p['id']}/revisions").json()) == 2
    assert (
        pc.get("/api/portal/plot-proposals").json()["items"][0]["status"] == "ACCEPTED"
    )
    hashed = token_hash(pc.cookies.get(settings().portal_cookie))
    with transaction(organization_id=o, portal_session=hashed) as c:
        assert c.execute(text("SELECT * FROM plots")).all() == []
    with pytest.raises(DBAPIError), transaction(portal_session=hashed) as c:
        c.execute(text("DELETE FROM plot_proposal_revisions"))


def test_portal_proposals_other_supplier_and_revocation(client, workspace):
    _, _, path = workspace
    a = supplier(client, path, "SUP-A")
    b = supplier(client, path, "SUP-B")
    ia = invitation(client, path, a["id"])
    pc, _ = portal(ia)
    other, _ = portal(invitation(client, path, b["id"]))
    payload = {
        k: v
        for k, v in body(b["id"]).items()
        if k not in {"supplier_id", "acknowledge_warnings"}
    }
    p = other.post("/api/portal/plot-proposals", json={"payload": payload}).json()
    assert (
        pc.put(
            "/api/portal/plot-proposals/" + p["id"],
            json={"version": 1, "payload": payload},
        ).status_code
        == 404
    )
    assert pc.get("/api/portal/plot-proposals").json()["total"] == 0
    assert pc.get(path + "/plots").status_code == 401
    client.delete(path + f"/suppliers/{a['id']}/invitations/{ia['id']}")
    assert pc.get("/api/portal/plot-proposals").status_code == 401


def test_geo_body_limit_targeted_and_csrf(client, workspace):
    _, _, path = workspace
    s = supplier(client, path)
    large = " " * 70000 + json.dumps({"type": "Point", "coordinates": [-30, 0]})
    r = client.post(
        path + "/plots/import-preview",
        json={
            "supplier_id": s["id"],
            "country": "FR",
            "reference_prefix": "BIG",
            "file_format": "geojson",
            "source_text": large,
        },
    )
    assert r.status_code == 200, r.text
    assert (
        client.post(
            path + "/suppliers", json={"reference": "TOO-01", "name": "x" * 70000}
        ).status_code
        == 413
    )
    assert (
        client.post(
            path + "/plots/check",
            json={"geometry": square()},
            headers={"Origin": "https://evil.invalid"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            path + "/plots/import-preview",
            content="x" * (2 * 1024 * 1024 + 1),
            headers={"Content-Type": "application/json"},
        ).status_code
        == 413
    )


@pytest.mark.parametrize(
    "data",
    [
        {"capture_method": "GPS"},
        {"gps_accuracy_m": 10},
        {
            "capture_method": "GPS",
            "gps_accuracy_m": 10,
            "captured_at": "2999-01-01T00:00:00Z",
        },
    ],
)
def test_invalid_capture_metadata(client, workspace, data):
    _, _, path = workspace
    s = supplier(client, path)
    assert (
        client.post(path + "/plots", json={**body(s["id"]), **data}).status_code == 422
    )
