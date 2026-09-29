import hashlib
import io
from uuid import uuid4

import pytest
from app.config import settings
from app.database import transaction
from app.documents import processing
from app.documents.compliance import LEGAL, RISK
from conftest import owner
from PIL import Image
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_supply import invitation, portal, product, supplier, workspace

assert workspace


@pytest.fixture(autouse=True)
def documentary_storage(tmp_path, monkeypatch):
    tmp_path.chmod(0o700)
    monkeypatch.setattr(settings(), "documents_enabled", True)
    monkeypatch.setattr(settings(), "document_storage_root", str(tmp_path))
    monkeypatch.setattr(
        processing,
        "scan",
        lambda blob: {
            "status": "SCAN_PASSED",
            "reason": "SYNTHETIC_TEST_ONLY",
            "input_sha256": blob.sha256,
        },
    )


def png():
    f = io.BytesIO()
    Image.new("RGB", (5, 5), "white").save(f, format="PNG")
    return f.getvalue()


def reserve(client, path, sid, data=None, **extra):
    data = png() if data is None else data
    body = {
        "request_id": str(uuid4()),
        "supplier_id": sid,
        "title": "Justificatif entièrement fictif",
        "original_name": "preuve.png",
        "claimed_mime": "image/png",
        "size": len(data),
        "expected_sha256": hashlib.sha256(data).hexdigest(),
    } | extra
    r = client.post(path + "/documents/uploads", json=body)
    assert r.status_code == 200, r.text
    return r.json(), body, data


def upload(client, path, sid, **extra):
    v, b, data = reserve(client, path, sid, **extra)
    endpoint = path + "/documents/uploads/" + v["id"]
    assert (
        client.put(
            endpoint + "/chunks?offset=0",
            content=data,
            headers={"Content-Type": "application/octet-stream"},
        ).status_code
        == 200
    )
    r = client.post(endpoint + "/finish")
    assert r.status_code == 200, r.text
    return r.json(), b, data


def lot(client, path, sid):
    p = product(client, path, sid)
    r = client.post(
        path + "/lots",
        json={
            "reference": "LOT-DOC",
            "supplier_id": sid,
            "product_id": p["id"],
            "quantity": "10",
            "unit": "KG",
            "origin_country": "CI",
            "production_start": "2025-01-01",
            "production_end": "2025-12-31",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def accept(client, path, v):
    r = client.post(
        path + "/documents/versions/" + v["id"] + "/reviews",
        json={
            "decision": "ACCEPTED",
            "note": "Preuve fictive acceptée pour la recette uniquement.",
        },
    )
    assert r.status_code == 200, r.text


def criteria(codes, state="UNKNOWN"):
    return [
        {
            "code": k,
            "state": state,
            "explanation": "Justification synthétique sans valeur juridique.",
            "source_reference": "Référence fictive réservée aux tests.",
        }
        for k in codes
    ]


def test_upload_download_version_replay_and_immutable(client, workspace):
    user, org, path = workspace
    s = supplier(client, path)
    v, b, data = upload(client, path, s["id"])
    assert v["state"] == "SCAN_PASSED"
    assert client.post(path + "/documents/uploads", json=b).json()["id"] == v["id"]
    assert (
        client.post(
            path + "/documents/uploads", json=b | {"title": "Autre titre"}
        ).status_code
        == 409
    )
    r = client.get(path + "/documents/versions/" + v["id"] + "/download")
    assert r.content == data
    assert (
        r.headers["content-disposition"].startswith("attachment;")
        and r.headers["cache-control"] == "no-store"
    )
    v2, _, _ = upload(client, path, s["id"], document_id=v["document_id"])
    assert v2["version"] == 2
    assert client.get(path + "/documents").json()["total"] == 2
    with pytest.raises(DBAPIError), transaction(user["id"], org) as c:
        c.execute(
            text("UPDATE document_versions SET metadata='{}' WHERE organization_id=:o"),
            {"o": org},
        )
    with pytest.raises(DBAPIError), transaction(user["id"], org) as c:
        c.execute(text("DELETE FROM document_versions"))


def test_quarantine_incomplete_chunks_and_resume(client, workspace):
    _, _, path = workspace
    s = supplier(client, path)
    v, b, data = reserve(client, path, s["id"])
    url = path + "/documents/uploads/" + v["id"]
    assert (
        client.get(path + "/documents/versions/" + v["id"] + "/download").status_code
        == 409
    )
    assert client.post(url + "/finish").status_code == 409
    assert client.put(url + "/chunks?offset=1", content=data).status_code == 409
    assert client.put(url + "/chunks?offset=0", content=data[:10]).status_code == 200
    assert client.put(url + "/chunks?offset=0", content=data[:10]).status_code == 200
    assert (
        client.put(url + "/chunks?offset=0", content=b"wrong data").status_code == 409
    )
    assert client.put(url + "/chunks?offset=10", content=data[10:]).status_code == 200
    assert client.post(url + "/finish").json()["state"] == "SCAN_PASSED"
    assert client.put(url + "/chunks?offset=0", content=data).status_code == 409


@pytest.mark.parametrize("state", ["SCAN_REJECTED", "SCAN_UNAVAILABLE"])
def test_scanner_failure_not_downloadable(client, workspace, monkeypatch, state):
    monkeypatch.setattr(
        processing, "scan", lambda b: {"status": state, "reason": "TEST_ONLY"}
    )
    _, _, path = workspace
    s = supplier(client, path)
    v, _, _ = upload(client, path, s["id"])
    assert v["state"] == state
    assert (
        client.get(path + "/documents/versions/" + v["id"] + "/download").status_code
        == 409
    )
    assert (
        client.post(
            path + "/documents/versions/" + v["id"] + "/reviews",
            json={"decision": "ACCEPTED", "note": "Ne doit jamais fonctionner."},
        ).status_code
        == 409
    )


@pytest.mark.parametrize(
    "extra", [{"claimed_mime": "application/pdf"}, {"expected_sha256": "0" * 64}]
)
def test_forgery_or_integrity_refused(client, workspace, extra):
    _, _, path = workspace
    s = supplier(client, path)
    v, _, _ = upload(client, path, s["id"], **extra)
    assert v["state"] == "FORMAT_REJECTED"


def test_portal_scope_and_reviews_no_internal_risk(client, workspace):
    _, _, path = workspace
    s = supplier(client, path)
    other = supplier(client, path, "OTHER")
    v, _, _ = upload(client, path, s["id"])
    foreign, _, _ = upload(client, path, other["id"])
    c, _ = portal(invitation(client, path, s["id"]))
    a, _, _ = upload(c, "/api/portal", None)
    assert a["supplier_id"] == s["id"]
    assert (
        c.get(
            "/api/portal/documents/versions/" + foreign["id"] + "/download"
        ).status_code
        == 404
    )
    assert c.get("/api/portal/documents").json()["total"] == 2
    accept(client, path, v)
    assert (
        c.get("/api/portal/documents").json()["items"][1]["review"]["decision"]
        == "ACCEPTED"
    )
    assert (
        c.post(
            "/api/portal/documents/versions/" + v["id"] + "/reviews", json={}
        ).status_code
        == 404
    )
    assert c.get(path + "/compliance/catalogue").status_code == 401


def test_tenant_isolation_and_runtime_without_context(
    client, workspace, identity, org, signin
):
    user, oid, path = workspace
    s = supplier(client, path)
    v, _, _ = upload(client, path, s["id"])
    other = identity()
    otherorg = org(other["id"])
    signin(client, other)
    assert client.get(path + "/documents").status_code == 404
    assert (
        client.get(
            f"/api/v1/organizations/{otherorg}/documents/versions/{v['id']}/download"
        ).status_code
        == 404
    )
    with transaction() as c:
        assert (
            c.execute(text("SELECT count(*) FROM document_versions")).scalar_one() == 0
        )


@pytest.mark.parametrize("role", ["Viewer", "Analyst", "Supplier"])
def test_read_only_roles_cannot_deposit(
    client, workspace, identity, membership, signin, role
):
    _, oid, path = workspace
    s = supplier(client, path)
    v, b, _ = reserve(client, path, s["id"])
    user = identity()
    membership(oid, user["id"], role, s["id"] if role == "Supplier" else None)
    signin(client, user)
    assert (
        client.post(
            path + "/documents/uploads", json=b | {"request_id": str(uuid4())}
        ).status_code
        == 403
    )
    assert (
        client.post(
            path + "/documents/versions/" + v["id"] + "/reviews",
            json={"decision": "ACCEPTED", "note": "Test de permissions refusées."},
        ).status_code
        == 403
    )


def test_quota_counts_other_suppliers_for_portal(client, workspace, monkeypatch):
    _, _, path = workspace
    s = supplier(client, path)
    other = supplier(client, path, "OTHER")
    reserve(client, path, other["id"])
    monkeypatch.setattr(settings(), "document_quota_bytes", len(png()))
    c, _ = portal(invitation(client, path, s["id"]))
    body = {
        "request_id": str(uuid4()),
        "title": "Test quota partagé",
        "original_name": "x.png",
        "claimed_mime": "image/png",
        "size": len(png()),
        "expected_sha256": hashlib.sha256(png()).hexdigest(),
    }
    assert c.post("/api/portal/documents/uploads", json=body).status_code == 409


def test_revoked_session_during_scan_cannot_publish(client, workspace, monkeypatch):
    user, _, path = workspace
    s = supplier(client, path)

    def scan(blob):
        with owner.begin() as c:
            c.execute(
                text("UPDATE sessions SET revoked_at=now() WHERE user_id=:u"),
                {"u": user["id"]},
            )
        return {"status": "SCAN_PASSED"}

    monkeypatch.setattr(processing, "scan", scan)
    v, _, data = reserve(client, path, s["id"])
    u = path + "/documents/uploads/" + v["id"]
    assert client.put(u + "/chunks?offset=0", content=data).status_code == 200
    assert client.post(u + "/finish").status_code == 401
    with owner.begin() as c:
        assert (
            c.execute(
                text("SELECT state FROM document_versions WHERE id=:v"), {"v": v["id"]}
            ).scalar_one()
            == "SCANNING"
        )


def test_legality_risk_tasks_staleness_and_proofs(client, workspace):
    user, _, path = workspace
    s = supplier(client, path)
    lot_data = lot(client, path, s["id"])
    url = path + "/compliance/lots/" + lot_data["id"]
    v, _, _ = upload(client, path, s["id"], lot_id=lot_data["id"])
    accept(client, path, v)
    ctx = client.get(url).json()
    assert ctx["context"]["legality"] is None
    legal = {
        "input_sha256": ctx["legality_input_sha256"],
        "country": "CI",
        "production_period": "2025-01-01/2025-12-31",
        "framework_qualified": True,
        "criteria": criteria(LEGAL, "CLEAR"),
        "evidence_version_ids": [v["id"]],
        "note": "Hypothèse de revue fictive pour tests, aucune qualification réelle.",
    }
    r = client.post(url + "/legality", json=legal)
    assert r.status_code == 200, r.text
    ctx = client.get(url).json()
    assert not ctx["context"]["legality_stale"]
    body = {
        "input_sha256": ctx["input_sha256"],
        "criteria": criteria(RISK),
        "evidence_version_ids": [v["id"]],
        "note": "Évaluation fictive à poursuivre, pièces encore incomplètes.",
    }
    r = client.post(url + "/risk", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["result"]["status"] == "ACTION_REQUIRED"
    assert (
        client.post(
            url + "/risk", json=body | {"proposed_residual": "NEGLIGIBLE"}
        ).status_code
        == 409
    )
    assert not client.get(url).json()["risk_history"][0]["stale"]
    t = client.post(
        url + "/tasks",
        json={
            "title": "Compléter les parcelles",
            "description": "Action fictive",
            "assigned_to": str(user["id"]),
            "due_date": "2026-09-28",
        },
    )
    assert t.status_code == 200, t.text
    t = t.json()
    assert client.get(url).json()["risk_history"][0]["stale"]
    bodyTask = {
        k: t[k] for k in ("title", "description", "assigned_to", "due_date", "version")
    }
    assert (
        client.put(
            path + "/compliance/tasks/" + t["id"], json=bodyTask | {"state": "RESOLVED"}
        ).status_code
        == 422
    )
    update = bodyTask | {
        "state": "RESOLVED",
        "resolution_note": "Pièce fictive justifiant la résolution de test.",
        "proof_version_id": v["id"],
    }
    assert (
        client.put(path + "/compliance/tasks/" + t["id"], json=update).status_code
        == 200
    )
    assert (
        client.put(path + "/compliance/tasks/" + t["id"], json=update).status_code
        == 409
    )
    with owner.begin() as c:
        assert (
            c.execute(
                text(
                    "SELECT count(*) FROM notification_outbox WHERE state='NOT_CONFIGURED'"
                )
            ).scalar_one()
            == 2
        )
    upload(client, path, s["id"], document_id=v["document_id"], lot_id=lot_data["id"])
    assert client.get(url).json()["context"]["legality_stale"]
    assert client.post(url + "/legality", json=legal).status_code == 409


def test_expired_document_is_preserved_not_auto_legal(client, workspace):
    _, _, path = workspace
    s = supplier(client, path)
    lot_data = lot(client, path, s["id"])
    v, _, _ = upload(client, path, s["id"], valid_until="2020-01-01")
    accept(client, path, v)
    ctx = client.get(path + "/compliance/lots/" + lot_data["id"]).json()
    assert ctx["context"]["documents"][0]["expired_now"] is True
    assert (
        client.get(path + "/documents/versions/" + v["id"] + "/download").status_code
        == 200
    )


def test_cross_supplier_evidence_and_foreign_assignee_rejected(
    client, workspace, identity
):
    _, _, path = workspace
    s = supplier(client, path)
    other = supplier(client, path, "OTHER")
    lot_data = lot(client, path, s["id"])
    v, _, _ = upload(client, path, other["id"])
    accept(client, path, v)
    url = path + "/compliance/lots/" + lot_data["id"]
    ctx = client.get(url).json()
    body = {
        "input_sha256": ctx["input_sha256"],
        "criteria": criteria(RISK),
        "evidence_version_ids": [v["id"]],
        "note": "Preuve hors périmètre à refuser.",
    }
    assert client.post(url + "/risk", json=body).status_code == 404
    stranger = identity()
    assert (
        client.post(
            url + "/tasks",
            json={
                "title": "Action fictive",
                "assigned_to": str(stranger["id"]),
                "due_date": "2026-10-01",
            },
        ).status_code
        == 422
    )


def test_portal_versions_preserve_client_lot_link(client, workspace):
    _, _, path = workspace
    s = supplier(client, path)
    lot_data = lot(client, path, s["id"])
    v, _, _ = upload(client, path, s["id"], lot_id=lot_data["id"])
    p, _ = portal(invitation(client, path, s["id"]))
    newer, _, _ = upload(
        p, "/api/portal", None, document_id=v["document_id"], lot_id=lot_data["id"]
    )
    assert newer["version"] == 2
    assert p.get("/api/portal/documents").json()["items"][0]["lot_id"] == lot_data["id"]
    assert p.get(path + "/compliance/lots/" + lot_data["id"]).status_code == 401


def test_concurrent_reservations_cannot_exceed_quota(client, workspace, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    _, _, path = workspace
    s = supplier(client, path)
    _, body, _ = reserve(client, path, s["id"])
    monkeypatch.setattr(settings(), "document_quota_bytes", len(png()) * 3 - 1)
    barrier = Barrier(2)

    def request(_):
        barrier.wait(timeout=5)
        return client.post(
            path + "/documents/uploads", json=body | {"request_id": str(uuid4())}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(request, range(2))) == [200, 409]


def test_low_disk_capacity_blocks_reservation(client, workspace, monkeypatch):
    from types import SimpleNamespace

    _, _, path = workspace
    s = supplier(client, path)
    _, body, _ = reserve(client, path, s["id"])
    monkeypatch.setattr(
        processing.os, "fstatvfs", lambda _: SimpleNamespace(f_bavail=0, f_frsize=4096)
    )
    assert (
        client.post(
            path + "/documents/uploads", json=body | {"request_id": str(uuid4())}
        ).status_code
        == 507
    )


@pytest.mark.parametrize("context", ["empty", "org_without_user", "wrong_org"])
def test_quota_function_fails_closed_on_missing_or_foreign_context(
    client, workspace, context
):
    user, oid, path = workspace
    s = supplier(client, path)
    uid = user["id"] if context == "wrong_org" else None
    orgid = (
        uuid4()
        if context == "wrong_org"
        else oid
        if context == "org_without_user"
        else None
    )
    with pytest.raises(DBAPIError), transaction(uid, orgid) as c:
        c.execute(
            text("SELECT * FROM authz.document_quota(:o,:s)"), {"o": oid, "s": s["id"]}
        ).all()


def test_document_dto_hides_storage_locators():
    from app.documents.routes import dto

    assert dto(
        {
            "id": "synthetic",
            "storage_backend": "s3",
            "storage_version": "private-version",
            "object_id": "private-object",
            "input_sha256": "private-input",
            "actor_id": "private-actor",
        }
    ) == {"id": "synthetic", "processing_mode": "background"}


def test_s3_requires_candidate_schema_before_any_object_io(
    client, workspace, monkeypatch
):
    with owner.begin() as conn:
        if conn.execute(
            text(
                "SELECT to_regprocedure('authz.document_enqueue(uuid,uuid)') IS NOT NULL"
            )
        ).scalar_one():
            pytest.skip("This test checks the unchanged 0007 database")
    _, _, path = workspace
    s = supplier(client, path)
    monkeypatch.setattr(settings(), "document_storage_backend", "s3")
    monkeypatch.setattr(settings(), "document_s3_api_test", True)

    def forbidden():
        raise AssertionError("S3 accessed before schema qualification")

    monkeypatch.setattr(processing, "s3_store", forbidden)
    data = png()
    response = client.post(
        path + "/documents/uploads",
        json={
            "request_id": str(uuid4()),
            "supplier_id": s["id"],
            "title": "Preuve fictive",
            "original_name": "fiction.png",
            "claimed_mime": "image/png",
            "size": len(data),
            "expected_sha256": hashlib.sha256(data).hexdigest(),
        },
    )
    assert response.status_code == 503
    with owner.begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM documents")).scalar_one() == 0
