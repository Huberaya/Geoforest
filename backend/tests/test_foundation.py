from uuid import uuid4

import pytest
from app.config import Settings, settings
from app.database import transaction
from conftest import owner
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/me",
        "/api/v1/audits",
        "/api/v1/organizations/" + str(uuid4()) + "/members",
    ],
)
def test_anonymous_read_denied(client, path):
    assert client.get(path).status_code == 401


@pytest.mark.parametrize(
    "path", ["/api/v1/organizations", "/api/v1/audit/parcel", "/api/v1/export/traces"]
)
def test_anonymous_write_denied(client, path):
    assert client.post(path, json={"name": "Denied"}).status_code == 401


@pytest.mark.parametrize("csrf,origin", [(False, True), (True, False), (False, False)])
def test_csrf(client, identity, signin, csrf, origin):
    u = identity()
    signin(client, u)
    if not csrf:
        del client.headers["X-CSRF-Token"]
    if not origin:
        client.headers["Origin"] = "https://evil.invalid"
    assert (
        client.post("/api/v1/organizations", json={"name": "No access"}).status_code
        == 403
    )


def test_expired_and_revoked_session(client, identity, signin):
    u = identity(expired=True)
    signin(client, u)
    assert client.get("/api/v1/me").status_code == 401
    u = identity()
    signin(client, u)
    assert client.post("/api/auth/logout").status_code == 204
    signin(client, u)
    assert client.get("/api/v1/me").status_code == 401


def test_org_create_rename_audit_and_conflict(client, identity, signin):
    u = identity()
    signin(client, u)
    r = client.post("/api/v1/organizations", json={"name": "Forêt Démo"})
    assert r.status_code == 201
    o = r.json()["id"]
    assert client.get("/api/v1/me").json()["organizations"][0]["id"] == o
    assert (
        client.patch(
            f"/api/v1/organizations/{o}", json={"name": "Forêt Démo 2", "version": 1}
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/v1/organizations/{o}", json={"name": "Stale", "version": 1}
        ).status_code
        == 409
    )
    events = client.get(f"/api/v1/organizations/{o}/audit").json()
    assert len(events) == 2 and events[0]["previous_value"]["name"] == "Forêt Démo"


@pytest.mark.parametrize(
    "role", ["Compliance Manager", "Procurement", "Analyst", "Viewer", "Supplier"]
)
def test_nonadmin_cannot_mutate(client, identity, signin, org, membership, role):
    a = identity()
    o = org(a["id"])
    u = identity()
    membership(o, u["id"], role, uuid4() if role == "Supplier" else None)
    signin(client, u)
    assert (
        client.patch(
            f"/api/v1/organizations/{o}", json={"name": "No", "version": 1}
        ).status_code
        == 403
    )
    assert client.get(f"/api/v1/organizations/{o}/members").status_code == 403
    assert (
        client.put(
            f"/api/v1/organizations/{o}/members",
            json={"email": u["email"], "role": "Admin"},
        ).status_code
        == 403
    )
    assert client.get(f"/api/v1/organizations/{o}/audit").status_code == (
        200 if role == "Compliance Manager" else 403
    )


def test_cross_tenant_denied_even_when_id_known(client, identity, signin, org):
    a, b = identity(), identity()
    org(a["id"])
    ob = org(b["id"])
    signin(client, a)
    assert len(client.get("/api/v1/me").json()["organizations"]) == 1
    for suffix in ["/members", "/audit"]:
        assert client.get(f"/api/v1/organizations/{ob}{suffix}").status_code == 404
    assert (
        client.patch(
            f"/api/v1/organizations/{ob}", json={"name": "Attack", "version": 1}
        ).status_code
        == 404
    )
    assert (
        client.put(
            f"/api/v1/organizations/{ob}/members",
            json={"email": a["email"], "role": "Admin"},
        ).status_code
        == 404
    )
    assert (
        client.delete(f"/api/v1/organizations/{ob}/members/{b['id']}").status_code
        == 404
    )


def test_member_lifecycle_last_admin_and_revoked_access(client, identity, signin, org):
    a = identity()
    o = org(a["id"])
    b = identity()
    signin(client, a)
    path = f"/api/v1/organizations/{o}/members"
    assert (
        client.put(path, json={"email": b["email"], "role": "Viewer"}).status_code
        == 200
    )
    assert (
        client.put(path, json={"email": a["email"], "role": "Viewer"}).status_code
        == 409
    )
    assert client.delete(path + "/" + str(a["id"])).status_code == 409
    signin(client, b)
    assert len(client.get("/api/v1/me").json()["organizations"]) == 1
    signin(client, a)
    assert client.delete(path + "/" + str(b["id"])).status_code == 204
    signin(client, b)
    assert client.get("/api/v1/me").json()["organizations"] == []


def test_supplier_scope_and_unknown_identity(client, identity, signin, org):
    a = identity()
    o = org(a["id"])
    b = identity()
    signin(client, a)
    path = f"/api/v1/organizations/{o}/members"
    assert (
        client.put(path, json={"email": b["email"], "role": "Supplier"}).status_code
        == 422
    )
    assert (
        client.put(
            path,
            json={"email": b["email"], "role": "Viewer", "supplier_id": str(uuid4())},
        ).status_code
        == 422
    )
    assert (
        client.put(
            path, json={"email": "unknown@example.invalid", "role": "Viewer"}
        ).status_code
        == 422
    )
    assert (
        client.put(
            path,
            json={"email": b["email"], "role": "Supplier", "supplier_id": str(uuid4())},
        ).status_code
        == 422
    )

    supplier = client.post(
        f"/api/v1/organizations/{o}/suppliers",
        json={"reference": "SCOPE-01", "name": "Fournisseur fictif"},
    ).json()
    assert (
        client.put(
            path,
            json={
                "email": b["email"],
                "role": "Supplier",
                "supplier_id": supplier["id"],
            },
        ).status_code
        == 200
    )


def test_sql_rls_with_real_runtime_role(identity, org):
    a, b = identity(), identity()
    oa, ob = org(a["id"]), org(b["id"])
    with transaction(a["id"], oa) as c:
        flags = c.execute(
            text(
                "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user"
            )
        ).one()
        assert flags == (False, False)
        assert c.execute(text("SELECT id FROM organizations")).scalars().all() == [oa]
        assert c.execute(
            text("SELECT organization_id FROM memberships")
        ).scalars().all() == [oa]
        assert c.execute(
            text("SELECT organization_id FROM audit_events")
        ).scalars().all() == [oa]
        assert (
            c.execute(
                text("UPDATE organizations SET name='Forbidden' WHERE id=:o"), {"o": ob}
            ).rowcount
            == 0
        )
    # Switching only the tenant context cannot confer membership.
    with transaction(a["id"], ob) as c:
        assert c.execute(text("SELECT * FROM audit_events")).all() == []
        assert (
            c.execute(
                text("UPDATE organizations SET name='Forbidden' WHERE id=:o"), {"o": ob}
            ).rowcount
            == 0
        )
    with pytest.raises(DBAPIError), transaction(a["id"], oa) as c:
        c.execute(
            text(
                "INSERT INTO memberships(organization_id,user_id,role) VALUES(:o,:u,'Admin')"
            ),
            {"o": ob, "u": a["id"]},
        )
    # A returned pooled connection must not retain any identity.
    with transaction() as c:
        assert c.execute(text("SELECT * FROM organizations")).all() == []


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_events SET action='forged'",
        "DELETE FROM audit_events",
        "CREATE TABLE forbidden(id int)",
    ],
)
def test_runtime_cannot_rewrite_audit_or_schema(identity, org, statement):
    u = identity()
    o = org(u["id"])
    with pytest.raises(DBAPIError), transaction(u["id"], o) as c:
        c.execute(text(statement))


def test_no_legacy_analysis(client, identity, signin):
    u = identity()
    signin(client, u)
    for path in ["/audit/parcel", "/export/traces"]:
        r = client.post("/api/v1" + path, json={"simulated_loss_year": 2019})
        assert r.status_code == 410 and "COMPLIANT" not in r.text


def test_boundaries(client, identity, signin):
    signin(client, identity())
    assert client.post("/api/v1/organizations", content="x" * 70000).status_code == 413
    assert client.post("/api/v1/organizations", json={"name": "x"}).status_code == 422
    assert (
        client.post(
            "/api/v1/organizations",
            json={"name": "valid", "organization_id": str(uuid4())},
        ).status_code
        == 422
    )
    assert client.get("/api/v1/me", headers={"host": "evil.invalid"}).status_code == 400
    assert client.get("/health/ready").status_code == 200


def test_api_limit(client):
    codes = [client.get("/api/v1/me").status_code for _ in range(121)]
    assert codes[-1] == 429


def test_callback_without_state_fails_closed(client):
    r = client.get(
        "/api/auth/callback?code=forged&state=forged", follow_redirects=False
    )
    assert r.status_code == 303 and r.headers["location"] == "/espace?auth_error=1"
    with owner.connect() as c:
        assert c.execute(text("SELECT count(*) FROM sessions")).scalar_one() == 0


def test_production_config_rejects_http_and_missing_mfa():
    with pytest.raises(ValueError):
        Settings(
            app_env="production",
            public_origin="http://localhost",
            oidc_issuer="http://localhost",
        )


def test_mfa_enforced_on_admin_actions(client, identity, signin, org, monkeypatch):
    u = identity()
    o = org(u["id"])
    signin(client, u)
    monkeypatch.setattr(settings(), "admin_acr", "mfa")
    assert (
        client.post("/api/v1/organizations", json={"name": "Blocked"}).status_code
        == 403
    )
    assert client.get(f"/api/v1/organizations/{o}/members").status_code == 403


def test_failed_mutation_leaves_no_audit(client, identity, signin, org):
    u = identity()
    o = org(u["id"])
    signin(client, u)
    client.patch(f"/api/v1/organizations/{o}", json={"name": "Wrong", "version": 9})
    assert len(client.get(f"/api/v1/organizations/{o}/audit").json()) == 1


def test_oidc_success_redirects_to_workspace(client, monkeypatch):
    from app.config import settings

    from app import auth

    class VerifiedOidcClient:
        async def authorize_access_token(self, request):
            return {
                "userinfo": {
                    "iss": settings().oidc_issuer,
                    "sub": "synthetic-public-home-subject",
                    "email_verified": True,
                    "email": "home-test@example.invalid",
                    "name": "Compte fictif",
                }
            }

    async def oidc_client():
        return VerifiedOidcClient()

    monkeypatch.setattr(auth, "oidc_client", oidc_client)
    result = client.get("/api/auth/callback", follow_redirects=False)
    assert result.status_code == 303
    assert result.headers["location"] == "/espace"
    assert client.get("/api/v1/me").status_code == 200
