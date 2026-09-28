"""Human, source-backed reviews and deterministic triage. Never a certification."""

import json
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from app.documents.routes import REVIEWERS, digest, staff_access
from app.schemas import StrictModel
from app.supply.schemas import Country
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, model_validator
from sqlalchemy import text

router = APIRouter(prefix="/api/v1/organizations/{org}/compliance")
LEGAL = {
    "land": "Droits d’utilisation des terres",
    "environment": "Protection de l’environnement",
    "forestry": "Règles forestières liées à la récolte du bois",
    "third_parties": "Droits des tiers",
    "labour": "Droits du travail",
    "human_rights": "Droits humains protégés",
    "fpic": "Consentement libre, préalable et éclairé",
    "tax_trade": "Fiscalité, anticorruption, commerce et douanes",
}
RISK = {
    "country": "Classement officiel du pays — source/date à vérifier",
    "forests": "Présence de forêts",
    "indigenous": "Présence de peuples autochtones",
    "consultation": "Consultation et coopération",
    "claims": "Revendications territoriales",
    "deforestation": "Déforestation/dégradation et signaux cartographiques",
    "reliability": "Fiabilité, validité et cohérence des preuves",
    "governance": "Corruption, droits humains, conflits et sanctions",
    "complexity": "Complexité et traçabilité de la chaîne",
    "mixing": "Mélange et contournement",
    "expert_groups": "Conclusions pertinentes des groupes experts",
    "concerns": "Préoccupations étayées et antécédents",
    "other": "Autres indices de non-conformité",
    "certifications": "Certifications complémentaires — aucune équivalence automatique",
}


class Criterion(StrictModel):
    code: str = Field(max_length=40)
    state: Literal["UNKNOWN", "CLEAR", "CONCERN", "NOT_APPLICABLE"] = "UNKNOWN"
    explanation: str = Field(default="", max_length=1500)
    source_reference: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def justified(self):
        if self.state != "UNKNOWN" and (
            len(self.explanation) < 10 or len(self.source_reference) < 10
        ):
            raise ValueError("Justification et source précises requises")
        return self


class Legality(StrictModel):
    input_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    country: Country
    production_period: str = Field(min_length=4, max_length=200)
    framework_qualified: bool = Field(default=False, strict=True)
    criteria: list[Criterion] = Field(min_length=8, max_length=8)
    evidence_version_ids: list[UUID] = Field(default_factory=list, max_length=30)
    note: str = Field(min_length=10, max_length=4000)


class Risk(StrictModel):
    input_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    criteria: list[Criterion] = Field(min_length=14, max_length=14)
    evidence_version_ids: list[UUID] = Field(default_factory=list, max_length=30)
    proposed_residual: Literal["UNDETERMINED", "NON_NEGLIGIBLE", "NEGLIGIBLE"] = (
        "UNDETERMINED"
    )
    note: str = Field(min_length=10, max_length=4000)


class Task(StrictModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=4000)
    assigned_to: UUID
    due_date: date


class TaskUpdate(Task):
    version: int = Field(ge=1, strict=True)
    state: Literal["OPEN", "IN_PROGRESS", "RESOLVED"]
    resolution_note: str = Field(default="", max_length=4000)
    proof_version_id: UUID | None = None


def require_staff(conn, a, review=False):
    from app.security import authorize

    authorize(
        conn,
        a.org,
        a.actor,
        REVIEWERS
        if review
        else {"Admin", "Compliance Manager", "Procurement", "Analyst", "Viewer"},
    )


def lot_row(conn, a, lot):
    row = (
        conn.execute(
            text(
                "SELECT * FROM lots WHERE organization_id=:o AND id=:l AND archived_at IS NULL"
            ),
            {"o": a.org, "l": lot},
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(404, "Lot introuvable")
    return dict(row)


def validate_codes(criteria, codes):
    if {c.code for c in criteria} != set(codes) or len(criteria) != len(codes):
        raise HTTPException(422, "Critères incomplets ou dupliqués")


def evidence(conn, a, sid, ids, lot):
    found = []
    for v in ids:
        r = (
            conn.execute(
                text("""SELECT v.id,v.sha256,v.metadata,v.state,
          (SELECT decision FROM document_reviews r WHERE r.organization_id=v.organization_id AND r.version_id=v.id ORDER BY created_at DESC,id DESC LIMIT 1) AS review
          FROM document_versions v WHERE v.organization_id=:o AND v.supplier_id=:s AND v.id=:v"""),
                {"o": a.org, "s": sid, "v": v},
            )
            .mappings()
            .first()
        )
        if not r:
            raise HTTPException(404, "Preuve introuvable dans ce périmètre")
        if r["state"] != "SCAN_PASSED" or r["review"] != "ACCEPTED":
            raise HTTPException(
                409, "Les preuves doivent être contrôlées et acceptées en revue"
            )
        scope = (
            conn.execute(
                text(
                    "SELECT d.* FROM documents d JOIN document_versions v ON(v.organization_id,v.document_id)=(d.organization_id,d.id) WHERE v.organization_id=:o AND v.id=:v"
                ),
                {"o": a.org, "v": v},
            )
            .mappings()
            .one()
        )
        if scope["lot_id"] and scope["lot_id"] != lot:
            raise HTTPException(409, "Preuve liée à un autre lot")
        if (
            scope["plot_id"]
            and not conn.execute(
                text(
                    "SELECT 1 FROM lot_plots WHERE organization_id=:o AND lot_id=:l AND plot_id=:p AND revision=:r"
                ),
                {
                    "o": a.org,
                    "l": lot,
                    "p": scope["plot_id"],
                    "r": scope["plot_revision"],
                },
            ).first()
        ):
            raise HTTPException(409, "Preuve liée à une autre révision de parcelle")
        found.append(dict(r))
    return found


def context(conn, a, lot, include_legality=True):
    record = lot_row(conn, a, lot)
    sid = record["supplier_id"]
    docs = [
        dict(r)
        for r in conn.execute(
            text("""SELECT DISTINCT ON(v.document_id) v.id,v.document_id,v.version,v.metadata,v.state,v.sha256,
      (SELECT jsonb_build_object('id',r.id,'decision',r.decision) FROM document_reviews r WHERE r.organization_id=v.organization_id AND r.version_id=v.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS review
      FROM document_versions v JOIN documents d ON(d.organization_id,d.id)=(v.organization_id,v.document_id)
      WHERE v.organization_id=:o AND v.supplier_id=:s AND (d.lot_id IS NULL OR d.lot_id=:l)
      AND (d.plot_id IS NULL OR EXISTS(SELECT 1 FROM lot_plots lp WHERE lp.organization_id=:o AND lp.lot_id=:l AND lp.plot_id=d.plot_id AND lp.revision=d.plot_revision))
      ORDER BY v.document_id,v.version DESC"""),
            {"o": a.org, "s": sid, "l": lot},
        ).mappings()
    ]
    if len(docs) > 200:
        raise HTTPException(
            409, "Périmètre documentaire trop volumineux pour cette évaluation"
        )
    for d in docs:
        until = d["metadata"].get("valid_until")
        start = d["metadata"].get("valid_from")
        d["expired_now"] = bool(until and date.fromisoformat(until) < date.today())
        d["not_yet_valid"] = bool(start and date.fromisoformat(start) > date.today())
    plots = [
        dict(r)
        for r in conn.execute(
            text(
                "SELECT lp.plot_id,lp.revision,p.current_revision FROM lot_plots lp JOIN plots p ON(p.organization_id,p.id)=(lp.organization_id,lp.plot_id) WHERE lp.organization_id=:o AND lp.lot_id=:l ORDER BY lp.plot_id"
            ),
            {"o": a.org, "l": lot},
        ).mappings()
    ]
    if len(plots) > 100:
        raise HTTPException(409, "Évaluation limitée à 100 parcelles par lot")
    for p in plots:
        p["forest"] = [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT DISTINCT ON(COALESCE(result->>'source_id','gfc-2025-v1.13')) id,created_at,result-'windows' AS result FROM forest_analyses WHERE organization_id=:o AND plot_id=:p AND revision=:r ORDER BY COALESCE(result->>'source_id','gfc-2025-v1.13'),created_at DESC,id DESC"
                ),
                {"o": a.org, "p": p["plot_id"], "r": p["revision"]},
            ).mappings()
        ]
    supplier = dict(
        conn.execute(
            text(
                "SELECT id,country,version,archived_at FROM suppliers WHERE organization_id=:o AND id=:s"
            ),
            {"o": a.org, "s": sid},
        )
        .mappings()
        .one()
    )
    result = {"lot": record, "supplier": supplier, "documents": docs, "plots": plots}
    if include_legality:
        legal = (
            conn.execute(
                text(
                    "SELECT * FROM legality_assessments WHERE organization_id=:o AND lot_id=:l ORDER BY created_at DESC,id DESC LIMIT 1"
                ),
                {"o": a.org, "l": lot},
            )
            .mappings()
            .first()
        )
        result["legality"] = dict(legal) if legal else None
        # Legal context is exactly the base four sections; the assessment itself
        # is never included in its own fingerprint.
        result["legality_stale"] = bool(
            legal
            and legal["input_sha256"]
            != digest({k: result[k] for k in ("lot", "supplier", "documents", "plots")})
        )
        result["tasks"] = [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT * FROM compliance_tasks WHERE organization_id=:o AND lot_id=:l ORDER BY id"
                ),
                {"o": a.org, "l": lot},
            ).mappings()
        ]
    return result


def factors(snapshot, criteria, has_proofs=False):
    output = []

    def add(code, note, reference=None):
        domain = (
            "reliability"
            if code == "VALIDITY_REVIEW"
            else "deforestation"
            if code
            in (
                "FOREST_SIGNAL",
                "FOREST_INCOMPLETE",
                "FOREST_OBSERVATIONS_MISSING",
                "TEMPORAL_GAP",
            )
            else None
        )
        resolved = bool(
            domain
            and has_proofs
            and any(c.code == domain and c.state == "CLEAR" for c in criteria)
        )
        output.append(
            {
                "code": code,
                "message": note,
                "reference": str(reference) if reference else None,
                "blocking": not resolved,
                "resolved_by_human_review": resolved,
            }
        )

    if not snapshot["lot"]["origin_country"]:
        add("ORIGIN_MISSING", "Origine du lot manquante")
    if not snapshot["lot"].get("production_start") or not snapshot["lot"].get(
        "production_end"
    ):
        add("PERIOD_MISSING", "Période de production incomplète")
    if not snapshot["plots"]:
        add("GEOLOCATION_MISSING", "Aucune révision de parcelle liée au lot")
    if not snapshot["documents"]:
        add("EVIDENCE_MISSING", "Aucune preuve documentaire liée au périmètre")
    for d in snapshot["documents"]:
        if (
            d["state"] != "SCAN_PASSED"
            or not d["review"]
            or d["review"]["decision"] != "ACCEPTED"
        ):
            add(
                "DOCUMENT_NOT_ACCEPTED",
                "Document non disponible ou non accepté en revue",
                d["id"],
            )
        if d["expired_now"] or d["not_yet_valid"]:
            add(
                "VALIDITY_REVIEW",
                "Validité de la pièce à contextualiser par rapport à la production ; pas une illégalité automatique",
                d["id"],
            )
    legal = snapshot["legality"]
    if (
        not legal
        or not legal["payload"]["framework_qualified"]
        or snapshot["legality_stale"]
    ):
        add(
            "LEGALITY_UNQUALIFIED",
            "Légalité non qualifiée ou évaluation devenue obsolète",
        )
    elif any(
        c["state"] not in ("CLEAR", "NOT_APPLICABLE")
        for c in legal["payload"]["criteria"]
    ):
        add("LEGALITY_OPEN", "Critères de légalité non résolus", legal["id"])
    for p in snapshot["plots"]:
        if p["revision"] != p["current_revision"]:
            add(
                "PLOT_REVISION_CHANGED",
                "La parcelle a une nouvelle révision ; vérifier le lien historique du lot",
                p["plot_id"],
            )
        if not p["forest"]:
            add(
                "FOREST_OBSERVATIONS_MISSING",
                "Aucune observation cartographique ; preuve alternative et revue nécessaires",
                p["plot_id"],
            )
        for f in p["forest"]:
            r = f["result"]
            if r["signal_status"] == "SIGNAL_OBSERVED":
                add(
                    "FOREST_SIGNAL",
                    "Signal cartographique à examiner, pas déforestation juridique démontrée",
                    f["id"],
                )
            elif r["status"] != "OBSERVED" or r["signal_status"] == "NOT_ASSESSABLE":
                add(
                    "FOREST_INCOMPLETE",
                    "Observation incomplète ou non interprétable",
                    f["id"],
                )
            if str(snapshot["lot"].get("production_end") or "")[:4] > "2025":
                add(
                    "TEMPORAL_GAP",
                    "Les sources forestières ne couvrent pas la production postérieure à 2025",
                    f["id"],
                )
    for t in snapshot["tasks"]:
        if t["state"] != "RESOLVED":
            add("TASK_OPEN", "Action corrective non résolue", t["id"])
    for c in criteria:
        if c.state in ("UNKNOWN", "CONCERN"):
            add("CRITERION_" + c.code.upper(), RISK[c.code] + ": " + c.state)
    return output


@router.get("/catalogue")
def catalogue(a=Depends(staff_access)):
    with a.connection(snapshot=True) as conn:
        require_staff(conn, a)
    return {
        "legality": LEGAL,
        "risk": RISK,
        "regulatory_status": "NOT_ASSESSED",
        "national_catalogue": "NOT_QUALIFIED",
        "email_state": "NOT_CONFIGURED",
        "ocr_state": "NOT_ENABLED",
        "source": "https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:02023R1115-20251226",
    }


@router.get("/lots/{lot}")
def dossier(lot: UUID, a=Depends(staff_access)):
    with a.connection(snapshot=True) as conn:
        require_staff(conn, a)
        snap = context(conn, a, lot)
        current = digest(snap)
        rows = [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT * FROM risk_assessments WHERE organization_id=:o AND lot_id=:l ORDER BY created_at DESC,id DESC LIMIT 20"
                ),
                {"o": a.org, "l": lot},
            ).mappings()
        ]
        for r in rows:
            r["stale"] = r["input_sha256"] != current or r["created_at"] < datetime.now(
                timezone.utc
            ) - timedelta(days=365)
        history = [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT * FROM legality_assessments WHERE organization_id=:o AND lot_id=:l ORDER BY created_at DESC,id DESC LIMIT 20"
                ),
                {"o": a.org, "l": lot},
            ).mappings()
        ]
        return {
            "context": snap,
            "risk_history": rows,
            "legality_history": history,
            "input_sha256": current,
            "legality_input_sha256": digest(
                {k: snap[k] for k in ("lot", "supplier", "documents", "plots")}
            ),
        }


@router.post("/lots/{lot}/legality")
def legality(lot: UUID, body: Legality, a=Depends(staff_access)):
    validate_codes(body.criteria, LEGAL)
    with a.connection(review=True, snapshot=True) as conn:
        snap = context(conn, a, lot, False)
        if body.input_sha256 != digest(snap):
            raise HTTPException(409, "Le contexte a changé ; rechargez avant de signer")
        if body.framework_qualified and (
            not snap["lot"]["production_start"]
            or not snap["lot"]["production_end"]
            or body.production_period
            != str(snap["lot"]["production_start"])
            + "/"
            + str(snap["lot"]["production_end"])
        ):
            raise HTTPException(409, "Période qualifiée différente de celle du lot")
        if body.country != snap["lot"]["origin_country"]:
            raise HTTPException(
                422, "Le pays doit correspondre à l’origine documentée du lot"
            )
        proofs = evidence(
            conn, a, snap["lot"]["supplier_id"], body.evidence_version_ids, lot
        )
        if body.framework_qualified and (
            not proofs or any(c.state == "UNKNOWN" for c in body.criteria)
        ):
            raise HTTPException(
                409,
                "Qualification manuelle : preuves acceptées et applicabilité de chaque domaine requises",
            )
        payload = body.model_dump(mode="json") | {
            "mode": "MANUAL",
            "legal_status": "HUMAN_REVIEW_NOT_CERTIFICATION",
            "proofs": proofs,
            "rule_version": "legality-review-1",
        }
        row = (
            conn.execute(
                text(
                    "INSERT INTO legality_assessments(organization_id,supplier_id,lot_id,payload,input_sha256,actor_id) VALUES(:o,:s,:l,CAST(:p AS jsonb),:h,:u) RETURNING *"
                ),
                {
                    "o": a.org,
                    "s": snap["lot"]["supplier_id"],
                    "l": lot,
                    "p": json.dumps(payload, default=str),
                    "h": digest(snap),
                    "u": a.actor.id,
                },
            )
            .mappings()
            .one()
        )
        a.audit(
            conn,
            "legality.reviewed",
            row["id"],
            {"lot_id": lot, "qualified_manually": body.framework_qualified},
        )
        return dict(row)


@router.post("/lots/{lot}/risk")
def risk(lot: UUID, body: Risk, a=Depends(staff_access)):
    validate_codes(body.criteria, RISK)
    with a.connection(review=True, snapshot=True) as conn:
        snap = context(conn, a, lot)
        if body.input_sha256 != digest(snap):
            raise HTTPException(409, "Le contexte a changé ; rechargez avant de signer")
        proofs = evidence(
            conn, a, snap["lot"]["supplier_id"], body.evidence_version_ids, lot
        )
        issues = factors(snap, body.criteria, bool(proofs))
        if body.proposed_residual != "NEGLIGIBLE":
            issues.append(
                {
                    "code": "RESIDUAL_REVIEW",
                    "message": "Risque résiduel non négligeable ou indéterminé : réduction / revue à poursuivre",
                    "reference": None,
                    "blocking": True,
                    "resolved_by_human_review": False,
                }
            )
        blocking = any(i["blocking"] for i in issues)
        if body.proposed_residual == "NEGLIGIBLE" and (blocking or not proofs):
            raise HTTPException(
                409,
                "Impossible de retenir un risque négligeable : éléments manquants, signaux ou actions encore ouverts",
            )
        result = {
            "rule_version": "risk-triage-1",
            "regulatory_status": "NOT_ASSESSED",
            "human_review_required": True,
            "status": "ACTION_REQUIRED" if blocking else "HUMAN_REVIEW_RECORDED",
            "factors": issues,
            "review": body.model_dump(mode="json"),
            "proofs": proofs,
            "snapshot": snap,
            "limitations": [
                "Pas de score de conformité ni certification.",
                "GFC et TMF ne sont pas des preuves statistiquement indépendantes.",
                "Le classement pays et les sources nationales sont vérifiés manuellement, pas inventés.",
                "Une pièce expirée peut garder une valeur historique ; justification et nouvelle évaluation nécessaires.",
            ],
        }
        serialized = json.dumps(result, default=str)
        if len(serialized.encode()) > 250000:
            raise HTTPException(
                409, "Preuves trop volumineuses : réduire le périmètre du lot"
            )
        row = (
            conn.execute(
                text(
                    "INSERT INTO risk_assessments(organization_id,supplier_id,lot_id,result,input_sha256,actor_id) VALUES(:o,:s,:l,CAST(:r AS jsonb),:h,:u) RETURNING *"
                ),
                {
                    "o": a.org,
                    "s": snap["lot"]["supplier_id"],
                    "l": lot,
                    "r": serialized,
                    "h": digest(snap),
                    "u": a.actor.id,
                },
            )
            .mappings()
            .one()
        )
        a.audit(
            conn,
            "risk.reviewed",
            row["id"],
            {
                "lot_id": lot,
                "status": result["status"],
                "residual": body.proposed_residual,
            },
        )
        return dict(row)


def check_assignee(conn, a, user):
    if not conn.execute(
        text(
            "SELECT user_id FROM memberships WHERE organization_id=:o AND user_id=:u AND role IN ('Admin','Compliance Manager','Procurement','Analyst')"
        ),
        {"o": a.org, "u": user},
    ).first():
        raise HTTPException(422, "Responsable habilité de cette organisation requis")


def notify(conn, a, t):
    conn.execute(
        text(
            "INSERT INTO notification_outbox(organization_id,task_id,task_version,recipient_id) VALUES(:o,:t,:v,:u)"
        ),
        {"o": a.org, "t": t["id"], "v": t["version"], "u": t["assigned_to"]},
    )


@router.get("/assignees")
def assignees(a=Depends(staff_access)):
    with a.connection(review=True, snapshot=True) as conn:
        return [
            dict(r)
            for r in conn.execute(
                text(
                    "SELECT m.user_id,m.role,u.display_name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=:o AND m.role IN ('Admin','Compliance Manager','Procurement','Analyst') ORDER BY u.display_name,m.user_id"
                ),
                {"o": a.org},
            ).mappings()
        ]


@router.post("/lots/{lot}/tasks")
def create_task(lot: UUID, body: Task, a=Depends(staff_access)):
    with a.connection(review=True, snapshot=True) as conn:
        lot_record = lot_row(conn, a, lot)
        check_assignee(conn, a, body.assigned_to)
        r = dict(
            conn.execute(
                text(
                    "INSERT INTO compliance_tasks(organization_id,supplier_id,lot_id,title,description,assigned_to,due_date,created_by) VALUES(:o,:s,:l,:t,:d,:u,:date,:actor) RETURNING *"
                ),
                {
                    "o": a.org,
                    "s": lot_record["supplier_id"],
                    "l": lot,
                    "t": body.title,
                    "d": body.description,
                    "u": body.assigned_to,
                    "date": body.due_date,
                    "actor": a.actor.id,
                },
            )
            .mappings()
            .one()
        )
        notify(conn, a, r)
        a.audit(conn, "task.created", r["id"], r)
        return r


@router.put("/tasks/{task}")
def update_task(task: UUID, body: TaskUpdate, a=Depends(staff_access)):
    with a.connection(review=True, snapshot=True) as conn:
        old = (
            conn.execute(
                text(
                    "SELECT * FROM compliance_tasks WHERE organization_id=:o AND id=:t FOR UPDATE"
                ),
                {"o": a.org, "t": task},
            )
            .mappings()
            .first()
        )
        if not old:
            raise HTTPException(404, "Action introuvable")
        if old["version"] != body.version:
            raise HTTPException(409, "Action modifiée, rechargez")
        check_assignee(conn, a, body.assigned_to)
        if body.state == "RESOLVED":
            if not body.proof_version_id or len(body.resolution_note) < 10:
                raise HTTPException(
                    422, "Preuve et justification requises pour résoudre"
                )
            evidence(
                conn, a, old["supplier_id"], [body.proof_version_id], old["lot_id"]
            )
        r = dict(
            conn.execute(
                text(
                    "UPDATE compliance_tasks SET title=:title,description=:description,assigned_to=:assigned_to,due_date=:due_date,state=:state,resolution_note=:resolution_note,proof_version_id=:proof_version_id,version=version+1,updated_at=now() WHERE organization_id=:o AND id=:id RETURNING *"
                ),
                body.model_dump(exclude={"version"}) | {"o": a.org, "id": task},
            )
            .mappings()
            .one()
        )
        notify(conn, a, r)
        a.audit(conn, "task.updated", task, {"before": dict(old), "after": r})
        return r
