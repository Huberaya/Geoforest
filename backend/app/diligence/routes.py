"""Private immutable revisions and internal decisions. No official submission endpoint."""

import json
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4

from app.config import settings
from app.database import transaction
from app.diligence.core import (
    PreparationError,
    State,
    canonical_bytes,
    fingerprint,
    readiness,
    transition,
)
from app.diligence.resolver import Declaration, resolve
from app.documents.routes import staff_access
from app.events import event
from app.schemas import StrictModel
from app.security import authorize, require_identity
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from starlette.responses import Response

router = APIRouter(prefix="/api/v1/organizations/{org}/diligence")
READERS = {"Admin", "Compliance Manager", "Procurement", "Analyst", "Viewer"}
WRITERS = {"Admin", "Compliance Manager", "Procurement"}
REVIEWERS = {"Admin", "Compliance Manager"}


class Prepare(StrictModel):
    request_id: UUID
    dossier_id: UUID | None = None
    expected_revision: int = Field(default=0, ge=0, strict=True)
    title: str = Field(min_length=3, max_length=160)
    declaration: Declaration


class Decide(StrictModel):
    request_id: UUID
    version: int = Field(ge=1, strict=True)
    action: Literal[
        "SUBMIT_FOR_REVIEW",
        "REQUEST_CHANGES",
        "VALIDATE_INTERNALLY",
        "WITHDRAW_INTERNALLY",
    ]
    note: str = Field(min_length=10, max_length=4000)
    acknowledged: bool = Field(default=False, strict=True)


@contextmanager
def connection(a, roles=READERS, write=False):
    actor = require_identity(a.request)
    if not settings().diligence_enabled:
        raise HTTPException(503, "Dossiers de diligence désactivés sur ce serveur")
    try:
        with transaction(
            actor.id,
            a.org,
            isolation_level="SERIALIZABLE" if write else "REPEATABLE READ",
        ) as conn:
            role = authorize(conn, a.org, actor, roles)
            # Pin revocation and membership for the bounded operation. Concurrent
            # updates before the lock fail serialization, never accept old rights.
            row = conn.execute(
                text(
                    "SELECT 1 FROM sessions WHERE token_hash=:h AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE"
                ),
                {"h": actor.token_hash},
            ).first()
            if not row:
                raise HTTPException(401, "Session expirée ou révoquée")
            locked_role = conn.execute(
                text("SELECT authz.lock_diligence_member(:o)"), {"o": a.org}
            ).scalar_one()
            if locked_role != role:
                raise HTTPException(409, "Permissions modifiées : actualisez")
            a.actor = actor
            yield conn, role
            # A row lock pins revocation, not the passage of time. Recheck the
            # deadline before commit / before releasing any exported bytes.
            if not conn.execute(
                text(
                    "SELECT 1 FROM sessions WHERE token_hash=:h AND revoked_at IS NULL AND expires_at>clock_timestamp()"
                ),
                {"h": actor.token_hash},
            ).first():
                raise HTTPException(401, "Session expirée avant finalisation")
    except DBAPIError as exc:
        if getattr(exc.orig, "sqlstate", None) in {"40001", "40P01"}:
            raise HTTPException(
                409,
                "Modification concurrente : actualisez et réessayez avec le même identifiant de requête",
            ) from None
        raise
    except PreparationError as exc:
        raise HTTPException(409, str(exc)) from None


def row(conn, org, dossier, revision, lock=False):
    result = (
        conn.execute(
            text(
                "SELECT * FROM diligence_revisions WHERE organization_id=:o AND dossier_id=:d AND revision=:r"
                + (" FOR UPDATE" if lock else "")
            ),
            {"o": org, "d": dossier, "r": revision},
        )
        .mappings()
        .first()
    )
    if not result:
        raise HTTPException(404, "Révision introuvable")
    result = dict(result)
    if fingerprint(result["snapshot"]) != result["snapshot_sha256"]:
        raise HTTPException(409, "Intégrité du dossier non vérifiée")
    return result


def audit(conn, a, action, dossier, after):
    event(conn, a.org, a.actor, action, "diligence_dossier", dossier, None, after)


def evaluate_current(conn, a, r):
    declaration = Declaration.model_validate(r["declaration"])
    facts, _, source_hash = resolve(conn, a, declaration)
    checks = readiness(declaration.preparation, facts, now=datetime.now(timezone.utc))
    return source_hash == r["source_sha256"], checks


@router.post("/revisions")
def prepare(body: Prepare, a=Depends(staff_access)):
    with connection(a, WRITERS, True) as (conn, _):
        input_hash = fingerprint(body.model_dump(mode="json"))
        old = (
            conn.execute(
                text(
                    "SELECT dossier_id,revision,input_sha256 FROM diligence_revisions WHERE organization_id=:o AND request_id=:q"
                ),
                {"o": a.org, "q": body.request_id},
            )
            .mappings()
            .first()
        )
        if old:
            if old["input_sha256"] != input_hash:
                raise HTTPException(409, "Identifiant de requête déjà utilisé")
            return row(conn, a.org, old["dossier_id"], old["revision"])
        if (
            conn.execute(
                text(
                    "SELECT count(*) FROM diligence_revisions WHERE organization_id=:o"
                ),
                {"o": a.org},
            ).scalar_one()
            >= 500
        ):
            raise HTTPException(
                409,
                "Limite de 500 révisions de diligence atteinte pour cette organisation",
            )
        dossier = body.dossier_id or uuid4()
        if body.dossier_id:
            current = conn.execute(
                text(
                    "SELECT current_revision FROM diligence_dossiers WHERE organization_id=:o AND id=:d FOR UPDATE"
                ),
                {"o": a.org, "d": dossier},
            ).scalar_one_or_none()
            if current is None:
                raise HTTPException(404, "Dossier introuvable")
            if current != body.expected_revision:
                raise HTTPException(409, "Révision courante modifiée")
            revision = current + 1
        else:
            if body.expected_revision:
                raise HTTPException(422, "Un nouveau dossier commence à zéro")
            revision = 1
        facts, sources, source_hash = resolve(conn, a, body.declaration)
        now = datetime.now(timezone.utc)
        snapshot = {
            "schema": "geoforest-diligence-1",
            "organization_id": str(a.org),
            "dossier_id": str(dossier),
            "revision": revision,
            "title": body.title,
            "prepared_at": now.isoformat(),
            "prepared_by": str(a.actor.id),
            "declaration": body.declaration.model_dump(mode="json"),
            "facts": [f.model_dump(mode="json") for f in facts],
            "sources": sources,
            "checks_at_preparation": readiness(
                body.declaration.preparation, facts, now=now
            ),
            "official_submission_status": "NOT_SUBMITTED_BY_GEOFOREST",
            "limitations": [
                "Dossier interne, pas un format d’import TRACES ni une certification.",
                "Les justificatifs binaires restent dans le coffre privé ; ils ne sont pas inclus dans cet export.",
                "Les références forestières permettent de retrouver les preuves détaillées ; les blocs raster ne sont pas dupliqués ici.",
            ],
        }
        encoded = canonical_bytes(snapshot).decode()
        if not body.dossier_id:
            conn.execute(
                text(
                    "INSERT INTO diligence_dossiers(organization_id,id,current_revision,created_by) VALUES(:o,:d,1,:u)"
                ),
                {"o": a.org, "d": dossier, "u": a.actor.id},
            )
        else:
            conn.execute(
                text(
                    "UPDATE diligence_dossiers SET current_revision=:r WHERE organization_id=:o AND id=:d"
                ),
                {"o": a.org, "d": dossier, "r": revision},
            )
        conn.execute(
            text("""INSERT INTO diligence_revisions(organization_id,dossier_id,revision,request_id,input_sha256,title,declaration,snapshot,source_sha256,snapshot_sha256,created_by)
          VALUES(:o,:d,:r,:q,:i,:t,CAST(:b AS jsonb),CAST(:s AS jsonb),:h,:sh,:u)"""),
            {
                "o": a.org,
                "d": dossier,
                "r": revision,
                "q": body.request_id,
                "i": input_hash,
                "t": body.title,
                "b": json.dumps(body.declaration.model_dump(mode="json")),
                "s": encoded,
                "h": source_hash,
                "sh": fingerprint(snapshot),
                "u": a.actor.id,
            },
        )
        audit(
            conn,
            a,
            "diligence.prepared",
            dossier,
            {"revision": revision, "snapshot_sha256": fingerprint(snapshot)},
        )
        return row(conn, a.org, dossier, revision)


@router.get("")
def list_dossiers(page: int = Query(1, ge=1, le=100000), a=Depends(staff_access)):
    with connection(a) as (conn, _):
        items = [
            dict(r)
            for r in conn.execute(
                text("""SELECT d.id,d.current_revision,r.title,r.state,r.version,d.created_at
          FROM diligence_dossiers d JOIN diligence_revisions r ON(r.organization_id,r.dossier_id,r.revision)=(d.organization_id,d.id,d.current_revision)
          WHERE d.organization_id=:o ORDER BY d.created_at DESC,d.id LIMIT 20 OFFSET :skip"""),
                {"o": a.org, "skip": (page - 1) * 20},
            ).mappings()
        ]
        return {
            "items": items,
            "page": page,
            "total": conn.execute(
                text(
                    "SELECT count(*) FROM diligence_dossiers WHERE organization_id=:o"
                ),
                {"o": a.org},
            ).scalar_one(),
        }


@router.get("/{dossier}/revisions/{revision}")
def detail(dossier: UUID, revision: int, a=Depends(staff_access)):
    with connection(a) as (conn, _):
        r = row(conn, a.org, dossier, revision)
        try:
            matches, checks = evaluate_current(conn, a, r)
        except HTTPException as exc:
            if exc.status_code not in {404, 409}:
                raise
            matches = False
            checks = {
                "status": "BLOCKED",
                "issues": [
                    {
                        "code": "SOURCE_UNAVAILABLE",
                        "message": "Sources archivées, indisponibles ou à réexaminer",
                    }
                ],
            }
        decisions = [
            dict(d)
            for d in conn.execute(
                text(
                    "SELECT * FROM diligence_decisions WHERE organization_id=:o AND dossier_id=:d AND revision=:r ORDER BY revision_version"
                ),
                {"o": a.org, "d": dossier, "r": revision},
            ).mappings()
        ]
        current = conn.execute(
            text(
                "SELECT current_revision FROM diligence_dossiers WHERE organization_id=:o AND id=:d"
            ),
            {"o": a.org, "d": dossier},
        ).scalar_one()
        return r | {
            "current_revision": current,
            "is_current_revision": current == revision,
            "source_matches": matches,
            "checks_now": checks,
            "decisions": decisions,
        }


@router.post("/{dossier}/revisions/{revision}/decisions")
def decide(dossier: UUID, revision: int, body: Decide, a=Depends(staff_access)):
    roles = WRITERS if body.action == "SUBMIT_FOR_REVIEW" else REVIEWERS
    with connection(a, roles, True) as (conn, role):
        input_hash = fingerprint(
            {
                "dossier": dossier,
                "revision": revision,
                "body": body.model_dump(mode="json"),
            }
        )
        old = (
            conn.execute(
                text(
                    "SELECT * FROM diligence_decisions WHERE organization_id=:o AND request_id=:q"
                ),
                {"o": a.org, "q": body.request_id},
            )
            .mappings()
            .first()
        )
        if old:
            if old["input_sha256"] != input_hash:
                raise HTTPException(409, "Identifiant de décision déjà utilisé")
            return dict(old)
        current = conn.execute(
            text(
                "SELECT current_revision FROM diligence_dossiers WHERE organization_id=:o AND id=:d FOR UPDATE"
            ),
            {"o": a.org, "d": dossier},
        ).scalar_one_or_none()
        if current is None:
            raise HTTPException(404, "Dossier introuvable")
        if current != revision:
            raise HTTPException(409, "Une révision plus récente existe")
        r = row(conn, a.org, dossier, revision, True)
        if body.version != r["version"]:
            raise HTTPException(409, "Décision concurrente : actualisez la révision")
        if body.action in {"SUBMIT_FOR_REVIEW", "VALIDATE_INTERNALLY"}:
            matches, checks = evaluate_current(conn, a, r)
        else:
            matches = False
            checks = {"status": "NOT_REEVALUATED_FOR_INTERNAL_CLOSURE"}
        state = transition(
            State(r["state"]),
            body.action,
            role=role,
            note=body.note,
            checks=checks,
            snapshot_matches=matches,
            acknowledged=body.acknowledged,
        )
        conn.execute(
            text(
                "UPDATE diligence_revisions SET state=:s,version=version+1 WHERE organization_id=:o AND dossier_id=:d AND revision=:r"
            ),
            {"o": a.org, "d": dossier, "r": revision, "s": state.value},
        )
        result = (
            conn.execute(
                text("""INSERT INTO diligence_decisions(organization_id,dossier_id,revision,request_id,input_sha256,action,previous_state,new_state,revision_version,note,acknowledged,checks,actor_id)
          VALUES(:o,:d,:r,:q,:h,:a,:old,:new,:v,:n,:ack,CAST(:c AS jsonb),:u) RETURNING *"""),
                {
                    "o": a.org,
                    "d": dossier,
                    "r": revision,
                    "q": body.request_id,
                    "h": input_hash,
                    "a": body.action,
                    "old": r["state"],
                    "new": state.value,
                    "v": r["version"] + 1,
                    "n": body.note,
                    "ack": body.acknowledged,
                    "c": json.dumps(checks),
                    "u": a.actor.id,
                },
            )
            .mappings()
            .one()
        )
        audit(
            conn,
            a,
            "diligence.decided",
            dossier,
            {"revision": revision, "decision_id": result["id"], "state": state.value},
        )
        return dict(result)


@router.get("/{dossier}/revisions/{revision}/export.json")
def export_json(dossier: UUID, revision: int, a=Depends(staff_access)):
    with connection(a, READERS, True) as (conn, _):
        r = row(conn, a.org, dossier, revision)
        # Historical exports remain possible, always explicitly re-evaluated or marked unavailable.
        try:
            matches, checks = evaluate_current(conn, a, r)
        except HTTPException as exc:
            if exc.status_code not in {404, 409}:
                raise
            matches = False
            checks = {"status": "BLOCKED", "issues": [{"code": "SOURCE_UNAVAILABLE"}]}
        decisions = [
            dict(d)
            for d in conn.execute(
                text(
                    "SELECT action,previous_state,new_state,revision_version,note,acknowledged,checks,actor_id,created_at FROM diligence_decisions WHERE organization_id=:o AND dossier_id=:d AND revision=:r ORDER BY revision_version"
                ),
                {"o": a.org, "d": dossier, "r": revision},
            ).mappings()
        ]
        current = conn.execute(
            text(
                "SELECT current_revision FROM diligence_dossiers WHERE organization_id=:o AND id=:d"
            ),
            {"o": a.org, "d": dossier},
        ).scalar_one()
        raw = canonical_bytes(
            {
                "format": "geoforest-diligence-export-1",
                "label": "DOSSIER INTERNE — NON SOUMIS PAR GEOFOREST",
                "snapshot": r["snapshot"],
                "snapshot_sha256": r["snapshot_sha256"],
                "internal_state": r["state"],
                "decisions": decisions,
                "current_revision": current,
                "is_current_revision": current == revision,
                "validation_applicability": "CURRENT_INTERNAL_VALIDATION"
                if current == revision
                and matches
                and checks.get("status") == "READY_FOR_INTERNAL_REVIEW"
                and r["state"] == "INTERNALLY_VALIDATED"
                else "NOT_A_CURRENT_VALIDATION",
                "source_matches_now": matches,
                "checks_at_export": checks,
                "exported_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        audit(
            conn,
            a,
            "diligence.exported",
            dossier,
            {
                "revision": revision,
                "format": "json",
                "snapshot_sha256": r["snapshot_sha256"],
            },
        )
    return Response(
        raw,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="diligence-{dossier}-r{revision}.json"',
            "Content-Security-Policy": "sandbox; default-src 'none'",
        },
    )
