import json
import secrets
from uuid import UUID

import pycountry
from app.config import settings
from app.database import transaction
from app.events import event
from app.security import authorize, require_identity, token_hash
from app.supply.schemas import (
    READERS,
    WRITERS,
    ContactInput,
    ContactUpdate,
    CsvInput,
    InvitationInput,
    LotInput,
    LotUpdate,
    ProductInput,
    ProductUpdate,
    ReviewInput,
    SupplierInput,
    SupplierUpdate,
    VersionInput,
    completeness,
)
from app.supply.services import (
    csv_rows,
    ensure_active,
    expect_version,
    insert,
    row,
    update,
)
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

router = APIRouter(prefix="/api/v1")


@router.get("/catalogue")
def catalogue(identity=Depends(require_identity)):
    with transaction(identity.id) as conn:
        commodities = (
            conn.execute(text("SELECT code,label FROM commodities ORDER BY label"))
            .mappings()
            .all()
        )
    return {
        "commodities": commodities,
        "countries": [{"code": c.alpha_2, "name": c.name} for c in pycountry.countries],
        "units": ["KG", "T", "M3", "PCS"],
        "scope_note": "Matières et codes déclaratifs. Assujettissement réglementaire non évalué.",
    }


@router.get("/organizations/{org}/supply-summary")
def summary(org: UUID, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        result = {
            key: conn.execute(
                text(
                    f"SELECT count(*) FROM {key} WHERE organization_id=:o AND archived_at IS NULL"
                ),
                {"o": org},
            ).scalar_one()
            for key in ["suppliers", "products", "lots"]
        }
        result["collections_to_review"] = conn.execute(
            text(
                "SELECT count(*) FROM supplier_collections WHERE organization_id=:o AND status='SUBMITTED'"
            ),
            {"o": org},
        ).scalar_one()
    return {**result, "regulatory_status": "NOT_ASSESSED"}


@router.get("/organizations/{org}/suppliers")
def suppliers(
    org: UUID,
    q: str = Query("", max_length=200),
    include_archived: bool = False,
    page: int = Query(1, ge=1, le=1000),
    limit: int = Query(20, ge=1, le=100),
    identity=Depends(require_identity),
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params = {
            "o": org,
            "q": "%" + escaped + "%",
            "archive": include_archived,
            "limit": limit,
            "offset": (page - 1) * limit,
        }
        where = "s.organization_id=:o AND (:archive OR s.archived_at IS NULL) AND (s.name ILIKE :q OR s.reference ILIKE :q)"
        total = conn.execute(
            text("SELECT count(*) FROM suppliers s WHERE " + where), params
        ).scalar_one()
        items = [
            dict(r)
            for r in conn.execute(
                text(
                    """SELECT s.*,
          (SELECT count(*) FROM lots l WHERE l.organization_id=s.organization_id AND l.supplier_id=s.id AND l.archived_at IS NULL) AS lot_count,
          (SELECT status FROM supplier_collections c WHERE c.organization_id=s.organization_id AND c.supplier_id=s.id ORDER BY updated_at DESC,id DESC LIMIT 1) AS collection_status
          FROM suppliers s WHERE """
                    + where
                    + " ORDER BY s.created_at DESC,s.id LIMIT :limit OFFSET :offset"
                ),
                params,
            ).mappings()
        ]
    for item in items:
        item["missing_fields"] = [
            k for k in ["country", "address", "email"] if not item[k]
        ]
        item["risk_status"] = "NOT_ASSESSED"
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.post("/organizations/{org}/suppliers", status_code=201)
def create_supplier(org: UUID, body: SupplierInput, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        result = insert(conn, "suppliers", org, body.model_dump())
        event(
            conn,
            org,
            identity,
            "supplier.created",
            "supplier",
            result["id"],
            None,
            result,
        )
    return result


@router.post("/organizations/{org}/suppliers/import-preview")
def preview_import(org: UUID, body: CsvInput, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        records, checksum = csv_rows(body.csv_text)
        existing = set(
            conn.execute(
                text(
                    "SELECT reference FROM suppliers WHERE organization_id=:o AND reference=ANY(:refs)"
                ),
                {"o": org, "refs": [r["reference"] for r in records]},
            ).scalars()
        )
        replay = (
            conn.execute(
                text(
                    "SELECT 1 FROM supplier_imports WHERE organization_id=:o AND checksum=:c"
                ),
                {"o": org, "c": checksum},
            ).first()
            is not None
        )
    return {
        "items": records,
        "checksum": checksum,
        "existing_references": sorted(existing),
        "already_imported": replay,
        "can_import": not existing or replay,
    }


@router.post("/organizations/{org}/suppliers/import")
def apply_import(org: UUID, body: CsvInput, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        records, checksum = csv_rows(body.csv_text)
        conn.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:k,0))"),
            {"k": str(org) + checksum},
        )
        old = conn.execute(
            text(
                "SELECT created_count FROM supplier_imports WHERE organization_id=:o AND checksum=:c"
            ),
            {"o": org, "c": checksum},
        ).scalar()
        if old is not None:
            return {"created_count": 0, "original_count": old, "replayed": True}
        for data in records:
            created = insert(conn, "suppliers", org, data)
            event(
                conn,
                org,
                identity,
                "supplier.imported",
                "supplier",
                created["id"],
                None,
                created,
            )
        conn.execute(
            text(
                "INSERT INTO supplier_imports(organization_id,checksum,created_count) VALUES(:o,:c,:n)"
            ),
            {"o": org, "c": checksum, "n": len(records)},
        )
    return {"created_count": len(records), "replayed": False}


@router.get("/organizations/{org}/suppliers/{supplier}")
def supplier_detail(org: UUID, supplier: UUID, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        role = authorize(conn, org, identity, READERS)
        result = row(conn, "suppliers", org, supplier)
        result["contacts"] = [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT * FROM supplier_contacts WHERE organization_id=:o AND supplier_id=:s ORDER BY name,id"
                ),
                {"o": org, "s": supplier},
            ).mappings()
        ]
        result["collections"] = [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT * FROM supplier_collections WHERE organization_id=:o AND supplier_id=:s ORDER BY updated_at DESC,id DESC LIMIT 30"
                ),
                {"o": org, "s": supplier},
            ).mappings()
        ]
        result["invitations"] = (
            [
                dict(r)
                for r in conn.execute(
                    text(
                        "SELECT id,created_at,expires_at,used_at,revoked_at FROM supplier_invitations WHERE organization_id=:o AND supplier_id=:s ORDER BY created_at DESC LIMIT 10"
                    ),
                    {"o": org, "s": supplier},
                ).mappings()
            ]
            if role in WRITERS
            else []
        )
        result["product_ids"] = (
            conn.execute(
                text(
                    "SELECT product_id FROM supplier_products WHERE organization_id=:o AND supplier_id=:s"
                ),
                {"o": org, "s": supplier},
            )
            .scalars()
            .all()
        )
    for collection in result["collections"]:
        collection["completeness"] = completeness(collection["payload"])
    result["missing_fields"] = [
        k for k in ["country", "address", "email"] if not result[k]
    ]
    result["plots_status"] = "NOT_AVAILABLE"
    result["risk_status"] = "NOT_ASSESSED"
    return result


@router.put("/organizations/{org}/suppliers/{supplier}")
def edit_supplier(
    org: UUID, supplier: UUID, body: SupplierUpdate, identity=Depends(require_identity)
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        before = row(conn, "suppliers", org, supplier, True)
        ensure_active(before)
        expect_version(before, body.version)
        result = update(
            conn, "suppliers", org, supplier, body.model_dump(exclude={"version"})
        )
        event(
            conn,
            org,
            identity,
            "supplier.updated",
            "supplier",
            supplier,
            before,
            result,
        )
    return result


@router.post("/organizations/{org}/suppliers/{supplier}/contacts", status_code=201)
def add_contact(
    org: UUID, supplier: UUID, body: ContactInput, identity=Depends(require_identity)
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        ensure_active(row(conn, "suppliers", org, supplier, True))
        result = insert(
            conn,
            "supplier_contacts",
            org,
            {"supplier_id": supplier, **body.model_dump()},
        )
        event(
            conn,
            org,
            identity,
            "contact.created",
            "supplier_contact",
            result["id"],
            None,
            result,
        )
    return result


@router.put("/organizations/{org}/suppliers/{supplier}/contacts/{contact}")
def edit_contact(
    org: UUID,
    supplier: UUID,
    contact: UUID,
    body: ContactUpdate,
    identity=Depends(require_identity),
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        ensure_active(row(conn, "suppliers", org, supplier, True))
        before = row(conn, "supplier_contacts", org, contact, True)
        if before["supplier_id"] != supplier:
            raise HTTPException(404, "Contact introuvable")
        expect_version(before, body.version)
        result = update(
            conn,
            "supplier_contacts",
            org,
            contact,
            body.model_dump(exclude={"version"}),
        )
        event(
            conn,
            org,
            identity,
            "contact.updated",
            "supplier_contact",
            contact,
            before,
            result,
        )
    return result


@router.delete(
    "/organizations/{org}/suppliers/{supplier}/contacts/{contact}", status_code=204
)
def delete_contact(
    org: UUID,
    supplier: UUID,
    contact: UUID,
    version: int = Query(ge=1),
    identity=Depends(require_identity),
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        ensure_active(row(conn, "suppliers", org, supplier, True))
        before = row(conn, "supplier_contacts", org, contact, True)
        if before["supplier_id"] != supplier:
            raise HTTPException(404, "Contact introuvable")
        expect_version(before, version)
        event(
            conn,
            org,
            identity,
            "contact.removed",
            "supplier_contact",
            contact,
            before,
            None,
        )
        conn.execute(
            text("DELETE FROM supplier_contacts WHERE organization_id=:o AND id=:id"),
            {"o": org, "id": contact},
        )


PRODUCT_SELECT = """SELECT p.*, ARRAY(SELECT commodity_code FROM product_commodities c WHERE c.organization_id=p.organization_id AND c.product_id=p.id ORDER BY commodity_code) AS commodities,
 ARRAY(SELECT supplier_id FROM supplier_products sp WHERE sp.organization_id=p.organization_id AND sp.product_id=p.id ORDER BY supplier_id) AS supplier_ids FROM products p"""


@router.get("/organizations/{org}/products")
def products(
    org: UUID,
    supplier_id: UUID | None = None,
    q: str = Query("", max_length=200),
    include_archived: bool = False,
    page: int = Query(1, ge=1, le=1000),
    limit: int = Query(20, ge=1, le=100),
    identity=Depends(require_identity),
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        params = {
            "o": org,
            "supplier": supplier_id,
            "q": "%"
            + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            + "%",
            "archive": include_archived,
            "limit": limit,
            "offset": (page - 1) * limit,
        }
        where = " WHERE p.organization_id=:o AND (:archive OR p.archived_at IS NULL) AND (p.name ILIKE :q OR p.reference ILIKE :q) AND (CAST(:supplier AS uuid) IS NULL OR EXISTS(SELECT 1 FROM supplier_products sp WHERE sp.organization_id=p.organization_id AND sp.product_id=p.id AND sp.supplier_id=:supplier))"
        total = conn.execute(
            text("SELECT count(*) FROM products p" + where), params
        ).scalar_one()
        items = [
            {**dict(r), "regulatory_status": "NOT_ASSESSED"}
            for r in conn.execute(
                text(
                    PRODUCT_SELECT
                    + where
                    + " ORDER BY p.created_at DESC,p.id LIMIT :limit OFFSET :offset"
                ),
                params,
            ).mappings()
        ]
    return {"items": items, "total": total, "page": page, "limit": limit}


def product_relations(conn, org, pid, body):
    for sid in body.supplier_ids:
        ensure_active(row(conn, "suppliers", org, sid, True))
    old = set(
        conn.execute(
            text(
                "SELECT supplier_id FROM supplier_products WHERE organization_id=:o AND product_id=:p"
            ),
            {"o": org, "p": pid},
        ).scalars()
    )
    for sid in old - set(body.supplier_ids):
        conn.execute(
            text(
                "DELETE FROM supplier_products WHERE organization_id=:o AND product_id=:p AND supplier_id=:s"
            ),
            {"o": org, "p": pid, "s": sid},
        )
    for sid in set(body.supplier_ids) - old:
        conn.execute(
            text(
                "INSERT INTO supplier_products(organization_id,product_id,supplier_id) VALUES(:o,:p,:s)"
            ),
            {"o": org, "p": pid, "s": sid},
        )
    conn.execute(
        text(
            "DELETE FROM product_commodities WHERE organization_id=:o AND product_id=:p"
        ),
        {"o": org, "p": pid},
    )
    for code in body.commodities:
        conn.execute(
            text("INSERT INTO product_commodities VALUES(:o,:p,:c)"),
            {"o": org, "p": pid, "c": code},
        )


def product_snapshot(conn, org, pid):
    return {
        **dict(
            conn.execute(
                text(PRODUCT_SELECT + " WHERE p.organization_id=:o AND p.id=:p"),
                {"o": org, "p": pid},
            )
            .mappings()
            .one()
        ),
        "regulatory_status": "NOT_ASSESSED",
    }


@router.post("/organizations/{org}/products", status_code=201)
def add_product(org: UUID, body: ProductInput, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        created = insert(
            conn,
            "products",
            org,
            body.model_dump(exclude={"commodities", "supplier_ids"}),
        )
        product_relations(conn, org, created["id"], body)
        result = product_snapshot(conn, org, created["id"])
        event(
            conn,
            org,
            identity,
            "product.created",
            "product",
            created["id"],
            None,
            result,
        )
    return result


@router.put("/organizations/{org}/products/{product}")
def edit_product(
    org: UUID, product: UUID, body: ProductUpdate, identity=Depends(require_identity)
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        locked = row(conn, "products", org, product, True)
        ensure_active(locked)
        expect_version(locked, body.version)
        before = product_snapshot(conn, org, product)
        update(
            conn,
            "products",
            org,
            product,
            body.model_dump(exclude={"version", "commodities", "supplier_ids"}),
        )
        product_relations(conn, org, product, body)
        result = product_snapshot(conn, org, product)
        event(
            conn, org, identity, "product.updated", "product", product, before, result
        )
    return result


LOT_SELECT = """SELECT l.*,l.quantity::text AS quantity,s.name AS supplier_name,p.name AS product_name FROM lots l
 JOIN suppliers s ON(s.organization_id,s.id)=(l.organization_id,l.supplier_id)
 JOIN products p ON(p.organization_id,p.id)=(l.organization_id,l.product_id)"""


@router.get("/organizations/{org}/lots")
def lots(
    org: UUID,
    q: str = Query("", max_length=200),
    include_archived: bool = False,
    page: int = Query(1, ge=1, le=1000),
    limit: int = Query(20, ge=1, le=100),
    identity=Depends(require_identity),
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, READERS)
        params = {
            "o": org,
            "q": "%"
            + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            + "%",
            "archive": include_archived,
            "limit": limit,
            "offset": (page - 1) * limit,
        }
        where = " WHERE l.organization_id=:o AND (:archive OR l.archived_at IS NULL) AND l.reference ILIKE :q"
        total = conn.execute(
            text("SELECT count(*) FROM lots l" + where), params
        ).scalar_one()
        items = [
            dict(r)
            for r in conn.execute(
                text(
                    LOT_SELECT
                    + where
                    + " ORDER BY l.created_at DESC,l.id LIMIT :limit OFFSET :offset"
                ),
                params,
            ).mappings()
        ]
    for item in items:
        item["missing_fields"] = [
            k
            for k in ["origin_country", "production_start", "production_end"]
            if not item[k]
        ]
        item["regulatory_status"] = "NOT_ASSESSED"
    return {"items": items, "total": total, "page": page, "limit": limit}


def lot_dependencies(conn, org, body):
    ensure_active(row(conn, "suppliers", org, body.supplier_id, True))
    ensure_active(row(conn, "products", org, body.product_id, True))
    if not conn.execute(
        text(
            "SELECT 1 FROM supplier_products WHERE organization_id=:o AND supplier_id=:s AND product_id=:p"
        ),
        {"o": org, "s": body.supplier_id, "p": body.product_id},
    ).first():
        raise HTTPException(422, "Associez d’abord ce produit à ce fournisseur")
    if body.source_collection_id:
        source = row(conn, "supplier_collections", org, body.source_collection_id)
        if source["supplier_id"] != body.supplier_id or source["status"] != "REVIEWED":
            raise HTTPException(
                422,
                "La collecte source doit être revue et appartenir au fournisseur du lot",
            )


@router.post("/organizations/{org}/lots", status_code=201)
def add_lot(org: UUID, body: LotInput, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        lot_dependencies(conn, org, body)
        result = insert(conn, "lots", org, body.model_dump())
        event(conn, org, identity, "lot.created", "lot", result["id"], None, result)
    return {
        **result,
        "quantity": str(result["quantity"]),
        "regulatory_status": "NOT_ASSESSED",
    }


@router.put("/organizations/{org}/lots/{lot}")
def edit_lot(org: UUID, lot: UUID, body: LotUpdate, identity=Depends(require_identity)):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        before = row(conn, "lots", org, lot, True)
        ensure_active(before)
        expect_version(before, body.version)
        lot_dependencies(conn, org, body)
        result = update(conn, "lots", org, lot, body.model_dump(exclude={"version"}))
        event(conn, org, identity, "lot.updated", "lot", lot, before, result)
    return {
        **result,
        "quantity": str(result["quantity"]),
        "regulatory_status": "NOT_ASSESSED",
    }


@router.post("/organizations/{org}/{kind}/{object_id}/archive")
def archive(
    org: UUID,
    kind: str,
    object_id: UUID,
    body: VersionInput,
    identity=Depends(require_identity),
):
    if kind not in {"suppliers", "products", "lots"}:
        raise HTTPException(404, "Module introuvable")
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        before = row(conn, kind, org, object_id, True)
        expect_version(before, body.version)
        ensure_active(before)
        result = dict(
            conn.execute(
                text(
                    f"UPDATE {kind} SET archived_at=now(),updated_at=now(),version=version+1 WHERE organization_id=:o AND id=:id RETURNING *"
                ),
                {"o": org, "id": object_id},
            )
            .mappings()
            .one()
        )
        if kind == "suppliers":
            conn.execute(
                text(
                    "UPDATE supplier_invitations SET revoked_at=now() WHERE organization_id=:o AND supplier_id=:id AND revoked_at IS NULL"
                ),
                {"o": org, "id": object_id},
            )
        event(
            conn,
            org,
            identity,
            kind.rstrip("s") + ".archived",
            kind,
            object_id,
            before,
            result,
        )
    return {
        "id": object_id,
        "archived_at": result["archived_at"],
        "version": result["version"],
    }


@router.post("/organizations/{org}/suppliers/{supplier}/invitations", status_code=201)
def invite(
    org: UUID, supplier: UUID, body: InvitationInput, identity=Depends(require_identity)
):
    raw = secrets.token_urlsafe(48)
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        profile = row(conn, "suppliers", org, supplier, True)
        ensure_active(profile)
        # Reissuing revokes every older invitation and its sessions immediately.
        conn.execute(
            text(
                "UPDATE supplier_invitations SET revoked_at=now() WHERE organization_id=:o AND supplier_id=:s AND revoked_at IS NULL"
            ),
            {"o": org, "s": supplier},
        )
        result = dict(
            conn.execute(
                text("""INSERT INTO supplier_invitations(organization_id,supplier_id,token_hash,created_by,expires_at)
          VALUES(:o,:s,:h,:u,now()+make_interval(hours=>:hours)) RETURNING id,expires_at"""),
                {
                    "o": org,
                    "s": supplier,
                    "h": token_hash(raw),
                    "u": identity.id,
                    "hours": body.expires_in_hours,
                },
            )
            .mappings()
            .one()
        )
        latest = (
            conn.execute(
                text(
                    "SELECT * FROM supplier_collections WHERE organization_id=:o AND supplier_id=:s ORDER BY updated_at DESC,id DESC LIMIT 1"
                ),
                {"o": org, "s": supplier},
            )
            .mappings()
            .first()
        )
        if not latest or latest["status"] == "REVIEWED":
            payload = (
                latest["payload"]
                if latest
                else {
                    "company": {
                        k: profile[k]
                        for k in ["name", "country", "address", "email", "legal_type"]
                    },
                    "products": [],
                }
            )
            conn.execute(
                text(
                    "INSERT INTO supplier_collections(organization_id,supplier_id,payload) VALUES(:o,:s,CAST(:p AS jsonb))"
                ),
                {"o": org, "s": supplier, "p": json.dumps(payload)},
            )
        event(
            conn,
            org,
            identity,
            "supplier.invitation_created",
            "supplier",
            supplier,
            None,
            {
                "invitation_id": result["id"],
                "expires_at": result["expires_at"],
                "delivery": "MANUAL",
            },
        )
    return {
        **result,
        "url": settings().public_origin + "/portail#invite=" + raw,
        "delivery": "MANUAL",
        "notice": "Lien secret affiché une seule fois. Aucun email n’a été envoyé.",
    }


@router.delete(
    "/organizations/{org}/suppliers/{supplier}/invitations/{invitation}",
    status_code=204,
)
def revoke_invite(
    org: UUID, supplier: UUID, invitation: UUID, identity=Depends(require_identity)
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, WRITERS)
        row(conn, "suppliers", org, supplier, True)
        result = conn.execute(
            text(
                "UPDATE supplier_invitations SET revoked_at=now() WHERE organization_id=:o AND supplier_id=:s AND id=:id RETURNING id"
            ),
            {"o": org, "s": supplier, "id": invitation},
        ).scalar()
        if result is None:
            raise HTTPException(404, "Invitation introuvable")
        event(
            conn,
            org,
            identity,
            "supplier.invitation_revoked",
            "supplier",
            supplier,
            None,
            {"invitation_id": invitation},
        )


@router.post(
    "/organizations/{org}/suppliers/{supplier}/collections/{collection}/review"
)
def review(
    org: UUID,
    supplier: UUID,
    collection: UUID,
    body: ReviewInput,
    identity=Depends(require_identity),
):
    with transaction(identity.id, org) as conn:
        authorize(conn, org, identity, {"Admin", "Compliance Manager"})
        ensure_active(row(conn, "suppliers", org, supplier, True))
        before = row(conn, "supplier_collections", org, collection, True)
        if before["supplier_id"] != supplier:
            raise HTTPException(404, "Collecte introuvable")
        expect_version(before, body.version)
        if before["status"] != "SUBMITTED":
            raise HTTPException(409, "Seule une collecte soumise peut être revue")
        result = dict(
            conn.execute(
                text("""UPDATE supplier_collections SET status=:status,review_note=:note,reviewed_by=:u,reviewed_at=now(),updated_at=now(),version=version+1
          WHERE organization_id=:o AND id=:id RETURNING *"""),
                {
                    "o": org,
                    "id": collection,
                    "status": body.decision,
                    "note": body.note,
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
            "supplier.collection_reviewed",
            "supplier_collection",
            collection,
            {"status": before["status"], "version": before["version"]},
            {"status": body.decision, "note": body.note, "version": result["version"]},
        )
    return result
