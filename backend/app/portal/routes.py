import json
import secrets
from uuid import UUID

import pycountry
from app.config import settings
from app.database import transaction
from app.portal.security import require_supplier, same_origin
from app.security import token_hash
from app.supply.schemas import CollectionSave, ExchangeInput, SubmitInput, completeness
from app.supply.services import expect_version, row
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import text

router = APIRouter(prefix="/api/portal")


def portal_event(conn, session, action, collection, before, after):
    conn.execute(
        text("""INSERT INTO audit_events(organization_id,actor_kind,supplier_actor_id,action,object_type,object_id,previous_value,new_value,source)
      VALUES(:o,'supplier',:s,:a,'supplier_collection',:c,CAST(:b AS jsonb),CAST(:n AS jsonb),'supplier_portal')"""),
        {
            "o": session.organization_id,
            "s": session.supplier_id,
            "a": action,
            "c": collection,
            "b": json.dumps(before, default=str) if before is not None else None,
            "n": json.dumps(after, default=str) if after is not None else None,
        },
    )


@router.post("/exchange")
def exchange(body: ExchangeInput, request: Request, response: Response):
    same_origin(request)
    raw = secrets.token_urlsafe(48)
    csrf = secrets.token_urlsafe(32)
    with transaction() as conn:
        accepted = conn.execute(
            text("SELECT authz.exchange_supplier_token(:i,:s,:c)"),
            {"i": token_hash(body.token), "s": token_hash(raw), "c": csrf},
        ).scalar_one()
        if not accepted:
            raise HTTPException(
                401,
                "Lien invalide, déjà utilisé, expiré ou révoqué. Demandez un nouveau lien.",
            )
        old = request.cookies.get(settings().portal_cookie)
        if old:
            conn.execute(
                text("SELECT authz.supplier_logout(:h)"), {"h": token_hash(old)}
            )
    response.set_cookie(
        settings().portal_cookie,
        raw,
        max_age=8 * 3600,
        httponly=True,
        secure=settings().secure_cookie,
        samesite="lax",
        path="/",
    )
    return {"message": "Accès limité au fournisseur ouvert", "csrf_token": csrf}


@router.post("/logout", status_code=204)
def logout(session=Depends(require_supplier)):
    with transaction() as conn:
        conn.execute(
            text("SELECT authz.supplier_logout(:h)"), {"h": session.token_hash}
        )
    response = Response(status_code=204)
    response.delete_cookie(
        settings().portal_cookie,
        path="/",
        secure=settings().secure_cookie,
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/me")
def me(session=Depends(require_supplier)):
    with transaction(
        organization_id=session.organization_id, portal_session=session.token_hash
    ) as conn:
        collections = [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT * FROM supplier_collections WHERE organization_id=:o AND supplier_id=:s ORDER BY updated_at DESC,id DESC LIMIT 30"
                ),
                {"o": session.organization_id, "s": session.supplier_id},
            ).mappings()
        ]
        commodities = [
            dict(r)
            for r in conn.execute(
                text("SELECT code,label FROM commodities ORDER BY label")
            ).mappings()
        ]
    for collection in collections:
        collection["completeness"] = completeness(collection["payload"])
        collection.pop("reviewed_by", None)
    return {
        "supplier_name": session.supplier_name,
        "organization_name": session.organization_name,
        "csrf_token": session.csrf_token,
        "expires_at": session.expires_at,
        "collections": collections,
        "commodities": commodities,
        "countries": [c.alpha_2 for c in pycountry.countries],
        "scope": "INITIAL_COLLECTION_ONLY",
        "notice": "Cette collecte ne constitue pas une déclaration EUDR. Parcelles et documents : étapes ultérieures.",
    }


@router.put("/collections/{collection}")
def save(collection: UUID, body: CollectionSave, session=Depends(require_supplier)):
    with transaction(
        organization_id=session.organization_id, portal_session=session.token_hash
    ) as conn:
        before = row(
            conn, "supplier_collections", session.organization_id, collection, True
        )
        expect_version(before, body.version)
        if before["status"] not in {"DRAFT", "CHANGES_REQUESTED"}:
            raise HTTPException(
                409, "Cette version a été transmise. Elle ne peut plus être modifiée."
            )
        payload = body.payload.model_dump(mode="json")
        result = dict(
            conn.execute(
                text(
                    "UPDATE supplier_collections SET payload=CAST(:p AS jsonb),version=version+1,updated_at=now() WHERE organization_id=:o AND id=:id RETURNING *"
                ),
                {
                    "p": json.dumps(payload),
                    "o": session.organization_id,
                    "id": collection,
                },
            )
            .mappings()
            .one()
        )
        portal_event(
            conn,
            session,
            "supplier.collection_saved",
            collection,
            {"payload": before["payload"], "version": before["version"]},
            {"payload": payload, "version": result["version"]},
        )
    result["completeness"] = completeness(result["payload"])
    result.pop("reviewed_by", None)
    return result


@router.post("/collections/{collection}/submit")
def submit(collection: UUID, body: SubmitInput, session=Depends(require_supplier)):
    with transaction(
        organization_id=session.organization_id, portal_session=session.token_hash
    ) as conn:
        before = row(
            conn, "supplier_collections", session.organization_id, collection, True
        )
        expect_version(before, body.version)
        if before["status"] not in {"DRAFT", "CHANGES_REQUESTED"}:
            raise HTTPException(409, "Cette collecte a déjà été transmise")
        completion = completeness(before["payload"])
        if completion["missing"]:
            raise HTTPException(
                422,
                {
                    "message": "Complétez les informations de collecte avant transmission",
                    "missing": completion["missing"],
                },
            )
        result = dict(
            conn.execute(
                text(
                    "UPDATE supplier_collections SET status='SUBMITTED',submitted_at=now(),updated_at=now(),version=version+1 WHERE organization_id=:o AND id=:id RETURNING *"
                ),
                {"o": session.organization_id, "id": collection},
            )
            .mappings()
            .one()
        )
        conn.execute(
            text(
                "INSERT INTO collection_revisions(organization_id,supplier_id,collection_id,version,payload) VALUES(:o,:s,:id,:v,CAST(:p AS jsonb))"
            ),
            {
                "o": session.organization_id,
                "s": session.supplier_id,
                "id": collection,
                "v": result["version"],
                "p": json.dumps(result["payload"]),
            },
        )
        portal_event(
            conn,
            session,
            "supplier.collection_submitted",
            collection,
            {"status": before["status"], "version": before["version"]},
            {
                "status": "SUBMITTED",
                "version": result["version"],
                "confirmation": "Initial data accuracy confirmed; not an EUDR declaration",
            },
        )
    result["completeness"] = completeness(result["payload"])
    result.pop("reviewed_by", None)
    return result
