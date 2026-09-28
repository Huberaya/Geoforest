from urllib.parse import parse_qs, urlsplit

import pytest
from app.config import settings
from app.database import transaction
from app.main import app
from app.security import token_hash
from conftest import owner
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


@pytest.fixture
def workspace(client, identity, signin, org):
    user = identity()
    oid = org(user["id"])
    signin(client, user)
    return user, oid, f"/api/v1/organizations/{oid}"


def supplier(client, path, ref="SUP-01"):
    r = client.post(
        path + "/suppliers",
        json={
            "reference": ref,
            "name": "Coopérative synthétique " + ref,
            "country": "CI",
            "email": "demo@example.invalid",
            "address": "Adresse de démonstration",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def product(client, path, sid, ref="PRD-01"):
    r = client.post(
        path + "/products",
        json={
            "reference": ref,
            "name": "Cacao de démonstration",
            "commodities": ["cocoa"],
            "supplier_ids": [sid],
            "hs_code": "1801",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def invitation(client, path, sid):
    r = client.post(path + f"/suppliers/{sid}/invitations", json={})
    assert r.status_code == 201, r.text
    return r.json()


def portal(invite):
    c = TestClient(app)
    c.headers["Origin"] = settings().public_origin
    token = parse_qs(urlsplit(invite["url"]).fragment)["invite"][0]
    r = c.post("/api/portal/exchange", json={"token": token})
    assert r.status_code == 200, r.text
    c.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    return c, token


def full_payload():
    return {
        "company": {
            "name": "Coopérative synthétique",
            "country": "CI",
            "address": "Adresse de test",
            "email": "demo@example.invalid",
            "contact_name": "Contact fictif",
        },
        "products": [
            {
                "name": "Cacao",
                "commodity": "cocoa",
                "quantity": "25.125",
                "unit": "KG",
                "origin_country": "CI",
            }
        ],
    }


def test_supplier_update_contacts_versions_archive(client, workspace):
    _, oid, path = workspace
    s = supplier(client, path)
    c = client.post(
        path + f"/suppliers/{s['id']}/contacts",
        json={"name": "Contact fictif", "email": "contact@example.invalid"},
    )
    assert c.status_code == 201
    contact = c.json()
    assert (
        client.post(
            path + f"/suppliers/{s['id']}/contacts",
            json={"name": "Contact fictif", "email": "CONTACT@example.invalid"},
        ).status_code
        == 409
    )
    assert (
        client.put(
            path + f"/suppliers/{s['id']}/contacts/{contact['id']}",
            json={"name": "Contact 2", "email": contact["email"], "version": 1},
        ).status_code
        == 200
    )
    assert (
        client.delete(
            path + f"/suppliers/{s['id']}/contacts/{contact['id']}?version=1"
        ).status_code
        == 409
    )
    assert (
        client.delete(
            path + f"/suppliers/{s['id']}/contacts/{contact['id']}?version=2"
        ).status_code
        == 204
    )
    payload = {
        k: s[k]
        for k in [
            "reference",
            "name",
            "country",
            "address",
            "email",
            "legal_type",
            "registration_id",
            "notes",
            "version",
        ]
    }
    payload["name"] = "Nom modifié"
    assert client.put(path + f"/suppliers/{s['id']}", json=payload).status_code == 200
    assert client.put(path + f"/suppliers/{s['id']}", json=payload).status_code == 409
    assert (
        client.post(
            path + f"/suppliers/{s['id']}/archive", json={"version": 2}
        ).status_code
        == 200
    )
    assert client.get(path + "/suppliers").json()["total"] == 0
    assert client.get(path + "/suppliers?include_archived=true").json()["total"] == 1
    assert (
        client.post(path + f"/suppliers/{s['id']}/invitations", json={}).status_code
        == 409
    )


def test_partial_supplier_not_falsely_complete(client, workspace):
    _, _, path = workspace
    r = client.post(
        path + "/suppliers", json={"reference": "MIN-01", "name": "Minimal"}
    )
    assert r.status_code == 201
    row = client.get(path + f"/suppliers/{r.json()['id']}").json()
    assert set(row["missing_fields"]) == {"country", "email", "address"}
    assert (
        row["risk_status"] == "NOT_ASSESSED" and row["plots_status"] == "NOT_AVAILABLE"
    )


def test_supplier_uniqueness_search_pagination(client, workspace):
    _, _, path = workspace
    supplier(client, path, "A-01")
    supplier(client, path, "A-02")
    assert (
        client.post(
            path + "/suppliers", json={"reference": "a-01", "name": "Duplicate"}
        ).status_code
        == 409
    )
    assert client.get(path + "/suppliers?limit=1&page=2").json()["total"] == 2
    assert len(client.get(path + "/suppliers?limit=1&page=2").json()["items"]) == 1
    assert client.get(path + "/suppliers?q=A-02").json()["total"] == 1
    assert client.get(path + "/suppliers?q=%25").json()["total"] == 0


def test_csv_atomic_idempotent_and_preview(client, workspace):
    _, _, path = workspace
    raw = "reference,name,country,email,address\nCSV-01,Démo 1,FR,one@example.invalid,Adresse\nCSV-02,Démo 2,CI,two@example.invalid,Adresse"
    assert client.post(
        path + "/suppliers/import-preview", json={"csv_text": raw}
    ).json()["can_import"]
    r = client.post(path + "/suppliers/import", json={"csv_text": raw})
    assert r.status_code == 200, r.text
    assert r.json()["created_count"] == 2
    assert client.post(path + "/suppliers/import", json={"csv_text": raw}).json()[
        "replayed"
    ]
    bad = "reference,name\nCSV-03,New row\nCSV-01,Existing row"
    assert (
        client.post(path + "/suppliers/import", json={"csv_text": bad}).status_code
        == 409
    )
    assert client.get(path + "/suppliers").json()["total"] == 2


@pytest.mark.parametrize(
    "raw",
    [
        "reference,name,country\nA1,Company,XX",
        "reference,name\nA1,A\nA1,Company",
        "name\nCompany",
        "reference,name,unexpected\nA1,Company,Other",
        "reference,name\n" + "".join(f"R-{i},Company\n" for i in range(101)),
    ],
)
def test_csv_rejects_bad_data_without_partial_write(client, workspace, raw):
    _, _, path = workspace
    assert (
        client.post(path + "/suppliers/import", json={"csv_text": raw}).status_code
        == 422
    )
    assert client.get(path + "/suppliers").json()["total"] == 0


def test_product_lot_precise_quantity_and_relations(client, workspace):
    _, _, path = workspace
    s = supplier(client, path)
    p = product(client, path, s["id"])
    body = {
        "reference": "LOT-01",
        "supplier_id": s["id"],
        "product_id": p["id"],
        "quantity": "123456789.123456",
        "unit": "KG",
    }
    r = client.post(path + "/lots", json=body)
    assert r.status_code == 201, r.text
    assert r.json()["quantity"] == "123456789.123456"
    listed = client.get(path + "/lots").json()["items"][0]
    assert listed["quantity"] == "123456789.123456"
    assert listed["missing_fields"] == [
        "origin_country",
        "production_start",
        "production_end",
    ]
    assert p["regulatory_status"] == "NOT_ASSESSED"
    # FK prevents unlinking a supplier/product pair used by a lot; no partial update.
    edited = {
        k: p[k]
        for k in [
            "reference",
            "name",
            "hs_code",
            "description",
            "commodities",
            "supplier_ids",
            "version",
        ]
    }
    edited["supplier_ids"] = []
    assert client.put(path + f"/products/{p['id']}", json=edited).status_code == 409
    assert client.get(path + "/products").json()["items"][0]["version"] == 1
    assert (
        client.put(
            path + f"/lots/{r.json()['id']}",
            json={
                **body,
                "version": 1,
                "origin_country": "CI",
                "production_start": "2025-01-01",
                "production_end": "2025-01-31",
            },
        ).status_code
        == 200
    )
    assert client.get(path + "/lots").json()["items"][0]["missing_fields"] == []
    assert (
        client.post(
            path + f"/lots/{r.json()['id']}/archive", json={"version": 2}
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    "change",
    [
        {"quantity": "0"},
        {"quantity": "-1"},
        {"quantity": "NaN"},
        {"quantity": "1.1234567"},
        {"unit": "BOGUS"},
        {"origin_country": "ZZ"},
        {"production_start": "2025-02-02", "production_end": "2025-01-01"},
        {"production_end": "2999-01-01"},
    ],
)
def test_invalid_lots(client, workspace, change):
    _, _, path = workspace
    s = supplier(client, path)
    p = product(client, path, s["id"])
    payload = {
        "reference": "LOT-01",
        "supplier_id": s["id"],
        "product_id": p["id"],
        "quantity": "10",
        "unit": "KG",
        **change,
    }
    assert client.post(path + "/lots", json=payload).status_code == 422
    assert client.get(path + "/lots").json()["total"] == 0


def test_cross_tenant_api_and_composite_sql_foreign_keys(
    client, workspace, identity, signin, org
):
    a, oa, path = workspace
    sa = supplier(client, path)
    pa = product(client, path, sa["id"])
    b = identity()
    ob = org(b["id"])
    signin(client, b)
    pathb = f"/api/v1/organizations/{ob}"
    sb = supplier(client, pathb)
    assert client.get(path + f"/suppliers/{sa['id']}").status_code == 404
    assert client.get(pathb + f"/suppliers/{sa['id']}").status_code == 404
    assert (
        client.post(
            pathb + "/products",
            json={
                "reference": "BAD-01",
                "name": "Bad relation",
                "commodities": ["cocoa"],
                "supplier_ids": [sa["id"]],
            },
        ).status_code
        == 404
    )
    assert client.get(pathb + "/products").json()["total"] == 0
    with pytest.raises(DBAPIError), transaction(b["id"], ob) as conn:
        conn.execute(
            text("INSERT INTO supplier_products VALUES(:o,:s,:p)"),
            {"o": ob, "s": sb["id"], "p": pa["id"]},
        )
    with transaction(a["id"], ob) as conn:
        assert conn.execute(text("SELECT * FROM suppliers")).all() == []
    with transaction(a["id"], oa) as conn:
        assert conn.execute(text("SELECT id FROM suppliers")).scalars().all() == [
            __import__("uuid").UUID(sa["id"])
        ]


@pytest.mark.parametrize("role", ["Viewer", "Analyst", "Supplier"])
def test_readonly_roles_cannot_write(
    client, workspace, identity, signin, membership, role
):
    _, oid, path = workspace
    s = supplier(client, path)
    u = identity()
    membership(oid, u["id"], role, s["id"] if role == "Supplier" else None)
    signin(client, u)
    assert (
        client.post(
            path + "/suppliers", json={"reference": "BAD-01", "name": "No"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            path + "/products",
            json={"reference": "BAD-01", "name": "No", "commodities": ["wood"]},
        ).status_code
        == 403
    )
    assert (
        client.post(path + f"/suppliers/{s['id']}/invitations", json={}).status_code
        == 403
    )


def test_oidc_supplier_reads_only_own_supply_data(
    client, workspace, identity, signin, membership
):
    _, oid, path = workspace
    sa = supplier(client, path, "SUP-A")
    sb = supplier(client, path, "SUP-B")
    pa = product(client, path, sa["id"])
    product(client, path, sb["id"], "PRD-B")
    u = identity()
    membership(oid, u["id"], "Supplier", sa["id"])
    signin(client, u)
    assert [r["id"] for r in client.get(path + "/suppliers").json()["items"]] == [
        sa["id"]
    ]
    assert [r["id"] for r in client.get(path + "/products").json()["items"]] == [
        pa["id"]
    ]
    assert client.get(path + f"/suppliers/{sb['id']}").status_code == 404
    with transaction(u["id"], oid) as conn:
        assert len(conn.execute(text("SELECT * FROM suppliers")).all()) == 1
        assert len(conn.execute(text("SELECT * FROM products")).all()) == 1


def test_portal_lifecycle_and_revision_history(client, workspace):
    _, oid, path = workspace
    s = supplier(client, path)
    inv = invitation(client, path, s["id"])
    pc, secret = portal(inv)
    assert pc.post("/api/portal/exchange", json={"token": secret}).status_code == 401
    me = pc.get("/api/portal/me").json()
    c = me["collections"][0]
    assert c["completeness"]["percent"] < 100
    assert (
        pc.post(
            f"/api/portal/collections/{c['id']}/submit",
            json={"version": c["version"], "confirmed": True},
        ).status_code
        == 422
    )
    saved = pc.put(
        f"/api/portal/collections/{c['id']}",
        json={"version": c["version"], "payload": full_payload()},
    )
    assert saved.status_code == 200, saved.text
    assert (
        pc.put(
            f"/api/portal/collections/{c['id']}",
            json={"version": c["version"], "payload": full_payload()},
        ).status_code
        == 409
    )
    r = pc.post(
        f"/api/portal/collections/{c['id']}/submit",
        json={"version": saved.json()["version"], "confirmed": True},
    )
    assert r.status_code == 200, r.text
    submitted = r.json()
    assert (
        submitted["status"] == "SUBMITTED"
        and submitted["completeness"]["percent"] == 100
    )
    assert (
        pc.put(
            f"/api/portal/collections/{c['id']}",
            json={"version": submitted["version"], "payload": full_payload()},
        ).status_code
        == 409
    )
    review_path = path + f"/suppliers/{s['id']}/collections/{c['id']}/review"
    reviewed = client.post(
        review_path,
        json={
            "version": submitted["version"],
            "decision": "CHANGES_REQUESTED",
            "note": "Merci de vérifier la quantité.",
        },
    )
    assert reviewed.status_code == 200, reviewed.text
    assert (
        pc.get("/api/portal/me").json()["collections"][0]["status"]
        == "CHANGES_REQUESTED"
    )
    r = pc.post(
        f"/api/portal/collections/{c['id']}/submit",
        json={"version": reviewed.json()["version"], "confirmed": True},
    )
    assert r.status_code == 200
    reviewed = client.post(
        review_path,
        json={
            "version": r.json()["version"],
            "decision": "REVIEWED",
            "note": "Collecte initiale relue, sans décision EUDR.",
        },
    )
    assert reviewed.status_code == 200
    with owner.connect() as conn:
        assert (
            conn.execute(text("SELECT count(*) FROM collection_revisions")).scalar_one()
            == 2
        )
        assert (
            conn.execute(
                text("SELECT count(*) FROM audit_events WHERE actor_kind='supplier'")
            ).scalar_one()
            >= 4
        )
        assert secret not in str(
            conn.execute(text("SELECT new_value FROM audit_events")).all()
        )
    assert pc.post("/api/portal/logout").status_code == 204
    assert pc.get("/api/portal/me").status_code == 401


def test_portal_cannot_reach_staff_or_other_supplier(client, workspace):
    _, _, path = workspace
    sa = supplier(client, path, "SUP-A")
    sb = supplier(client, path, "SUP-B")
    ia = invitation(client, path, sa["id"])
    invitation(client, path, sb["id"])
    cb = client.get(path + f"/suppliers/{sb['id']}").json()["collections"][0]
    pc, _ = portal(ia)
    assert pc.get(path + "/suppliers").status_code == 401
    assert pc.get("/api/v1/me").status_code == 401
    assert (
        pc.put(
            "/api/portal/collections/" + cb["id"],
            json={"version": cb["version"], "payload": full_payload()},
        ).status_code
        == 404
    )
    hashed = token_hash(pc.cookies.get(settings().portal_cookie))
    with transaction(portal_session=hashed) as conn:
        assert len(conn.execute(text("SELECT * FROM supplier_collections")).all()) == 1
        assert conn.execute(text("SELECT * FROM suppliers")).all() == []
        assert conn.execute(text("SELECT * FROM products")).all() == []
    with pytest.raises(DBAPIError), transaction(portal_session=hashed) as conn:
        conn.execute(text("UPDATE collection_revisions SET payload='{}'"))


@pytest.mark.parametrize(
    "mode", ["expired", "revoked", "reissued", "archived", "session_expired"]
)
def test_invitation_and_session_invalidated(client, workspace, mode):
    _, oid, path = workspace
    s = supplier(client, path)
    inv = invitation(client, path, s["id"])
    pc, _ = portal(inv)
    if mode == "revoked":
        assert (
            client.delete(
                path + f"/suppliers/{s['id']}/invitations/{inv['id']}"
            ).status_code
            == 204
        )
    elif mode == "reissued":
        invitation(client, path, s["id"])
    elif mode == "archived":
        client.post(
            path + f"/suppliers/{s['id']}/archive", json={"version": s["version"]}
        )
    else:
        with owner.begin() as conn:
            conn.execute(
                text(
                    "UPDATE "
                    + (
                        "supplier_sessions"
                        if mode == "session_expired"
                        else "supplier_invitations"
                    )
                    + " SET expires_at=now()-interval '1 second'"
                )
            )
    assert pc.get("/api/portal/me").status_code == 401


def test_portal_origin_csrf_and_no_secret_retrieval(client, workspace):
    _, _, path = workspace
    s = supplier(client, path)
    inv = invitation(client, path, s["id"])
    assert inv["delivery"] == "MANUAL" and "token_hash" not in inv
    token = parse_qs(urlsplit(inv["url"]).fragment)["invite"][0]
    pc = TestClient(app)
    assert pc.post("/api/portal/exchange", json={"token": token}).status_code == 403
    pc, _ = portal(inv)
    c = pc.get("/api/portal/me").json()["collections"][0]
    del pc.headers["X-CSRF-Token"]
    assert (
        pc.put(
            f"/api/portal/collections/{c['id']}",
            json={"version": c["version"], "payload": full_payload()},
        ).status_code
        == 403
    )
    listed = client.get(path + f"/suppliers/{s['id']}").json()
    assert token not in str(listed) and "token_hash" not in str(listed)


def test_procurement_can_collect_but_not_review(
    client, workspace, identity, signin, membership
):
    _, oid, path = workspace
    s = supplier(client, path)
    invitation(client, path, s["id"])
    c = client.get(path + f"/suppliers/{s['id']}").json()["collections"][0]
    u = identity()
    membership(oid, u["id"], "Procurement")
    signin(client, u)
    assert (
        client.post(path + f"/suppliers/{s['id']}/invitations", json={}).status_code
        == 201
    )
    assert (
        client.post(
            path + f"/suppliers/{s['id']}/collections/{c['id']}/review",
            json={"version": 1, "decision": "REVIEWED", "note": "No review permission"},
        ).status_code
        == 403
    )


@pytest.mark.parametrize(
    "raw",
    [
        'reference,name\nA1,"inachevé',
        '"reference,name\nA1,Company',
        "reference,name\nA1,Company,extra",
        "reference,reference,name\nA1,A2,Company",
    ],
)
def test_malformed_csv_is_422(client, workspace, raw):
    _, _, path = workspace
    assert (
        client.post(path + "/suppliers/import", json={"csv_text": raw}).status_code
        == 422
    )
    assert client.get(path + "/suppliers").json()["total"] == 0


@pytest.mark.parametrize("mode", ["expired", "revoked", "archived"])
def test_unopened_invitation_invalidated(client, workspace, mode):
    _, _, path = workspace
    s = supplier(client, path)
    inv = invitation(client, path, s["id"])
    secret = parse_qs(urlsplit(inv["url"]).fragment)["invite"][0]
    if mode == "expired":
        with owner.begin() as conn:
            conn.execute(
                text(
                    "UPDATE supplier_invitations SET expires_at=now()-interval '1 second'"
                )
            )
    elif mode == "revoked":
        client.delete(path + f"/suppliers/{s['id']}/invitations/{inv['id']}")
    else:
        client.post(
            path + f"/suppliers/{s['id']}/archive", json={"version": s["version"]}
        )
    with TestClient(app) as pc:
        pc.headers["Origin"] = settings().public_origin
        assert (
            pc.post("/api/portal/exchange", json={"token": secret}).status_code == 401
        )


def test_submission_requires_explicit_confirmation_and_refuses_extra_fields(
    client, workspace
):
    _, _, path = workspace
    s = supplier(client, path)
    pc, _ = portal(invitation(client, path, s["id"]))
    c = pc.get("/api/portal/me").json()["collections"][0]
    for confirmed in [False, None]:
        assert (
            pc.post(
                f"/api/portal/collections/{c['id']}/submit",
                json={"version": c["version"], "confirmed": confirmed},
            ).status_code
            == 422
        )
    assert (
        pc.put(
            f"/api/portal/collections/{c['id']}",
            json={
                "version": c["version"],
                "payload": full_payload(),
                "supplier_id": s["id"],
                "status": "REVIEWED",
            },
        ).status_code
        == 422
    )
    assert (
        pc.put(
            f"/api/portal/collections/{c['id']}",
            json={"version": c["version"], "payload": full_payload()},
            headers={"Origin": "https://attacker.invalid"},
        ).status_code
        == 403
    )


def test_reviewed_source_and_new_collection_never_overwrite_reference_data(
    client, workspace
):
    _, oid, path = workspace
    s = supplier(client, path)
    p = product(client, path, s["id"])
    pc, _ = portal(invitation(client, path, s["id"]))
    c = pc.get("/api/portal/me").json()["collections"][0]
    lot = {
        "reference": "SOURCE-01",
        "supplier_id": s["id"],
        "product_id": p["id"],
        "quantity": "10",
        "unit": "KG",
        "source_collection_id": c["id"],
    }
    assert client.post(path + "/lots", json=lot).status_code == 422
    payload = full_payload()
    payload["company"]["name"] = "Proposition différente du canonique"
    saved = pc.put(
        "/api/portal/collections/" + c["id"],
        json={"version": c["version"], "payload": payload},
    ).json()
    submitted = pc.post(
        "/api/portal/collections/" + c["id"] + "/submit",
        json={"version": saved["version"], "confirmed": True},
    ).json()
    # Reissuing an invitation during review cannot manufacture an editable draft.
    new, _ = portal(invitation(client, path, s["id"]))
    me = new.get("/api/portal/me").json()
    assert len(me["collections"]) == 1 and me["collections"][0]["status"] == "SUBMITTED"
    reviewed = client.post(
        path + f"/suppliers/{s['id']}/collections/{c['id']}/review",
        json={
            "version": submitted["version"],
            "decision": "REVIEWED",
            "note": "Revue humaine initiale uniquement",
        },
    )
    assert reviewed.status_code == 200
    assert client.post(path + "/lots", json=lot).status_code == 201
    assert client.get(path + f"/suppliers/{s['id']}").json()["name"] == s["name"]
    fresh, _ = portal(invitation(client, path, s["id"]))
    collections = fresh.get("/api/portal/me").json()["collections"]
    assert (
        len(collections) == 2
        and collections[0]["id"] != c["id"]
        and collections[0]["status"] == "DRAFT"
    )
    assert collections[0]["payload"]["company"]["name"] == payload["company"]["name"]
    with transaction(
        portal_session=token_hash(fresh.cookies.get(settings().portal_cookie))
    ) as conn:
        assert len(conn.execute(text("SELECT * FROM collection_revisions")).all()) == 1
    with (
        pytest.raises(DBAPIError),
        transaction(
            portal_session=token_hash(fresh.cookies.get(settings().portal_cookie))
        ) as conn,
    ):
        conn.execute(text("DELETE FROM collection_revisions"))


def test_product_supplier_filter_and_archived_relations(client, workspace):
    _, _, path = workspace
    sa = supplier(client, path, "SUP-A")
    sb = supplier(client, path, "SUP-B")
    pa = product(client, path, sa["id"])
    product(client, path, sb["id"], "PRD-B")
    assert [
        p["id"]
        for p in client.get(path + "/products?supplier_id=" + sa["id"]).json()["items"]
    ] == [pa["id"]]
    assert (
        client.post(
            path + f"/products/{pa['id']}/archive", json={"version": 1}
        ).status_code
        == 200
    )
    assert (
        client.post(
            path + "/lots",
            json={
                "reference": "FAIL-01",
                "supplier_id": sa["id"],
                "product_id": pa["id"],
                "quantity": "10",
                "unit": "KG",
            },
        ).status_code
        == 409
    )


def test_supplier_portal_attempts_rate_limited(client):
    client.headers["Origin"] = settings().public_origin
    for _ in range(10):
        assert (
            client.post("/api/portal/exchange", json={"token": "a" * 64}).status_code
            == 401
        )
    assert (
        client.post("/api/portal/exchange", json={"token": "a" * 64}).status_code == 429
    )


def test_portal_isolation_between_organizations_and_pool_reset(
    client, workspace, identity, signin, org
):
    _, oa, path = workspace
    sa = supplier(client, path)
    inv = invitation(client, path, sa["id"])
    pc, _ = portal(inv)
    other = identity()
    ob = org(other["id"])
    signin(client, other)
    otherpath = f"/api/v1/organizations/{ob}"
    sb = supplier(client, otherpath)
    invitation(client, otherpath, sb["id"])
    cb = client.get(otherpath + f"/suppliers/{sb['id']}").json()["collections"][0]
    assert (
        pc.put(
            "/api/portal/collections/" + cb["id"],
            json={"version": cb["version"], "payload": full_payload()},
        ).status_code
        == 404
    )
    hashed = token_hash(pc.cookies.get(settings().portal_cookie))
    with transaction(organization_id=ob, portal_session=hashed) as conn:
        rows = (
            conn.execute(text("SELECT organization_id FROM supplier_collections"))
            .scalars()
            .all()
        )
        assert rows == [
            oa
        ]  # Authorization derives from the session, never the supplied org context.
    with transaction() as conn:
        assert conn.execute(text("SELECT * FROM supplier_collections")).all() == []
    with pytest.raises(DBAPIError), transaction(portal_session=hashed) as conn:
        conn.execute(text("SELECT * FROM supplier_sessions"))
    with pytest.raises(DBAPIError), transaction(portal_session=hashed) as conn:
        conn.execute(
            text(
                "INSERT INTO suppliers(organization_id,reference,name) VALUES(:o,'BAD-01','Invalid')"
            ),
            {"o": oa},
        )


def test_readiness_refuses_obsolete_schema(client):
    with owner.begin() as conn:
        conn.execute(text("UPDATE alembic_version SET version_num='0001'"))
    try:
        assert client.get("/health/ready").status_code == 503
    finally:
        with owner.begin() as conn:
            conn.execute(text("UPDATE alembic_version SET version_num='0003'"))


@pytest.mark.parametrize("role", ["Admin", "Compliance Manager", "Procurement"])
def test_allowed_writers_can_create_and_audit(
    client, workspace, identity, signin, membership, role
):
    _, oid, path = workspace
    u = identity()
    membership(oid, u["id"], role)
    signin(client, u)
    s = supplier(client, path)
    with owner.connect() as conn:
        assert (
            conn.execute(
                text(
                    "SELECT actor_id FROM audit_events WHERE action='supplier.created' AND object_id=:id"
                ),
                {"id": s["id"]},
            ).scalar_one()
            == u["id"]
        )
