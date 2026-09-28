from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from app.database import transaction
from app.geospatial import screening
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_plots_api import body, create
from test_supply import supplier, workspace

assert workspace


def setup(client, path, country="CI"):
    s = supplier(client, path)
    args = body(s["id"])
    args["country"] = country
    p = client.post(path + "/plots", json=args).json()
    return s, p, path + "/plots/" + p["id"] + "/country-checks"


def payload(revision=1):
    return {"revision": revision, "review_distance_m": 1000, "request_id": str(uuid4())}


def test_country_check_immutable_revision_audit_replay(client, workspace, monkeypatch):
    user, oid, path = workspace
    s, p, url = setup(client, path)
    args = payload()
    first = client.post(url, json=args)
    assert first.status_code == 200, first.text
    item = first.json()
    assert item["result"]["status"] == "OUTSIDE_REFERENCE_INDICATIVE"
    assert item["result"]["source"]["boundary_id"] == "NE-10M-MAPUNITS-CI"
    assert item["result"]["country_verified"] is False
    monkeypatch.setattr(screening, "CATALOGUE", {})
    replay = client.post(url, json=args).json()
    assert replay["id"] == item["id"] and replay["replayed"] is True
    assert replay["result"] == item["result"]
    assert client.post(url, json={**args, "review_distance_m": 0}).status_code == 409
    with transaction(user["id"], oid) as conn:
        assert (
            conn.execute(
                text(
                    "SELECT count(*) FROM audit_events WHERE action='plot.country_screened'"
                )
            ).scalar_one()
            == 1
        )
    for command in [
        "UPDATE country_checks SET result=result",
        "DELETE FROM country_checks",
    ]:
        with pytest.raises(DBAPIError), transaction(user["id"], oid) as conn:
            conn.execute(text(command))
    update = {k: v for k, v in body(s["id"]).items() if k != "supplier_id"}
    assert (
        client.put(
            path + "/plots/" + p["id"], json={**update, "version": 1, "country": "AQ"}
        ).status_code
        == 200
    )
    assert client.get(url + "?revision=2").json()["total"] == 0
    assert client.get(url + "?revision=1").json()["items"][0]["id"] == item["id"]
    r = client.post(url, json=payload(2)).json()
    assert r["result"]["status"] == "NOT_COVERED" and r["result"]["source"] is None
    assert client.post(url, json=payload(3)).status_code == 404
    assert client.get(url + "?revision=3").status_code == 404


@pytest.mark.parametrize("role", ["Analyst", "Viewer", "Supplier"])
def test_readonly_and_supplier_scope(
    client, workspace, identity, signin, membership, role
):
    _, oid, path = workspace
    sa, pa, url = setup(client, path)
    sb = supplier(client, path, "SUP-B")
    pb = create(client, path, sb["id"], "PARC-B")
    other = path + "/plots/" + pb["id"] + "/country-checks"
    assert client.post(url, json=payload()).status_code == 200
    assert client.post(other, json=payload()).status_code == 200
    user = identity()
    membership(oid, user["id"], role, sa["id"] if role == "Supplier" else None)
    signin(client, user)
    assert client.get(url + "?revision=1").json()["total"] == 1
    assert client.post(url, json=payload()).status_code == 403
    if role == "Supplier":
        assert client.get(other + "?revision=1").status_code == 404
        with transaction(user["id"], oid) as conn:
            assert (
                conn.execute(text("SELECT count(*) FROM country_checks")).scalar_one()
                == 1
            )


def test_cross_tenant_no_history_leak(client, workspace, identity, signin, org):
    _, _, path = workspace
    _, p, url = setup(client, path)
    assert client.post(url, json=payload()).status_code == 200
    user = identity()
    other = org(user["id"])
    signin(client, user)
    assert client.get(url + "?revision=1").status_code == 404
    otherurl = f"/api/v1/organizations/{other}/plots/{p['id']}/country-checks"
    assert client.get(otherurl + "?revision=1").status_code == 404
    assert client.post(otherurl, json=payload()).status_code == 404
    with transaction(user["id"], other) as conn:
        assert (
            conn.execute(text("SELECT count(*) FROM country_checks")).scalar_one() == 0
        )
    with transaction() as conn:
        assert (
            conn.execute(text("SELECT count(*) FROM country_checks")).scalar_one() == 0
        )


@pytest.mark.parametrize(
    "change",
    [
        {"review_distance_m": -1},
        {"review_distance_m": 50001},
        {"review_distance_m": True},
        {"review_distance_m": "1000"},
        {"revision": True},
        {"revision": 0},
        {"revision": 999},
        {"extra": "x"},
    ],
)
def test_inputs(client, workspace, change):
    _, _, path = workspace
    _, _, url = setup(client, path)
    assert client.post(url, json=payload() | change).status_code == (
        404 if change.get("revision") == 999 else 422
    )
    assert client.get(url + "?revision=1").json()["total"] == 0


def test_source_unavailable_recorded_without_false_match(
    client, workspace, monkeypatch
):
    from app.geospatial import references

    _, _, path = workspace
    _, _, url = setup(client, path)
    monkeypatch.setattr(references, "MAX_SOURCE_BYTES", 1)
    r = client.post(url, json=payload()).json()
    assert r["result"]["status"] == "SOURCE_UNAVAILABLE"
    assert r["result"]["country_verified"] is False
    assert r["result"]["source"]["sha256"]
    assert client.get(url + "?revision=1").json()["total"] == 1


def test_duplicate_concurrent_requests(client, workspace):
    _, _, path = workspace
    _, _, url = setup(client, path)
    args = payload()
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: client.post(url, json=args), range(2)))
    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    assert len({r.json()["id"] for r in responses}) == 1
    assert sorted(r.json()["replayed"] for r in responses) == [False, True]
    assert client.get(url + "?revision=1").json()["total"] == 1


def test_catalogue_and_csrf(client, workspace):
    _, _, path = workspace
    _, _, url = setup(client, path)
    r = client.get(path + "/geospatial/sources").json()
    assert r["coverage"] == "GLOBAL_INDICATIVE_WITH_EXCEPTIONS"
    assert r["covered_count"] == 246
    assert {e["country"] for e in r["excluded"]} == {"AQ", "EG", "UM"}
    client.headers.pop("X-CSRF-Token", None)
    assert client.post(url, json=payload()).status_code == 403
