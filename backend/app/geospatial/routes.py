"""Authorized, revision-pinned, immutable country screening history."""

import hashlib
import json
from uuid import UUID

from app.database import transaction
from app.events import event
from app.geospatial.references import CATALOGUE, CATALOGUE_ERROR, EXCLUDED
from app.geospatial.screening import screen_country
from app.plots.services import bounded, get_plot
from app.schemas import StrictModel
from app.security import authorize, require_identity
from app.supply.schemas import READERS, WRITERS
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import Field
from sqlalchemy import text

router = APIRouter(prefix="/api/v1/organizations/{org}")


class CountryCheckInput(StrictModel):
    revision: int = Field(ge=1, strict=True)
    review_distance_m: int = Field(ge=0, le=50000, strict=True)
    request_id: UUID


@router.get("/geospatial/sources")
def sources(org: UUID, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        return {
            "coverage": "GLOBAL_INDICATIVE_WITH_EXCEPTIONS"
            if not CATALOGUE_ERROR
            else "UNAVAILABLE",
            "covered_count": len(CATALOGUE),
            "sources": [s.provenance() for s in CATALOGUE.values()],
            "excluded": [{"country": c, "reason": r} for c, r in EXCLUDED.items()],
            "catalogue_error": CATALOGUE_ERROR,
            "regulatory_status": "NOT_ASSESSED",
        }


@router.get("/plots/{plot}/country-checks")
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
        count = conn.execute(
            text("SELECT count(*) FROM country_checks" + where), params
        ).scalar_one()
        items = [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT id,revision,result,created_at FROM country_checks"
                    + where
                    + " ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET :offset"
                ),
                params,
            ).mappings()
        ]
        return {"items": items, "total": count, "page": page}


@router.post("/plots/{plot}/country-checks")
def create(
    org: UUID, plot: UUID, body: CountryCheckInput, identity=Depends(require_identity)
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        bounded(conn)
        get_plot(conn, org, plot)
        # Serialize only identical organization/request keys, including concurrent retries.
        conn.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
            {"key": str(org) + ":country-check:" + str(body.request_id)},
        )
        digest = hashlib.sha256(
            json.dumps(
                {
                    "plot": str(plot),
                    "revision": body.revision,
                    "review_distance_m": body.review_distance_m,
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()
        prior = (
            conn.execute(
                text(
                    "SELECT id,revision,result,created_at,input_sha256 FROM country_checks WHERE organization_id=:o AND request_id=:k"
                ),
                {"o": org, "k": body.request_id},
            )
            .mappings()
            .first()
        )
        if prior:
            if prior["input_sha256"] != digest:
                raise HTTPException(
                    409, "Identifiant de requête déjà utilisé avec une autre entrée"
                )
            return {k: v for k, v in prior.items() if k != "input_sha256"} | {
                "replayed": True
            }
        record = (
            conn.execute(
                text(
                    "SELECT supplier_id,payload FROM plot_geolocations WHERE organization_id=:o AND plot_id=:p AND revision=:r"
                ),
                {"o": org, "p": plot, "r": body.revision},
            )
            .mappings()
            .first()
        )
        if not record:
            raise HTTPException(404, "Révision introuvable")
        result = screen_country(
            conn,
            record["payload"]["geometry"],
            record["payload"]["country"],
            review_distance_m=body.review_distance_m,
        )
        saved = dict(
            conn.execute(
                text("""INSERT INTO country_checks(organization_id,supplier_id,plot_id,revision,request_id,input_sha256,result,actor_id)
         VALUES(:o,:s,:p,:r,:k,:h,CAST(:result AS jsonb),:u) RETURNING id,revision,result,created_at"""),
                {
                    "o": org,
                    "s": record["supplier_id"],
                    "p": plot,
                    "r": body.revision,
                    "k": body.request_id,
                    "h": digest,
                    "result": json.dumps(result, allow_nan=False),
                    "u": identity.id,
                },
            )
            .mappings()
            .one()
        )
        event(
            conn,
            org,
            identity,
            "plot.country_screened",
            "plot",
            plot,
            None,
            {
                "check_id": saved["id"],
                "revision": body.revision,
                "status": result["status"],
                "geometry_sha256": result["geometry_sha256"],
                "source": result["source"],
                "review_distance_m": body.review_distance_m,
            },
        )
        return saved | {"replayed": False}
