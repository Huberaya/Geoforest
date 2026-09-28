"""Authorized, immutable forest analyses; network outside business transactions."""

import hashlib
import json
from contextlib import contextmanager
from typing import Literal
from uuid import UUID

from app.config import settings
from app.database import engine, transaction
from app.events import event
from app.forest.download import SourceReadError
from app.forest.isolation import isolated_analysis
from app.plots.geometry import validate_geometry
from app.plots.services import bounded, get_plot
from app.schemas import StrictModel
from app.security import authorize, require_identity
from app.supply.schemas import READERS, WRITERS
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import Field
from sqlalchemy import text

router = APIRouter(prefix="/api/v1/organizations/{org}")


class ForestInput(StrictModel):
    revision: int = Field(ge=1, le=2147483647, strict=True)
    request_id: UUID
    allow_public_tile_requests: bool = Field(strict=True)
    source_id: Literal["gfc-2025-v1.13", "tmf-2025-epoch"] = "gfc-2025-v1.13"


@contextmanager
def work_slot(org, request_id):
    """Two DB-wide workers max, one per org; session locks, no open transaction.

    No queue is advertised. A busy request gets 409/429 and can be retried.
    Crash/disconnect releases PG session locks; immutable successful requests replay.
    """
    with engine().connect() as conn:
        held = []

        def take(key):
            ok = conn.execute(
                text("SELECT pg_try_advisory_lock(hashtextextended(:key,0))"),
                {"key": key},
            ).scalar_one()
            conn.commit()
            if ok:
                held.append(key)
            return ok

        try:
            if not take(f"forest-request:{org}:{request_id}"):
                raise HTTPException(
                    409,
                    "Cette analyse est déjà en cours. Réessayez avec le même identifiant.",
                )
            if not take(f"forest-org:{org}"):
                raise HTTPException(
                    429, "Une analyse est déjà en cours pour cette organisation."
                )
            if not any(take(f"forest-global-slot:{i}") for i in range(2)):
                raise HTTPException(
                    429, "Capacité d'analyse occupée. Réessayez plus tard."
                )
            yield
        finally:
            try:
                for key in reversed(held):
                    conn.execute(
                        text("SELECT pg_advisory_unlock(hashtextextended(:key,0))"),
                        {"key": key},
                    )
                conn.commit()
            except Exception:
                # Never return a pooled connection still holding advisory locks.
                conn.invalidate()
                raise


def public_record(row):
    item = dict(row)
    item.pop("input_sha256", None)
    item["result"] = {k: v for k, v in item["result"].items() if k != "windows"}
    return item


@router.get("/forest/sources")
def sources(org: UUID, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
    return {
        "enabled": settings().forest_analysis_enabled,
        "sources": [
            {
                "id": "gfc-2025-v1.13",
                "state": "AVAILABLE_ON_DEMAND"
                if settings().forest_analysis_enabled
                else "DISABLED",
                "period_end": "2025-12-31",
                "extent": "80N–60S; coverage checked per request",
                "license": "CC-BY-4.0",
                "attribution": "Source: Hansen/UMD/Google/USGS/NASA",
            },
            {
                "id": "tmf-2025-epoch",
                "state": "AVAILABLE_ON_DEMAND"
                if settings().forest_analysis_enabled
                else "DISABLED",
                "period_end": "2025-12-31",
                "extent": "86 native grids; tropical moist forests, not every forest type",
                "attribution": "Source: EC JRC; COG repackaging: Epoch / Source Cooperative; no EU endorsement",
            },
        ],
        "regulatory_status": "NOT_ASSESSED",
    }


@router.get("/plots/{plot}/forest-analyses")
def history(
    org: UUID,
    plot: UUID,
    revision: int = Query(..., ge=1),
    page: int = Query(1, ge=1, le=1000),
    identity=Depends(require_identity),
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        bounded(conn)
        get_plot(conn, org, plot)
        params = {"o": org, "p": plot, "r": revision, "offset": (page - 1) * 20}
        if not conn.execute(
            text(
                "SELECT 1 FROM plot_geolocations WHERE organization_id=:o AND plot_id=:p AND revision=:r"
            ),
            params,
        ).first():
            raise HTTPException(404, "Révision introuvable")
        where = " WHERE organization_id=:o AND plot_id=:p AND revision=:r"
        total = conn.execute(
            text("SELECT count(*) FROM forest_analyses" + where), params
        ).scalar_one()
        items = [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT id,revision,created_at,result - 'windows' AS result FROM forest_analyses"
                    + where
                    + " ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET :offset"
                ),
                params,
            ).mappings()
        ]
        return {"items": items, "total": total, "page": page}


@router.get("/plots/{plot}/forest-analyses/{analysis}")
def evidence(org: UUID, plot: UUID, analysis: UUID, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        bounded(conn)
        get_plot(conn, org, plot)
        row = (
            conn.execute(
                text(
                    "SELECT id,revision,created_at,result FROM forest_analyses WHERE organization_id=:o AND plot_id=:p AND id=:a"
                ),
                {"o": org, "p": plot, "a": analysis},
            )
            .mappings()
            .first()
        )
        if not row:
            raise HTTPException(404, "Analyse introuvable")
        return dict(row)


@router.post("/plots/{plot}/forest-analyses")
def create(
    org: UUID,
    plot: UUID,
    body: ForestInput,
    request: Request,
    identity=Depends(require_identity),
):
    if not body.allow_public_tile_requests:
        raise HTTPException(
            422,
            "Confirmez la lecture des tuiles publiques et sa limite de confidentialité.",
        )
    digest = hashlib.sha256(
        json.dumps(
            {
                "plot": str(plot),
                "revision": body.revision,
                "allow_public_tile_requests": True,
                **(
                    {"source_id": body.source_id}
                    if body.source_id != "gfc-2025-v1.13"
                    else {}
                ),
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    params = {"o": org, "p": plot, "r": body.revision, "k": body.request_id}

    def prepare():
        with transaction(identity.id, org) as conn:
            authorize(conn, org, identity, WRITERS)
            bounded(conn)
            get_plot(conn, org, plot)
            prior = (
                conn.execute(
                    text(
                        "SELECT id,revision,created_at,result,input_sha256 FROM forest_analyses WHERE organization_id=:o AND request_id=:k"
                    ),
                    params,
                )
                .mappings()
                .first()
            )
            if prior:
                if prior["input_sha256"] != digest:
                    raise HTTPException(
                        409, "Identifiant déjà utilisé pour une autre entrée"
                    )
                return prior, None
            record = (
                conn.execute(
                    text(
                        "SELECT supplier_id,payload FROM plot_geolocations WHERE organization_id=:o AND plot_id=:p AND revision=:r"
                    ),
                    params,
                )
                .mappings()
                .first()
            )
            if not record:
                raise HTTPException(404, "Révision introuvable")
            validate_geometry(conn, record["payload"]["geometry"])
            return None, dict(record)

    prior, record = prepare()
    if prior:
        return public_record(prior) | {"replayed": True}
    if not settings().forest_analysis_enabled:
        raise HTTPException(503, "Analyse forestière non activée sur ce serveur.")
    with work_slot(org, body.request_id):
        # Check again after lock acquisition: an earlier identical request may
        # have completed between the first read and this lock.
        prior, record = prepare()
        if prior:
            return public_record(prior) | {"replayed": True}
        try:
            result = (
                isolated_analysis(record["payload"]["geometry"])
                if body.source_id == "gfc-2025-v1.13"
                else isolated_analysis(
                    record["payload"]["geometry"], source_id=body.source_id
                )
            )
        except SourceReadError as exc:
            raise HTTPException(
                503,
                {
                    "code": str(exc),
                    "message": "Analyse indisponible, aucun résultat favorable déduit.",
                },
            ) from None
        # Session expiry/revocation, role removal or reassignment during the
        # network work must prevent both persistence and response disclosure.
        refreshed = require_identity(request)
        if refreshed.id != identity.id:
            raise HTTPException(401, "Session modifiée")
        expected_sha = hashlib.sha256(
            json.dumps(
                record["payload"]["geometry"],
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            ).encode()
        ).hexdigest()
        if (
            result.get("geometry_sha256") != expected_sha
            or result.get("source_id", "gfc-2025-v1.13") != body.source_id
            or result.get("regulatory_status") != "NOT_ASSESSED"
            or result.get("human_review_required") is not True
            or result.get("status")
            not in {
                "OBSERVED",
                "PARTIAL",
                "NOT_COVERED",
                "BUDGET_EXCEEDED",
                "SOURCE_UNAVAILABLE",
            }
            or result.get("signal_status")
            not in {
                "SIGNAL_OBSERVED",
                "NO_SIGNAL_IN_SELECTED_LAND_PIXELS",
                "NOT_ASSESSABLE",
            }
        ):
            raise HTTPException(
                503, "Résultat de traitement incohérent, non enregistré"
            )
        encoded = json.dumps(result, allow_nan=False)
        if len(encoded.encode()) > 8 * 1024**2:
            raise HTTPException(503, "Preuve trop volumineuse")
        with transaction(refreshed.id, org) as conn:
            authorize(conn, org, refreshed, WRITERS)
            bounded(conn)
            get_plot(conn, org, plot)
            saved = dict(
                conn.execute(
                    text("""INSERT INTO forest_analyses(organization_id,supplier_id,plot_id,revision,request_id,input_sha256,result,actor_id)
            VALUES(:o,:s,:p,:r,:k,:h,CAST(:result AS jsonb),:u) RETURNING id,revision,created_at,result"""),
                    params
                    | {
                        "s": record["supplier_id"],
                        "h": digest,
                        "result": encoded,
                        "u": identity.id,
                    },
                )
                .mappings()
                .one()
            )
            event(
                conn,
                org,
                refreshed,
                "plot.forest_analyzed",
                "plot",
                plot,
                None,
                {
                    "analysis_id": saved["id"],
                    "revision": body.revision,
                    "status": result["status"],
                    "signal_status": result["signal_status"],
                    "geometry_sha256": result["geometry_sha256"],
                    "external_tile_access_acknowledged": True,
                    "source_id": body.source_id,
                },
            )
            return public_record(saved) | {"replayed": False}
