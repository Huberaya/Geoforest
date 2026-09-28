import json
from uuid import UUID

from app.database import transaction
from app.plots.schemas import CheckInput, ProposalSave, ProposalSubmit, ProposalUpdate
from app.plots.services import analyze, bounded
from app.portal.security import require_supplier
from app.supply.services import expect_version
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

router = APIRouter(prefix="/api/portal")


def audit(conn, s, action, pid, before, after):
    conn.execute(
        text("""INSERT INTO audit_events(organization_id,actor_kind,supplier_actor_id,action,object_type,object_id,previous_value,new_value,source)
      VALUES(:o,'supplier',:s,:a,'plot_proposal',:p,CAST(:b AS jsonb),CAST(:n AS jsonb),'supplier_portal')"""),
        {
            "o": s.organization_id,
            "s": s.supplier_id,
            "a": action,
            "p": pid,
            "b": json.dumps(before, default=str) if before else None,
            "n": json.dumps(after, default=str),
        },
    )


def get(conn, s, pid, lock=False):
    r = (
        conn.execute(
            text(
                "SELECT * FROM plot_proposals WHERE organization_id=:o AND supplier_id=:s AND id=:id"
                + (" FOR UPDATE" if lock else "")
            ),
            {"o": s.organization_id, "s": s.supplier_id, "id": pid},
        )
        .mappings()
        .first()
    )
    if not r:
        raise HTTPException(404, "Proposition introuvable")
    return dict(r)


@router.post("/plots/check")
def check(body: CheckInput, s=Depends(require_supplier)):
    with transaction(
        organization_id=s.organization_id, portal_session=s.token_hash
    ) as conn:
        return analyze(
            conn,
            s.organization_id,
            body.geometry,
            body.declared_area_ha,
            body.commodity,
            relations=False,
        )


@router.get("/plot-proposals")
def list_proposals(page: int = Query(1, ge=1, le=1000), s=Depends(require_supplier)):
    with transaction(
        organization_id=s.organization_id, portal_session=s.token_hash
    ) as conn:
        params = {"o": s.organization_id, "s": s.supplier_id, "offset": (page - 1) * 20}
        total = conn.execute(
            text(
                "SELECT count(*) FROM plot_proposals WHERE organization_id=:o AND supplier_id=:s"
            ),
            params,
        ).scalar_one()
        items = [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT * FROM plot_proposals WHERE organization_id=:o AND supplier_id=:s ORDER BY updated_at DESC,id DESC LIMIT 20 OFFSET :offset"
                ),
                params,
            ).mappings()
        ]
        for item in items:
            item.pop("reviewed_by", None)
        return {
            "items": items,
            "total": total,
            "page": page,
            "scope": "PROPOSED_GEOLOCATION_ONLY",
        }


@router.post("/plot-proposals", status_code=201)
def create(body: ProposalSave, s=Depends(require_supplier)):
    with transaction(
        organization_id=s.organization_id, portal_session=s.token_hash
    ) as conn:
        payload = body.payload.model_dump(mode="json")
        analysis = analyze(
            conn,
            s.organization_id,
            body.payload.geometry,
            body.payload.declared_area_ha,
            body.payload.commodity,
            relations=False,
        )
        result = dict(
            conn.execute(
                text(
                    "INSERT INTO plot_proposals(organization_id,supplier_id,payload,analysis) VALUES(:o,:s,CAST(:p AS jsonb),CAST(:a AS jsonb)) RETURNING id,version,status"
                ),
                {
                    "o": s.organization_id,
                    "s": s.supplier_id,
                    "p": json.dumps(payload),
                    "a": json.dumps(analysis, default=str),
                },
            )
            .mappings()
            .one()
        )
        audit(
            conn,
            s,
            "plot.proposal_created",
            result["id"],
            None,
            {"version": 1, "payload": payload},
        )
        return result


@router.put("/plot-proposals/{pid}")
def update(pid: UUID, body: ProposalUpdate, s=Depends(require_supplier)):
    with transaction(
        organization_id=s.organization_id, portal_session=s.token_hash
    ) as conn:
        before = get(conn, s, pid, True)
        expect_version(before, body.version)
        if before["status"] not in {"DRAFT", "CHANGES_REQUESTED"}:
            raise HTTPException(
                409, "Version transmise ou adoptée : modification impossible"
            )
        payload = body.payload.model_dump(mode="json")
        analysis = analyze(
            conn,
            s.organization_id,
            body.payload.geometry,
            body.payload.declared_area_ha,
            body.payload.commodity,
            relations=False,
        )
        result = dict(
            conn.execute(
                text(
                    "UPDATE plot_proposals SET payload=CAST(:p AS jsonb),analysis=CAST(:a AS jsonb),version=version+1,updated_at=now() WHERE organization_id=:o AND id=:id RETURNING id,version,status"
                ),
                {
                    "o": s.organization_id,
                    "id": pid,
                    "p": json.dumps(payload),
                    "a": json.dumps(analysis, default=str),
                },
            )
            .mappings()
            .one()
        )
        audit(
            conn,
            s,
            "plot.proposal_updated",
            pid,
            {"version": before["version"], "payload": before["payload"]},
            {"version": result["version"], "payload": payload},
        )
        return result


@router.post("/plot-proposals/{pid}/submit")
def submit(pid: UUID, body: ProposalSubmit, s=Depends(require_supplier)):
    with transaction(
        organization_id=s.organization_id, portal_session=s.token_hash
    ) as conn:
        bounded(conn)
        before = get(conn, s, pid, True)
        expect_version(before, body.version)
        if before["status"] not in {"DRAFT", "CHANGES_REQUESTED"}:
            raise HTTPException(409, "Proposition déjà transmise")
        version = before["version"] + 1
        conn.execute(
            text(
                "UPDATE plot_proposals SET status='SUBMITTED',version=:v,submitted_at=now(),updated_at=now() WHERE organization_id=:o AND id=:id"
            ),
            {"o": s.organization_id, "id": pid, "v": version},
        )
        conn.execute(
            text(
                "INSERT INTO plot_proposal_revisions(organization_id,supplier_id,proposal_id,version,payload,analysis) VALUES(:o,:s,:id,:v,CAST(:p AS jsonb),CAST(:a AS jsonb))"
            ),
            {
                "o": s.organization_id,
                "s": s.supplier_id,
                "id": pid,
                "v": version,
                "p": json.dumps(before["payload"]),
                "a": json.dumps(before["analysis"]),
            },
        )
        audit(
            conn,
            s,
            "plot.proposal_submitted",
            pid,
            {"version": before["version"], "status": before["status"]},
            {
                "version": version,
                "status": "SUBMITTED",
                "confirmation": "Reviewed technical warnings; no regulatory declaration",
            },
        )
        return {"id": pid, "version": version, "status": "SUBMITTED"}
