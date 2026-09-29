"""Resolve private source facts under the caller's RLS transaction, never browser facts."""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from app.diligence.core import LotFact, Preparation, canonical_bytes, fingerprint
from app.documents import processing
from app.documents.compliance import context, evidence
from app.documents.routes import digest
from app.documents.storage import Blob, StorageError
from app.schemas import StrictModel
from fastapi import HTTPException
from pydantic import Field, model_validator
from sqlalchemy import text


class LotDeclaration(StrictModel):
    lot_id: UUID
    scientific_names: list[str] = Field(default_factory=list, max_length=30)
    scientific_names_complete_confirmed: bool = Field(default=False, strict=True)
    geolocation_complete_confirmed: bool = Field(default=False, strict=True)
    additional_unit_reviewed: bool = Field(default=False, strict=True)
    additional_unit_note: str = Field(default="", max_length=2000)
    declared_net_mass_kg: Decimal | None = Field(
        default=None, gt=0, max_digits=18, decimal_places=6, allow_inf_nan=False
    )

    @model_validator(mode="after")
    def names(self):
        self.scientific_names = [v.strip() for v in self.scientific_names]
        if len(set(self.scientific_names)) != len(self.scientific_names) or any(
            not n or len(n) > 200 for n in self.scientific_names
        ):
            raise ValueError("Noms scientifiques vides, dupliqués ou trop longs")
        return self


class Declaration(StrictModel):
    preparation: Preparation
    lots: list[LotDeclaration] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def unique(self):
        if len({v.lot_id for v in self.lots}) != len(self.lots):
            raise ValueError("Lots dupliqués")
        return self


def one(conn, sql, params):
    row = conn.execute(text(sql), params).mappings().first()
    return dict(row) if row else None


def geometry_ready(p, commodities, country):
    payload = p["payload"]
    analysis = p["analysis"]
    if analysis.get("technical_status") != "VALID" or payload.get("country") != country:
        return False
    if any(
        w["code"] in {"IS_TRUNCATION_INVALIDATES", "IS_HOLES_NOT_SUPPORTED"}
        for w in analysis.get("warnings", [])
    ):
        return False
    if payload["geometry"]["type"] == "Point" and set(commodities) != {"cattle"}:
        area = payload.get("declared_area_ha")
        if area is None or Decimal(str(area)) > 4:
            return False
    return True


def resolve(conn, a, declaration):
    sources = []
    facts = []
    checked = {}
    byte_budget = 0
    for declared in sorted(declaration.lots, key=lambda x: str(x.lot_id)):
        lid = declared.lot_id
        ctx = context(conn, a, lid)
        item = ctx["lot"]
        params = {
            "o": a.org,
            "l": lid,
            "s": item["supplier_id"],
            "p": item["product_id"],
        }
        supplier = one(
            conn,
            "SELECT id,reference,name,address,email,country,version,archived_at FROM suppliers WHERE organization_id=:o AND id=:s",
            params,
        )
        product = one(
            conn,
            "SELECT id,reference,name,description,hs_code,version,archived_at FROM products WHERE organization_id=:o AND id=:p",
            params,
        )
        commodities = list(
            conn.execute(
                text(
                    "SELECT commodity_code FROM product_commodities WHERE organization_id=:o AND product_id=:p ORDER BY commodity_code"
                ),
                params,
            ).scalars()
        )
        # Bound payload volume in SQL before materializing full geometries.
        total = conn.execute(
            text("""SELECT COALESCE(sum(octet_length(g.payload::text)+octet_length(g.analysis::text)),0)
          FROM lot_plots lp JOIN plot_geolocations g ON (g.organization_id,g.plot_id,g.revision)=(lp.organization_id,lp.plot_id,lp.revision)
          WHERE lp.organization_id=:o AND lp.lot_id=:l"""),
            params,
        ).scalar_one()
        if total > 1000000:
            raise HTTPException(
                409,
                "Géométries trop volumineuses pour ce dossier ; réduire son périmètre",
            )
        plots = [
            dict(r)
            for r in conn.execute(
                text("""SELECT g.plot_id,g.revision,g.payload,g.analysis,p.archived_at,p.current_revision
          FROM lot_plots lp JOIN plot_geolocations g ON(g.organization_id,g.plot_id,g.revision)=(lp.organization_id,lp.plot_id,lp.revision)
          JOIN plots p ON(p.organization_id,p.id)=(lp.organization_id,lp.plot_id)
          WHERE lp.organization_id=:o AND lp.lot_id=:l ORDER BY g.plot_id"""),
                params,
            ).mappings()
        ]
        risk = one(
            conn,
            "SELECT * FROM risk_assessments WHERE organization_id=:o AND lot_id=:l ORDER BY created_at DESC,id DESC LIMIT 1",
            params,
        )
        proofs = []
        available = False
        if risk:
            ids = [
                UUID(v)
                for v in risk["result"]["review"].get("evidence_version_ids", [])
            ]
            proofs = evidence(conn, a, item["supplier_id"], ids, lid)
            available = bool(proofs)
            for proof in proofs:
                key = str(proof["id"])
                if key not in checked:
                    blob = one(
                        conn,
                        "SELECT object_id,expected_size,sha256 FROM document_versions WHERE organization_id=:o AND id=:v",
                        {"o": a.org, "v": proof["id"]},
                    )
                    byte_budget += blob["expected_size"]
                    if byte_budget > 80 * 1024**2:
                        raise HTTPException(
                            409,
                            "Vérification bornée à 80 Mio de justificatifs distincts par dossier",
                        )
                    try:
                        with processing.store().open_verified(
                            Blob(
                                a.org,
                                blob["object_id"],
                                blob["expected_size"],
                                blob["sha256"],
                            )
                        ):
                            pass
                        checked[key] = True
                    except (OSError, StorageError):
                        checked[key] = False
                available = available and checked[key]
        legal = ctx.get("legality")
        legal_stale = ctx.get("legality_stale", True) or bool(
            legal and (datetime.now(timezone.utc) - legal["created_at"]).days >= 365
        )
        risk_fact = None
        if risk:
            r = risk["result"]
            risk_fact = {
                "id": risk["id"],
                "created_at": risk["created_at"],
                "input_sha256": risk["input_sha256"],
                "proposed_residual": r["review"]["proposed_residual"],
                "blocking_factors": sum(bool(f["blocking"]) for f in r["factors"]),
                "accepted_proof_count": len(proofs),
            }
        facts.append(
            LotFact(
                id=lid,
                reference=item["reference"],
                supplier_name=supplier["name"],
                supplier_address=supplier["address"],
                supplier_contact=supplier["email"],
                supplier_archived=supplier["archived_at"] is not None,
                product_archived=product["archived_at"] is not None,
                product_name=product["name"],
                product_description=product["description"],
                hs_code=product["hs_code"],
                commodities=commodities,
                quantity=item["quantity"],
                unit=item["unit"],
                origin_country=item["origin_country"] or "",
                production_start=item["production_start"],
                production_end=item["production_end"],
                plot_revision_count=len(plots),
                geometry_checks_passed=bool(plots)
                and all(
                    geometry_ready(p, commodities, item["origin_country"])
                    for p in plots
                ),
                current_plot_revisions=bool(plots)
                and all(
                    p["revision"] == p["current_revision"] and p["archived_at"] is None
                    for p in plots
                ),
                legal_qualified=bool(legal and legal["payload"]["framework_qualified"]),
                legal_stale=legal_stale,
                open_task_count=sum(t["state"] != "RESOLVED" for t in ctx["tasks"]),
                evidence_available=available,
                context_sha256=digest(ctx),
                risk=risk_fact,
                **declared.model_dump(exclude={"lot_id"}),
            )
        )
        sources.append(
            {
                "context": ctx,
                "supplier": supplier,
                "product": product,
                "commodities": commodities,
                "geolocations": plots,
                "risk": risk,
                "accepted_proofs": proofs,
                "evidence_integrity": {
                    str(p["id"]): checked[str(p["id"])] for p in proofs
                },
            }
        )
        canonical_bytes(sources)  # Aggregate bound, before accumulating another lot.
    return facts, sources, fingerprint(sources)
