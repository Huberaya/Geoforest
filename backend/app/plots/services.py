import hashlib
import json
from uuid import uuid4

from app.events import event
from app.plots.geometry import validate_geometry
from app.plots.imports import parse_import
from app.plots.schemas import PlotData
from app.supply.services import ensure_active, row
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text

SELECT_PLOT = """SELECT p.*,g.payload,g.analysis,g.source_kind,g.source_id,g.created_at AS revision_created_at,
 s.name AS supplier_name FROM plots p JOIN plot_geolocations g ON
 (g.organization_id,g.supplier_id,g.plot_id,g.revision)=(p.organization_id,p.supplier_id,p.id,p.current_revision)
 JOIN suppliers s ON (s.organization_id,s.id)=(p.organization_id,p.supplier_id)"""


def bounded(conn):
    conn.execute(text("SET LOCAL statement_timeout='8s'"))


def get_plot(conn, org, pid, lock=False):
    if lock:
        locked = conn.execute(
            text("SELECT id FROM plots WHERE organization_id=:o AND id=:id FOR UPDATE"),
            {"o": org, "id": pid},
        ).first()
        if not locked:
            raise HTTPException(404, "Parcelle introuvable")
    result = (
        conn.execute(
            text(SELECT_PLOT + " WHERE p.organization_id=:o AND p.id=:id"),
            {"o": org, "id": pid},
        )
        .mappings()
        .first()
    )
    if not result:
        raise HTTPException(404, "Parcelle introuvable")
    return dict(result)


def analyze(
    conn, org, geometry, area=None, commodity=None, exclude=None, relations=True
):
    bounded(conn)
    result = validate_geometry(conn, geometry, area, commodity)
    hits = []
    if relations:
        hits = [
            dict(r)
            for r in conn.execute(
                text("""WITH candidate AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(:g),4326) geom)
          SELECT p.id,p.reference,p.supplier_id,CASE WHEN ST_Equals(g.geom,c.geom) THEN 'DUPLICATE'
            WHEN ST_Dimension(g.geom)=2 AND ST_Dimension(c.geom)=2 AND ST_Relate(g.geom,c.geom,'T********') THEN 'OVERLAP'
            ELSE 'INTERSECTION' END AS kind
          FROM plots p JOIN plot_geolocations g ON(g.organization_id,g.supplier_id,g.plot_id,g.revision)=(p.organization_id,p.supplier_id,p.id,p.current_revision)
          CROSS JOIN candidate c WHERE p.organization_id=:o AND p.archived_at IS NULL
          AND (CAST(:exclude AS uuid) IS NULL OR p.id<>:exclude) AND g.geom && c.geom AND ST_Intersects(g.geom,c.geom)
          ORDER BY p.id LIMIT 51"""),
                {
                    "o": org,
                    "g": json.dumps(geometry, allow_nan=False),
                    "exclude": exclude,
                },
            ).mappings()
        ]
    result["spatial_relations"] = [
        {**h, "id": str(h["id"]), "supplier_id": str(h["supplier_id"])}
        for h in hits[:50]
    ]
    result["relations_truncated"] = len(hits) > 50
    result["relation_scope"] = (
        "AUTHORIZED_ACTIVE_PLOTS_ONLY"
        if relations
        else "NOT_CHECKED_IN_SUPPLIER_PORTAL"
    )
    result["country_status"] = "DECLARED_NOT_SPATIALLY_VERIFIED"
    return result


def acknowledge(analysis, confirmed):
    if (analysis["warnings"] or analysis["spatial_relations"]) and not confirmed:
        raise HTTPException(
            409,
            {
                "code": "WARNINGS_REQUIRE_CONFIRMATION",
                "message": "Relisez et confirmez les avertissements techniques avant enregistrement",
                "analysis": analysis,
            },
        )


def write_revision(
    conn,
    org,
    sid,
    pid,
    revision,
    payload,
    analysis,
    identity,
    source_kind,
    source_id=None,
):
    conn.execute(
        text("""INSERT INTO plot_geolocations(organization_id,supplier_id,plot_id,revision,payload,geom,analysis,actor_id,source_kind,source_id)
      VALUES(:o,:s,:p,:v,CAST(:payload AS jsonb),ST_SetSRID(ST_GeomFromGeoJSON(:geom),4326),CAST(:a AS jsonb),:u,:kind,:source)"""),
        {
            "o": org,
            "s": sid,
            "p": pid,
            "v": revision,
            "payload": json.dumps(payload),
            "geom": json.dumps(payload["geometry"]),
            "a": json.dumps(analysis, default=str),
            "u": identity.id,
            "kind": source_kind,
            "source": source_id,
        },
    )


def create_plot(
    conn, org, sid, data, identity, source_kind="STAFF", source_id=None, analysis=None
):
    ensure_active(row(conn, "suppliers", org, sid, True))
    payload = data.model_dump(mode="json")
    analysis = analysis or analyze(
        conn, org, payload["geometry"], data.declared_area_ha, data.commodity
    )
    pid = uuid4()
    conn.execute(
        text(
            "INSERT INTO plots(organization_id,supplier_id,id,reference) VALUES(:o,:s,:p,:r)"
        ),
        {"o": org, "s": sid, "p": pid, "r": data.reference},
    )
    write_revision(
        conn, org, sid, pid, 1, payload, analysis, identity, source_kind, source_id
    )
    event(
        conn,
        org,
        identity,
        "plot.created",
        "plot",
        pid,
        None,
        {
            "reference": data.reference,
            "supplier_id": sid,
            "revision": 1,
            "source_kind": source_kind,
            "source_id": source_id,
        },
    )
    return get_plot(conn, org, pid)


def import_checksum(body):
    return hashlib.sha256(
        (
            "plots-import-v1\n"
            + json.dumps(
                body.model_dump(mode="json", exclude={"confirmed", "preview_checksum"}),
                sort_keys=True,
            )
        ).encode()
    ).hexdigest()


def prepare_import(conn, org, body):
    ensure_active(row(conn, "suppliers", org, body.supplier_id, True))
    parsed = parse_import(body.source_text, body.file_format)
    items = []
    errors = []
    for f in parsed["features"]:
        index = f["source_index"]
        props = f["source_properties"]
        try:
            data = PlotData.model_validate(
                {
                    "reference": f"{body.reference_prefix}-{index:03}",
                    "name": props.get("ProductionPlace")
                    or props.get("name")
                    or f"Parcelle {index}",
                    "country": props.get("ProducerCountry")
                    or props.get("country")
                    or body.country,
                    "commodity": body.commodity,
                    "geometry": f["geometry"],
                    "declared_area_ha": props.get("Area"),
                    "capture_method": body.file_format.upper(),
                    "source_note": f"Import {body.file_format}, élément {index}",
                }
            )
            analysis = analyze(
                conn, org, data.geometry, data.declared_area_ha, data.commodity
            )
            items.append(
                {
                    "source_index": index,
                    "payload": data.model_dump(mode="json"),
                    "analysis": analysis,
                    "source_properties": props,
                    "ignored_properties": f["ignored_properties"],
                    "parser_warnings": f["warnings"],
                }
            )
        except ValidationError as exc:
            errors.append(
                {
                    "index": index,
                    "message": "Métadonnées invalides",
                    "fields": [".".join(map(str, e["loc"])) for e in exc.errors()],
                }
            )
        except HTTPException as exc:
            errors.append({"index": index, "message": exc.detail})
    if errors:
        raise HTTPException(
            422,
            {
                "message": "Aucune parcelle importée. Corrigez les éléments indiqués.",
                "items": errors,
            },
        )
    # Analyze pairwise relationships of the batch without exposing data outside its tenant.
    if len(items) > 1:
        pairs = (
            conn.execute(
                text("""WITH geoms AS (SELECT ordinality AS idx,ST_SetSRID(ST_GeomFromGeoJSON(value->'geometry'),4326) geom
          FROM jsonb_array_elements(CAST(:items AS jsonb)) WITH ORDINALITY)
          SELECT a.idx AS first,b.idx AS second,CASE WHEN ST_Equals(a.geom,b.geom) THEN 'DUPLICATE' ELSE 'INTERSECTION' END kind
          FROM geoms a JOIN geoms b ON a.idx<b.idx AND a.geom && b.geom AND ST_Intersects(a.geom,b.geom) LIMIT 101"""),
                {"items": json.dumps([i["payload"] for i in items])},
            )
            .mappings()
            .all()
        )
    else:
        pairs = []
    refs = [i["payload"]["reference"] for i in items]
    conflicts = (
        conn.execute(
            text(
                "SELECT reference FROM plots WHERE organization_id=:o AND reference=ANY(:refs)"
            ),
            {"o": org, "refs": refs},
        )
        .scalars()
        .all()
    )
    return {
        "items": items,
        "checksum": import_checksum(body),
        "source_sha256": parsed["source_sha256"],
        "conflicting_references": conflicts,
        "batch_intersections": [dict(x) for x in pairs[:100]],
        "batch_intersections_truncated": len(pairs) > 100,
    }
