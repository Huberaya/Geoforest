import json
from uuid import uuid4

import pytest
from app.config import settings
from app.database import transaction
from app.diligence.core import fingerprint
from app.documents.compliance import LEGAL, RISK
from conftest import owner
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_documents_api import accept, criteria, documentary_storage, lot, upload
from test_supply import invitation, portal, supplier, workspace

assert documentary_storage and workspace


@pytest.fixture(autouse=True)
def enable(monkeypatch):
    monkeypatch.setattr(settings(), "diligence_enabled", True)


def prepare_body(lid, **updates):
    return {
        "request_id": str(uuid4()),
        "title": "Dossier entièrement fictif",
        "declaration": {"preparation": {}, "lots": [{"lot_id": lid}]},
    } | updates


def fixture(client, workspace):
    _, _, path = workspace
    s = supplier(client, path)
    lot_data = lot(client, path, s["id"])
    return path, s, lot_data


def create(client, path, body):
    r = client.post(path + "/diligence/revisions", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    url = path + f"/diligence/{d['dossier_id']}/revisions/{d['revision']}"
    return d, url


def decision(client, url, action="SUBMIT_FOR_REVIEW", version=1, **extra):
    return client.post(
        url + "/decisions",
        json={
            "request_id": str(uuid4()),
            "version": version,
            "action": action,
            "note": "Décision fictive pour la recette seulement",
            "acknowledged": True,
        }
        | extra,
    )


def test_prepare_replay_export_and_audit(client, workspace):
    path, _, lot_data = fixture(client, workspace)
    body = prepare_body(lot_data["id"])
    d, url = create(client, path, body)
    assert (
        client.post(path + "/diligence/revisions", json=body).json()["dossier_id"]
        == d["dossier_id"]
    )
    assert (
        client.post(
            path + "/diligence/revisions", json=body | {"title": "Different title"}
        ).status_code
        == 409
    )
    view = client.get(url).json()
    assert view["source_matches"]
    assert view["checks_now"]["status"] == "BLOCKED"
    r = client.get(url + "/export.json")
    assert r.status_code == 200, r.text
    payload = r.json()
    assert fingerprint(payload["snapshot"]) == payload["snapshot_sha256"]
    assert (
        payload["snapshot"]["official_submission_status"]
        == "NOT_SUBMITTED_BY_GEOFOREST"
    )
    assert r.headers["cache-control"] == "no-store"
    assert "attachment;" in r.headers["content-disposition"]
    assert client.get(path + "/diligence").json()["total"] == 1
    with owner.connect() as c:
        assert (
            c.execute(
                text(
                    "SELECT count(*) FROM audit_events WHERE action='diligence.prepared'"
                )
            ).scalar_one()
            == 1
        )
        assert (
            c.execute(
                text(
                    "SELECT count(*) FROM audit_events WHERE action='diligence.exported'"
                )
            ).scalar_one()
            == 1
        )


def test_blocked_validation_corrections_and_new_revision(client, workspace):
    path, _, lot_data = fixture(client, workspace)
    body = prepare_body(lot_data["id"])
    d, url = create(client, path, body)
    assert decision(client, url).status_code == 200
    assert decision(client, url, "VALIDATE_INTERNALLY", 2).status_code == 409
    assert decision(client, url, "REQUEST_CHANGES", 2).status_code == 200
    body2 = body | {
        "request_id": str(uuid4()),
        "dossier_id": d["dossier_id"],
        "expected_revision": 1,
    }
    new, url2 = create(client, path, body2)
    assert new["revision"] == 2
    assert decision(client, url, "WITHDRAW_INTERNALLY", 3).status_code == 409
    assert client.get(url).json()["state"] == "CHANGES_REQUESTED"
    assert client.get(url2).json()["state"] == "DRAFT"
    assert (
        client.post(
            path + "/diligence/revisions", json=body2 | {"request_id": str(uuid4())}
        ).status_code
        == 409
    )


def test_stale_supplier_product_and_archived_lot(client, workspace):
    path, _, lot_data = fixture(client, workspace)
    _, url = create(client, path, prepare_body(lot_data["id"]))
    with owner.begin() as c:
        c.execute(
            text(
                "UPDATE products SET description='Description de recette modifiée' WHERE id=:p"
            ),
            {"p": lot_data["product_id"]},
        )
    assert client.get(url).json()["source_matches"] is False
    assert decision(client, url).status_code == 409
    with owner.begin() as c:
        c.execute(
            text("UPDATE lots SET archived_at=now() WHERE id=:lot_data"),
            {"lot_data": lot_data["id"]},
        )
    assert client.get(url).status_code == 200
    r = client.get(url + "/export.json")
    assert r.status_code == 200
    assert not r.json()["source_matches_now"]


@pytest.mark.parametrize("role", ["Viewer", "Analyst", "Supplier"])
def test_roles_and_rls(client, workspace, role):
    user, oid, path = workspace
    _, s, lot_data = fixture(client, workspace)
    _, url = create(client, path, prepare_body(lot_data["id"]))
    with owner.begin() as c:
        c.execute(
            text(
                "UPDATE memberships SET role=:r,supplier_id=:s WHERE organization_id=:o AND user_id=:u"
            ),
            {
                "r": role,
                "s": s["id"] if role == "Supplier" else None,
                "o": oid,
                "u": user["id"],
            },
        )
    assert client.get(url).status_code == (403 if role == "Supplier" else 200)
    assert client.get(url + "/export.json").status_code == (
        403 if role == "Supplier" else 200
    )
    assert (
        client.post(
            path + "/diligence/revisions", json=prepare_body(lot_data["id"])
        ).status_code
        == 403
    )
    assert decision(client, url).status_code == 403
    if role == "Supplier":
        with transaction(user["id"], oid) as c:
            assert (
                c.execute(text("SELECT count(*) FROM diligence_revisions")).scalar_one()
                == 0
            )


def test_other_organization_and_portal(client, workspace, identity, org, signin):
    _, oid, path = workspace
    _, s, lot_data = fixture(client, workspace)
    _, url = create(client, path, prepare_body(lot_data["id"]))
    p, _ = portal(invitation(client, path, s["id"]))
    assert p.get(url).status_code == 401
    other = identity()
    other_org = org(other["id"])
    signin(client, other)
    assert client.get(url).status_code == 404
    foreign_path = f"/api/v1/organizations/{other_org}"
    assert (
        client.post(
            foreign_path + "/diligence/revisions", json=prepare_body(lot_data["id"])
        ).status_code
        == 404
    )
    with transaction(other["id"], other_org) as c:
        assert (
            c.execute(text("SELECT count(*) FROM diligence_dossiers")).scalar_one() == 0
        )
    with transaction() as c:
        assert (
            c.execute(text("SELECT count(*) FROM diligence_decisions")).scalar_one()
            == 0
        )


def test_decision_idempotence_optimistic_version_and_immutability(client, workspace):
    user, oid, path = workspace
    _, _, lot_data = fixture(client, workspace)
    d, url = create(client, path, prepare_body(lot_data["id"]))
    q = str(uuid4())
    r = decision(client, url, request_id=q)
    assert r.status_code == 200, r.text
    replay = decision(client, url, request_id=q)
    assert replay.json()["id"] == r.json()["id"]
    assert (
        decision(
            client, url, request_id=q, note="Une autre note de décision fictive"
        ).status_code
        == 409
    )
    assert decision(client, url, "REQUEST_CHANGES", 1).status_code == 409
    for sql in [
        "UPDATE diligence_revisions SET snapshot='{}'::jsonb",
        "DELETE FROM diligence_revisions",
        "UPDATE diligence_decisions SET note='Corruption fictive interdite'",
        "DELETE FROM diligence_dossiers",
    ]:
        with pytest.raises(DBAPIError), transaction(user["id"], oid) as c:
            c.execute(text(sql))
    assert client.get(url).json()["snapshot_sha256"] == d["snapshot_sha256"]


def test_client_cannot_supply_facts_or_official_state(client, workspace):
    path, _, lot_data = fixture(client, workspace)
    b = prepare_body(lot_data["id"])
    b["declaration"]["lots"][0]["risk"] = {"proposed_residual": "NEGLIGIBLE"}
    assert client.post(path + "/diligence/revisions", json=b).status_code == 422
    _, url = create(client, path, prepare_body(lot_data["id"]))
    assert decision(client, url, "DECLARE_IN_TRACES").status_code == 422


def test_feature_disabled_and_revoked_session(client, workspace, monkeypatch):
    user, _, path = workspace
    _, _, lot_data = fixture(client, workspace)
    monkeypatch.setattr(settings(), "diligence_enabled", False)
    assert (
        client.post(
            path + "/diligence/revisions", json=prepare_body(lot_data["id"])
        ).status_code
        == 503
    )
    monkeypatch.setattr(settings(), "diligence_enabled", True)
    with owner.begin() as c:
        c.execute(
            text("UPDATE sessions SET revoked_at=now() WHERE user_id=:u"),
            {"u": user["id"]},
        )
    assert client.get(path + "/diligence").status_code == 401


def ready_dossier(client, workspace):
    path, s, lot_data = fixture(client, workspace)
    with owner.begin() as c:
        c.execute(
            text(
                "UPDATE products SET description='Fèves fictives pour la recette' WHERE id=:p"
            ),
            {"p": lot_data["product_id"]},
        )
    p = client.post(
        path + "/plots",
        json={
            "supplier_id": s["id"],
            "reference": "DIL-PLOT",
            "name": "Parcelle synthétique",
            "country": "CI",
            "commodity": "cocoa",
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [-5.5, 5.5],
                        [-5.499, 5.5],
                        [-5.499, 5.499],
                        [-5.5, 5.499],
                        [-5.5, 5.5],
                    ]
                ],
            },
            "acknowledge_warnings": True,
        },
    )
    assert p.status_code == 201, p.text
    r = client.put(
        path + f"/lots/{lot_data['id']}/plots",
        json={
            "version": lot_data["version"],
            "plots": [{"plot_id": p.json()["id"], "revision": 1}],
        },
    )
    assert r.status_code == 200, r.text
    proof, _, _ = upload(client, path, s["id"], lot_id=lot_data["id"])
    accept(client, path, proof)
    base = path + "/compliance/lots/" + lot_data["id"]
    ctx = client.get(base).json()
    r = client.post(
        base + "/legality",
        json={
            "input_sha256": ctx["legality_input_sha256"],
            "country": "CI",
            "production_period": "2025-01-01/2025-12-31",
            "framework_qualified": True,
            "criteria": criteria(LEGAL, "CLEAR"),
            "evidence_version_ids": [proof["id"]],
            "note": "Qualification fictive uniquement pour le test",
        },
    )
    assert r.status_code == 200, r.text
    ctx = client.get(base).json()
    r = client.post(
        base + "/risk",
        json={
            "input_sha256": ctx["input_sha256"],
            "criteria": criteria(RISK, "CLEAR"),
            "evidence_version_ids": [proof["id"]],
            "proposed_residual": "NEGLIGIBLE",
            "note": "Conclusion fictive, preuves alternatives de recette",
        },
    )
    assert r.status_code == 200, r.text
    b = prepare_body(lot_data["id"])
    b["declaration"]["preparation"] = {
        "operator_name": "Opérateur fictif",
        "operator_address": "Adresse fictive France",
        "regime": "ORDINARY_OPERATOR",
        "regime_reference": "Référence fictive de régime de recette uniquement",
        "trade_flow": "DOMESTIC",
        "product_scope_confirmed": True,
        "product_scope_reference": "Annexe I examinée fictivement pour recette",
        "supply_chain_complete_confirmed": True,
        "supply_chain_note": "Chaîne entièrement fictive examinée pour test",
    }
    b["declaration"]["lots"][0].update(
        {
            "additional_unit_reviewed": True,
            "additional_unit_note": "Unités examinées fictivement",
            "geolocation_complete_confirmed": True,
        }
    )
    d, url = create(client, path, b)
    assert (
        d["snapshot"]["checks_at_preparation"]["status"] == "READY_FOR_INTERNAL_REVIEW"
    ), json.dumps(d["snapshot"]["checks_at_preparation"])
    return d, url, proof


def test_real_context_validation_and_withdrawal(client, workspace):
    d, url, _ = ready_dossier(client, workspace)
    assert decision(client, url).status_code == 200
    r = decision(client, url, "VALIDATE_INTERNALLY", 2)
    assert r.status_code == 200, r.text
    assert r.json()["new_state"] == "INTERNALLY_VALIDATED"
    exported = client.get(url + "/export.json").json()
    assert exported["source_matches_now"]
    assert (
        exported["snapshot"]["sources"][0]["geolocations"][0]["payload"]["geometry"][
            "type"
        ]
        == "Polygon"
    )
    assert decision(client, url, "WITHDRAW_INTERNALLY", 3).status_code == 200
    assert client.get(url).json()["snapshot_sha256"] == d["snapshot_sha256"]


def test_missing_blob_blocks_validation(client, workspace):
    _, url, proof = ready_dossier(client, workspace)
    assert decision(client, url).status_code == 200
    from pathlib import Path

    with owner.connect() as c:
        r = c.execute(
            text("SELECT organization_id,object_id FROM document_versions WHERE id=:v"),
            {"v": proof["id"]},
        ).one()
    (Path(settings().document_storage_root) / r[0].hex / r[1].hex).unlink()
    assert decision(client, url, "VALIDATE_INTERNALLY", 2).status_code == 409
    assert client.get(url).json()["source_matches"] is False


@pytest.mark.parametrize("role", ["Procurement", "Compliance Manager"])
def test_preparer_and_reviewer_roles(client, workspace, role):
    user, oid, path = workspace
    _, url, _ = ready_dossier(client, workspace)
    with owner.begin() as c:
        c.execute(
            text(
                "UPDATE memberships SET role=:r WHERE organization_id=:o AND user_id=:u"
            ),
            {"r": role, "o": oid, "u": user["id"]},
        )
    assert decision(client, url).status_code == 200
    r = decision(client, url, "VALIDATE_INTERNALLY", 2)
    assert r.status_code == (403 if role == "Procurement" else 200), r.text


def test_concurrent_idempotent_creation(client, workspace):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    path, _, lot_data = fixture(client, workspace)
    body = prepare_body(lot_data["id"])
    barrier = Barrier(2)

    def attempt(_):
        barrier.wait(timeout=5)
        return client.post(path + "/diligence/revisions", json=body).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(attempt, range(2)))
    assert 200 in statuses and all(s in {200, 409} for s in statuses)
    replay = client.post(path + "/diligence/revisions", json=body)
    assert replay.status_code == 200, replay.text
    with owner.connect() as c:
        assert (
            c.execute(text("SELECT count(*) FROM diligence_revisions")).scalar_one()
            == 1
        )


def test_concurrent_decisions_one_wins(client, workspace):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    path, _, lot_data = fixture(client, workspace)
    _, url = create(client, path, prepare_body(lot_data["id"]))
    assert decision(client, url).status_code == 200
    barrier = Barrier(2)

    def attempt(action):
        barrier.wait(timeout=5)
        return decision(client, url, action, 2).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(
            pool.map(attempt, ["REQUEST_CHANGES", "WITHDRAW_INTERNALLY"])
        ) == [200, 409]
    with owner.connect() as c:
        assert (
            c.execute(text("SELECT count(*) FROM diligence_decisions")).scalar_one()
            == 2
        )


@pytest.mark.parametrize("context", ["none", "foreign"])
def test_membership_lock_function_denies_missing_or_foreign_context(
    client, workspace, context
):
    user, oid, _ = workspace
    with (
        pytest.raises(DBAPIError),
        transaction(
            user["id"] if context == "foreign" else None,
            uuid4() if context == "foreign" else None,
        ) as c,
    ):
        c.execute(text("SELECT authz.lock_diligence_member(:o)"), {"o": oid})


def test_new_product_data_rechecked_before_validation(client, workspace):
    _, url, _ = ready_dossier(client, workspace)
    assert decision(client, url).status_code == 200
    with owner.begin() as c:
        c.execute(text("UPDATE products SET hs_code='4401'"))
    assert decision(client, url, "VALIDATE_INTERNALLY", 2).status_code == 409
    assert client.get(url).json()["state"] == "IN_REVIEW"


def test_submission_requires_fresh_source_but_closure_remains_possible(
    client, workspace
):
    path, _, lot_data = fixture(client, workspace)
    _, url = create(client, path, prepare_body(lot_data["id"]))
    assert decision(client, url).status_code == 200
    with owner.begin() as c:
        c.execute(text("UPDATE lots SET archived_at=now()"))
    assert decision(client, url, "WITHDRAW_INTERNALLY", 2).status_code == 200
    out = client.get(url + "/export.json").json()
    assert out["internal_state"] == "INTERNALLY_WITHDRAWN"
    assert out["decisions"][-1]["action"] == "WITHDRAW_INTERNALLY"
    assert not out["source_matches_now"]


def test_historical_validation_not_presented_as_current(client, workspace):
    old, url, _ = ready_dossier(client, workspace)
    assert decision(client, url).status_code == 200
    assert decision(client, url, "VALIDATE_INTERNALLY", 2).status_code == 200
    assert (
        client.get(url + "/export.json").json()["validation_applicability"]
        == "CURRENT_INTERNAL_VALIDATION"
    )
    path = workspace[2]
    create(
        client,
        path,
        {
            "request_id": str(uuid4()),
            "dossier_id": old["dossier_id"],
            "expected_revision": 1,
            "title": "Nouvelle révision fictive",
            "declaration": old["declaration"],
        },
    )
    assert client.get(url).json()["is_current_revision"] is False
    e = client.get(url + "/export.json").json()
    assert e["internal_state"] == "INTERNALLY_VALIDATED"
    assert not e["is_current_revision"]
    assert e["validation_applicability"] == "NOT_A_CURRENT_VALIDATION"


def test_session_deadline_rechecked_before_commit(client, workspace, monkeypatch):
    from app.diligence import routes

    path, _, lot_data = fixture(client, workspace)
    original = routes.resolve

    def expire(conn, access, declaration):
        resolved = original(conn, access, declaration)
        conn.execute(
            text(
                "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=:h"
            ),
            {"h": access.actor.token_hash},
        )
        return resolved

    monkeypatch.setattr(routes, "resolve", expire)
    r = client.post(path + "/diligence/revisions", json=prepare_body(lot_data["id"]))
    assert r.status_code == 401, r.text
    with owner.connect() as c:
        assert (
            c.execute(text("SELECT count(*) FROM diligence_revisions")).scalar_one()
            == 0
        )
        assert (
            c.execute(
                text(
                    "SELECT count(*) FROM audit_events WHERE action='diligence.prepared'"
                )
            ).scalar_one()
            == 0
        )
