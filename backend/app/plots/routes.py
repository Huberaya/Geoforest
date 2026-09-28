import json
import math
from uuid import UUID, uuid4

from app.database import transaction
from app.events import event
from app.plots.schemas import (
    CheckInput,
    ImportApply,
    ImportInput,
    LotLinks,
    PlotCreate,
    PlotData,
    PlotUpdate,
    ProposalReview,
)
from app.plots.services import (
    SELECT_PLOT,
    acknowledge,
    analyze,
    bounded,
    create_plot,
    get_plot,
    import_checksum,
    prepare_import,
    write_revision,
)
from app.security import authorize, require_identity
from app.supply.schemas import READERS, WRITERS, VersionInput
from app.supply.services import ensure_active, expect_version, row
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import text

router = APIRouter(prefix="/api/v1/organizations/{org}")


@router.post("/plots/check")
def check(org: UUID, body: CheckInput, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        return analyze(
            conn,
            org,
            body.geometry,
            body.declared_area_ha,
            body.commodity,
            body.exclude_plot_id,
        )


@router.get("/plots")
def plots(
    org: UUID,
    q: str = Query("", max_length=200),
    supplier_id: UUID | None = None,
    bbox: str | None = Query(None, max_length=160),
    include_archived: bool = False,
    page: int = Query(1, ge=1, le=1000),
    limit: int = Query(20, ge=1, le=50),
    identity=Depends(require_identity),
):
    bounds = None
    if bbox:
        try:
            bounds = [float(v) for v in bbox.split(",")]
            if len(bounds) != 4 or not all(math.isfinite(v) for v in bounds):
                raise ValueError
            w, s, e, n = bounds
            if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
                raise ValueError
        except ValueError:
            raise HTTPException(
                422,
                "Emprise attendue : ouest,sud,est,nord, sans traversée de l’antiméridien",
            ) from None
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        bounded(conn)
        params = {
            "o": org,
            "s": supplier_id,
            "archive": include_archived,
            "q": "%"
            + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            + "%",
            "limit": limit,
            "offset": (page - 1) * limit,
        }
        where = " WHERE p.organization_id=:o AND (:archive OR p.archived_at IS NULL) AND (CAST(:s AS uuid) IS NULL OR p.supplier_id=:s) AND (p.reference ILIKE :q OR g.payload->>'name' ILIKE :q)"
        if bounds:
            params.update(zip(["west", "south", "east", "north"], bounds))
            where += " AND g.geom && ST_MakeEnvelope(:west,:south,:east,:north,4326) AND ST_Intersects(g.geom,ST_MakeEnvelope(:west,:south,:east,:north,4326))"
        total = conn.execute(
            text("SELECT count(*) FROM (" + SELECT_PLOT + where + ") rows"), params
        ).scalar_one()
        items = [
            dict(r)
            for r in conn.execute(
                text(
                    SELECT_PLOT
                    + where
                    + " ORDER BY p.updated_at DESC,p.id LIMIT :limit OFFSET :offset"
                ),
                params,
            ).mappings()
        ]
    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit,
        "map_scope": "CURRENT_PAGE_ONLY",
    }


@router.post("/plots", status_code=201)
def create(org: UUID, body: PlotCreate, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        ensure_active(row(conn, "suppliers", org, body.supplier_id, True))
        data = PlotData.model_validate(
            body.model_dump(exclude={"supplier_id", "acknowledge_warnings"})
        )
        analysis = analyze(
            conn, org, data.geometry, data.declared_area_ha, data.commodity
        )
        acknowledge(analysis, body.acknowledge_warnings)
        return create_plot(
            conn, org, body.supplier_id, data, identity, analysis=analysis
        )


@router.post("/plots/import-preview")
def preview(org: UUID, body: ImportInput, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        bounded(conn)
        result = prepare_import(conn, org, body)
        result["already_imported"] = (
            conn.execute(
                text(
                    "SELECT 1 FROM plot_imports WHERE organization_id=:o AND supplier_id=:s AND checksum=:h"
                ),
                {"o": org, "s": body.supplier_id, "h": result["checksum"]},
            ).first()
            is not None
        )
        return result


@router.post("/plots/import")
def apply_import(org: UUID, body: ImportApply, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        bounded(conn)
        checksum = import_checksum(body)
        if body.preview_checksum != checksum:
            raise HTTPException(
                409, "Le fichier ou les paramètres ont changé. Refaites l’aperçu."
            )
        ensure_active(row(conn, "suppliers", org, body.supplier_id, True))
        existing = (
            conn.execute(
                text(
                    "SELECT id,created_ids FROM plot_imports WHERE organization_id=:o AND supplier_id=:s AND checksum=:h"
                ),
                {"o": org, "s": body.supplier_id, "h": checksum},
            )
            .mappings()
            .first()
        )
        if existing:
            return {**dict(existing), "replayed": True, "created_count": 0}
        prepared = prepare_import(conn, org, body)
        if prepared["conflicting_references"]:
            raise HTTPException(
                409, "Références déjà utilisées. Aucun élément importé."
            )
        batch_id = uuid4()
        ids = []
        for item in prepared["items"]:
            data = PlotData.model_validate(item["payload"])
            # Recheck against earlier inserted features too; snapshots record contemporaneous findings.
            result = create_plot(
                conn, org, body.supplier_id, data, identity, "IMPORT", batch_id
            )
            ids.append(str(result["id"]))
        conn.execute(
            text("""INSERT INTO plot_imports(organization_id,supplier_id,id,checksum,source_sha256,file_format,source_text,created_ids,actor_id)
          VALUES(:o,:s,:id,:checksum,:sha,:format,:source,CAST(:ids AS jsonb),:u)"""),
            {
                "o": org,
                "s": body.supplier_id,
                "id": batch_id,
                "checksum": checksum,
                "sha": prepared["source_sha256"],
                "format": body.file_format,
                "source": body.source_text,
                "ids": json.dumps(ids),
                "u": identity.id,
            },
        )
        event(
            conn,
            org,
            identity,
            "plot.imported",
            "plot_import",
            batch_id,
            None,
            {
                "source_sha256": prepared["source_sha256"],
                "created_ids": ids,
                "count": len(ids),
            },
        )
        return {
            "id": batch_id,
            "created_ids": ids,
            "created_count": len(ids),
            "replayed": False,
        }


@router.get("/plot-imports/{batch}/source")
def import_source(org: UUID, batch: UUID, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        result = (
            conn.execute(
                text(
                    "SELECT source_text,file_format FROM plot_imports WHERE organization_id=:o AND id=:id"
                ),
                {"o": org, "id": batch},
            )
            .mappings()
            .first()
        )
        if not result:
            raise HTTPException(404, "Source introuvable")
        return Response(
            result["source_text"],
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="source-{batch}.{result["file_format"]}"'
            },
        )


@router.get("/plots/{pid}")
def detail(org: UUID, pid: UUID, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        result = get_plot(conn, org, pid)
        result["revisions"] = [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT revision,source_kind,created_at,actor_id FROM plot_geolocations WHERE organization_id=:o AND plot_id=:id ORDER BY revision DESC LIMIT 100"
                ),
                {"o": org, "id": pid},
            ).mappings()
        ]
        return result


@router.get("/plots/{pid}/revisions/{revision}")
def revision_detail(
    org: UUID, pid: UUID, revision: int, identity=Depends(require_identity)
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        get_plot(conn, org, pid)
        r = (
            conn.execute(
                text(
                    "SELECT plot_id,revision,payload,analysis,source_kind,source_id,created_at FROM plot_geolocations WHERE organization_id=:o AND plot_id=:id AND revision=:v"
                ),
                {"o": org, "id": pid, "v": revision},
            )
            .mappings()
            .first()
        )
        if not r:
            raise HTTPException(404, "Révision introuvable")
        return dict(r)


@router.put("/plots/{pid}")
def update(org: UUID, pid: UUID, body: PlotUpdate, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        before = get_plot(conn, org, pid, True)
        ensure_active(before)
        expect_version(before, body.version)
        ensure_active(row(conn, "suppliers", org, before["supplier_id"], True))
        data = PlotData.model_validate(
            body.model_dump(exclude={"version", "acknowledge_warnings"})
        )
        analysis = analyze(
            conn, org, data.geometry, data.declared_area_ha, data.commodity, pid
        )
        acknowledge(analysis, body.acknowledge_warnings)
        rev = before["current_revision"] + 1
        write_revision(
            conn,
            org,
            before["supplier_id"],
            pid,
            rev,
            data.model_dump(mode="json"),
            analysis,
            identity,
            "STAFF",
        )
        conn.execute(
            text(
                "UPDATE plots SET reference=:r,current_revision=:v,version=version+1,updated_at=now() WHERE organization_id=:o AND id=:id"
            ),
            {"o": org, "id": pid, "r": data.reference, "v": rev},
        )
        event(
            conn,
            org,
            identity,
            "plot.updated",
            "plot",
            pid,
            {"revision": before["current_revision"], "reference": before["reference"]},
            {"revision": rev, "reference": data.reference},
        )
        return get_plot(conn, org, pid)


@router.post("/plots/{pid}/archive")
def archive(
    org: UUID, pid: UUID, body: VersionInput, identity=Depends(require_identity)
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        before = get_plot(conn, org, pid, True)
        ensure_active(before)
        expect_version(before, body.version)
        conn.execute(
            text(
                "UPDATE plots SET archived_at=now(),updated_at=now(),version=version+1 WHERE organization_id=:o AND id=:id"
            ),
            {"o": org, "id": pid},
        )
        event(
            conn,
            org,
            identity,
            "plot.archived",
            "plot",
            pid,
            {"version": before["version"]},
            {"version": before["version"] + 1},
        )
        return get_plot(conn, org, pid)


@router.get("/lots/{lot}/plots")
def lot_plots(org: UUID, lot: UUID, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        record = row(conn, "lots", org, lot)
        items = [
            dict(r)
            for r in conn.execute(
                text("""SELECT lp.plot_id,lp.revision,g.payload,g.analysis,p.reference,p.current_revision,p.archived_at FROM lot_plots lp
          JOIN plot_geolocations g ON(g.organization_id,g.supplier_id,g.plot_id,g.revision)=(lp.organization_id,lp.supplier_id,lp.plot_id,lp.revision)
          JOIN plots p ON(p.organization_id,p.id)=(lp.organization_id,lp.plot_id)
          WHERE lp.organization_id=:o AND lp.lot_id=:id ORDER BY p.reference"""),
                {"o": org, "id": lot},
            ).mappings()
        ]
        return {
            "lot": {
                k: str(record[k]) if k == "quantity" else record[k]
                for k in [
                    "id",
                    "reference",
                    "supplier_id",
                    "version",
                    "archived_at",
                    "quantity",
                    "unit",
                ]
            },
            "items": items,
            "notice": "Les versions retenues ne changent pas lorsque la parcelle est modifiée.",
        }


@router.put("/lots/{lot}/plots")
def set_lot_plots(
    org: UUID, lot: UUID, body: LotLinks, identity=Depends(require_identity)
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        bounded(conn)
        record = row(conn, "lots", org, lot, True)
        ensure_active(record)
        expect_version(record, body.version)
        ensure_active(row(conn, "suppliers", org, record["supplier_id"], True))
        for link in sorted(body.plots, key=lambda x: str(x.plot_id)):
            plot = get_plot(conn, org, link.plot_id, True)
            ensure_active(plot)
            if plot["supplier_id"] != record["supplier_id"]:
                raise HTTPException(
                    422, "La parcelle doit appartenir au fournisseur du lot"
                )
            if not conn.execute(
                text(
                    "SELECT 1 FROM plot_geolocations WHERE organization_id=:o AND plot_id=:p AND revision=:r"
                ),
                {"o": org, "p": link.plot_id, "r": link.revision},
            ).first():
                raise HTTPException(422, "Révision de géométrie introuvable")
        old = [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT plot_id,revision FROM lot_plots WHERE organization_id=:o AND lot_id=:l"
                ),
                {"o": org, "l": lot},
            ).mappings()
        ]
        conn.execute(
            text("DELETE FROM lot_plots WHERE organization_id=:o AND lot_id=:l"),
            {"o": org, "l": lot},
        )
        for link in body.plots:
            conn.execute(
                text(
                    "INSERT INTO lot_plots(organization_id,supplier_id,lot_id,plot_id,revision,actor_id) VALUES(:o,:s,:l,:p,:r,:u)"
                ),
                {
                    "o": org,
                    "s": record["supplier_id"],
                    "l": lot,
                    "p": link.plot_id,
                    "r": link.revision,
                    "u": identity.id,
                },
            )
        conn.execute(
            text(
                "UPDATE lots SET version=version+1,updated_at=now() WHERE organization_id=:o AND id=:l"
            ),
            {"o": org, "l": lot},
        )
        event(
            conn,
            org,
            identity,
            "lot.plots_updated",
            "lot",
            lot,
            old,
            [p.model_dump(mode="json") for p in body.plots],
        )
        return {"version": record["version"] + 1, "count": len(body.plots)}


@router.get("/plot-proposals")
def proposals(
    org: UUID,
    supplier_id: UUID | None = None,
    page: int = Query(1, ge=1, le=1000),
    identity=Depends(require_identity),
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        params = {"o": org, "s": supplier_id, "offset": (page - 1) * 20}
        where = " WHERE p.organization_id=:o AND (CAST(:s AS uuid) IS NULL OR p.supplier_id=:s)"
        total = conn.execute(
            text("SELECT count(*) FROM plot_proposals p" + where), params
        ).scalar_one()
        items = [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT p.*,s.name AS supplier_name FROM plot_proposals p JOIN suppliers s ON(s.organization_id,s.id)=(p.organization_id,p.supplier_id)"
                    + where
                    + " ORDER BY p.updated_at DESC,p.id LIMIT 20 OFFSET :offset"
                ),
                params,
            ).mappings()
        ]
        return {"items": items, "total": total, "page": page}


@router.get("/plot-proposals/{proposal}/revisions")
def proposal_revisions(org: UUID, proposal: UUID, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        r = conn.execute(
            text("SELECT id FROM plot_proposals WHERE organization_id=:o AND id=:id"),
            {"o": org, "id": proposal},
        ).first()
        if not r:
            raise HTTPException(404, "Proposition introuvable")
        return [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT version,payload,analysis,submitted_at FROM plot_proposal_revisions WHERE organization_id=:o AND proposal_id=:id ORDER BY version DESC LIMIT 30"
                ),
                {"o": org, "id": proposal},
            ).mappings()
        ]


@router.post("/plot-proposals/{proposal}/review")
def review(
    org: UUID, proposal: UUID, body: ProposalReview, identity=Depends(require_identity)
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, {"Admin", "Compliance Manager"})
        bounded(conn)
        r = (
            conn.execute(
                text(
                    "SELECT * FROM plot_proposals WHERE organization_id=:o AND id=:id FOR UPDATE"
                ),
                {"o": org, "id": proposal},
            )
            .mappings()
            .first()
        )
        if not r:
            raise HTTPException(404, "Proposition introuvable")
        expect_version(r, body.version)
        if r["status"] != "SUBMITTED":
            raise HTTPException(409, "Seule une proposition soumise peut être revue")
        ensure_active(row(conn, "suppliers", org, r["supplier_id"], True))
        adopted = None
        if body.decision == "ACCEPTED":
            data = PlotData.model_validate(
                {
                    **r["payload"],
                    "reference": body.adopted_reference or r["payload"]["reference"],
                }
            )
            adopted = create_plot(
                conn, org, r["supplier_id"], data, identity, "SUPPLIER_PORTAL", proposal
            )["id"]
        result = dict(
            conn.execute(
                text(
                    "UPDATE plot_proposals SET status=:status,review_note=:note,reviewed_by=:u,adopted_plot_id=:p,version=version+1,updated_at=now() WHERE organization_id=:o AND id=:id RETURNING id,status,version,adopted_plot_id"
                ),
                {
                    "o": org,
                    "id": proposal,
                    "status": body.decision,
                    "note": body.note,
                    "u": identity.id,
                    "p": adopted,
                },
            )
            .mappings()
            .one()
        )
        event(
            conn,
            org,
            identity,
            "plot.proposal_reviewed",
            "plot_proposal",
            proposal,
            {"status": r["status"], "version": r["version"]},
            {**result, "note": body.note},
        )
        return result
