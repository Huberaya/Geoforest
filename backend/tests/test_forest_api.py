from uuid import uuid4

import numpy as np
import pytest
from app.config import settings
from app.database import transaction
from app.forest import routes
from app.forest.engine import analyze_geometry
from conftest import owner
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_country_checks_api import setup
from test_supply import supplier, workspace

assert workspace


@pytest.fixture(autouse=True)
def fake_source(monkeypatch):
    monkeypatch.setattr(settings(), "forest_analysis_enabled", True)

    def analyze(g):
        def fetch(tile, row, col, h, w, *, budget):
            return np.full(
                (h, w), 25 if tile.layer == "lossyear" else 1, dtype=np.uint8
            ), {"source_reads": [{"generation": "synthetic", "etag": "synthetic"}]}

        return analyze_geometry(g, fetch=fetch)

    monkeypatch.setattr(routes, "isolated_analysis", analyze)


def prepare(client, path):
    s, p, url = setup(client, path)
    return s, p, url.replace("country-checks", "forest-analyses")


def args(revision=1):
    return {
        "revision": revision,
        "request_id": str(uuid4()),
        "allow_public_tile_requests": True,
    }


def test_immutable_evidence_replay_audit(client, workspace):
    user, oid, path = workspace
    _, _, url = prepare(client, path)
    body = args()
    r = client.post(url, json=body)
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["result"]["signal_status"] == "SIGNAL_OBSERVED"
    assert "windows" not in a["result"]
    evidence = client.get(url + "/" + a["id"]).json()
    assert evidence["result"]["windows"][0]["evidence"]
    assert client.post(url, json=body).json()["replayed"] is True
    assert client.post(url, json=body | {"revision": 2}).status_code == 409
    assert client.get(url + "?revision=1").json()["total"] == 1
    assert client.get(url + "?revision=42").status_code == 404
    with transaction(user["id"], oid) as conn:
        assert (
            conn.execute(
                text(
                    "SELECT count(*) FROM audit_events WHERE action='plot.forest_analyzed'"
                )
            ).scalar_one()
            == 1
        )
    for sql in [
        "UPDATE forest_analyses SET result=result",
        "DELETE FROM forest_analyses",
    ]:
        with pytest.raises(DBAPIError), transaction(user["id"], oid) as conn:
            conn.execute(text(sql))
    with transaction() as conn:
        assert (
            conn.execute(text("SELECT count(*) FROM forest_analyses")).scalar_one() == 0
        )


@pytest.mark.parametrize("role", ["Analyst", "Viewer", "Supplier"])
def test_reader_and_supplier_isolation(
    client, workspace, identity, signin, membership, role
):
    _, oid, path = workspace
    s, _, url = prepare(client, path)
    a = client.post(url, json=args()).json()
    other = supplier(client, path, "FOREST-B")
    from test_plots_api import create

    p = create(client, path, other["id"], "FOREST-OTHER")
    otherurl = path + "/plots/" + p["id"] + "/forest-analyses"
    b = client.post(otherurl, json=args()).json()
    u = identity()
    membership(oid, u["id"], role, s["id"] if role == "Supplier" else None)
    signin(client, u)
    assert client.post(url, json=args()).status_code == 403
    assert client.get(url + "/" + a["id"]).status_code == 200
    assert client.get(url + "?revision=1").status_code == 200
    if role == "Supplier":
        assert client.get(otherurl + "?revision=1").status_code == 404
        assert client.get(otherurl + "/" + b["id"]).status_code == 404
        with transaction(u["id"], oid) as conn:
            assert (
                conn.execute(text("SELECT count(*) FROM forest_analyses")).scalar_one()
                == 1
            )


def test_cross_tenant_and_anonymous(
    client, workspace, identity, signin, org, membership
):
    _, _, path = workspace
    _, _, url = prepare(client, path)
    a = client.post(url, json=args()).json()
    u = identity()
    otherorg = org(u["id"])
    signin(client, u)
    assert client.get(url + "?revision=1").status_code == 404
    assert client.get(url + "/" + a["id"]).status_code == 404
    assert client.post(url, json=args()).status_code == 404
    assert otherorg
    client.cookies.clear()
    assert client.get(url + "?revision=1").status_code == 401


@pytest.mark.parametrize(
    "change",
    [
        {"allow_public_tile_requests": False},
        {"allow_public_tile_requests": 1},
        {"revision": 1.0},
        {"revision": 0},
        {"source_url": "https://evil.invalid"},
        {"result": {"status": "COMPLIANT"}},
    ],
)
def test_strict_inputs_no_network(client, workspace, monkeypatch, change):
    _, _, path = workspace
    _, _, url = prepare(client, path)

    def forbidden(g):
        raise AssertionError("network work must not run")

    monkeypatch.setattr(routes, "isolated_analysis", forbidden)
    assert client.post(url, json=args() | change).status_code == 422


def test_disabled_server_history_still_available(client, workspace, monkeypatch):
    _, _, path = workspace
    _, _, url = prepare(client, path)
    body = args()
    a = client.post(url, json=body).json()
    monkeypatch.setattr(settings(), "forest_analysis_enabled", False)
    assert client.post(url, json=args()).status_code == 503
    assert client.post(url, json=body).json()["id"] == a["id"]
    assert client.get(url + "?revision=1").json()["total"] == 1


def test_revoke_during_work_cannot_publish(client, workspace, monkeypatch):
    u, _, path = workspace
    _, _, url = prepare(client, path)
    original = routes.isolated_analysis

    def revoked(g):
        r = original(g)
        with owner.begin() as conn:
            conn.execute(
                text("UPDATE sessions SET revoked_at=now() WHERE user_id=:u"),
                {"u": u["id"]},
            )
        return r

    monkeypatch.setattr(routes, "isolated_analysis", revoked)
    assert client.post(url, json=args()).status_code == 401
    with owner.begin() as conn:
        assert (
            conn.execute(text("SELECT count(*) FROM forest_analyses")).scalar_one() == 0
        )


def test_role_removed_during_work_cannot_publish(client, workspace, monkeypatch):
    u, oid, path = workspace
    _, _, url = prepare(client, path)
    original = routes.isolated_analysis

    def revoked(g):
        r = original(g)
        with owner.begin() as conn:
            conn.execute(
                text("DELETE FROM memberships WHERE user_id=:u AND organization_id=:o"),
                {"u": u["id"], "o": oid},
            )
        return r

    monkeypatch.setattr(routes, "isolated_analysis", revoked)
    assert client.post(url, json=args()).status_code == 404
    with owner.begin() as conn:
        assert (
            conn.execute(text("SELECT count(*) FROM forest_analyses")).scalar_one() == 0
        )


def test_work_locks_and_release(client, workspace):
    _, oid, path = workspace
    _, _, url = prepare(client, path)
    body = args()
    with routes.work_slot(oid, body["request_id"]):
        assert client.post(url, json=body).status_code == 409
        assert client.post(url, json=args()).status_code == 429
    assert client.post(url, json=body).status_code == 200


def test_worker_failure_does_not_persist_favorable_result(
    client, workspace, monkeypatch
):
    from app.forest.download import SourceReadError

    _, _, path = workspace
    _, _, url = prepare(client, path)

    def fail(g):
        raise SourceReadError("WORKER_TIMEOUT")

    monkeypatch.setattr(routes, "isolated_analysis", fail)
    assert client.post(url, json=args()).status_code == 503
    assert client.get(url + "?revision=1").json()["total"] == 0
