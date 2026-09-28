"""Endpoints REST v1 de GeoForest Trace."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.core.config import settings
from app.core.database import Database, get_db
from app.models.schemas import (
    COMMODITY_HS_CODES,
    AuditSummary,
    HealthResponse,
    OperatorInfo,
    ParcelAuditRequest,
    ParcelAuditResponse,
    TracesExportRequest,
)
from app.models.sql_models import ParcelAuditRecord
from app.services.gis_validator import validate_geometry
from app.services.satellite_checker import check_deforestation_risk
from app.services.traces_exporter import build_reference, export_traces_json, export_traces_xml

router = APIRouter()

_ANONYMOUS_OPERATOR = OperatorInfo(name="Opérateur non renseigné", eori="XX0000000000000", country="XX")


def _summary_text(status_value: str, validation: Dict[str, Any], satellite: Dict[str, Any] | None) -> str:
    if status_value == "INVALID_GEOMETRY":
        first = validation["errors"][0]["message"] if validation["errors"] else "géométrie invalide"
        return f"Dossier rejeté : {first}"
    assert satellite is not None
    area = validation["area_ha"]
    if status_value == "NON_COMPLIANT":
        return (
            f"NON CONFORME EUDR : déforestation détectée en {satellite['loss_year']} "
            f"(après le {settings.eudr_cutoff_date.strftime('%d/%m/%Y')}) sur une parcelle de {area:.2f} ha."
        )
    return (
        f"CONFORME EUDR : aucune déforestation post-{settings.eudr_cutoff_date.year} détectée "
        f"(parcelle de {area:.2f} ha, risque {satellite['risk_level']}, confiance {satellite['confidence_score']:.0%})."
    )


@router.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=settings.app_version,
        gfw_mode="live" if settings.gfw_live_available else "deterministic-mock",
    )


@router.post(
    "/audit/parcel",
    response_model=ParcelAuditResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["audit"],
    summary="Audit EUDR complet d'une parcelle (GIS + satellite)",
)
def audit_parcel(payload: ParcelAuditRequest, db: Database = Depends(get_db)) -> ParcelAuditResponse:
    validation = validate_geometry(payload.geojson, payload.declared_area_ha)
    audit_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    hs_code = COMMODITY_HS_CODES[payload.commodity.value]
    operator = payload.operator or _ANONYMOUS_OPERATOR

    satellite: Dict[str, Any] | None = None
    if validation["valid"]:
        # On passe le GeoJSON d'origine pour préserver d'éventuelles propriétés de démonstration.
        satellite = check_deforestation_risk(payload.geojson, payload.harvest_date.isoformat())
        status_value = "COMPLIANT" if satellite["compliant"] else "NON_COMPLIANT"
    else:
        status_value = "INVALID_GEOMETRY"

    centroid = validation.get("centroid") or [0.0, 0.0]
    record = ParcelAuditRecord(
        id=audit_id,
        created_at=created_at,
        operator_name=operator.name,
        operator_eori=operator.eori,
        commodity=payload.commodity.value,
        hs_code=hs_code,
        harvest_date=payload.harvest_date.isoformat(),
        geometry=validation.get("normalized_geometry") or payload.geojson,
        geometry_type=validation.get("geometry_type") or "Unknown",
        area_ha=float(validation.get("area_ha") or 0.0),
        vertex_count=int(validation.get("vertex_count") or 0),
        centroid_lon=float(centroid[0]),
        centroid_lat=float(centroid[1]),
        country_code=(satellite or {}).get("country_code", "XX"),
        country_risk=(satellite or {}).get("country_risk", "STANDARD"),
        compliant=bool(satellite and satellite["compliant"]),
        loss_year=(satellite or {}).get("loss_year"),
        confidence_score=float((satellite or {}).get("confidence_score", 0.0)),
        risk_level=(satellite or {}).get("risk_level", "HIGH"),
        status=status_value,
        validation=validation,
        satellite=satellite or {},
    )
    db.insert_audit(record)

    return ParcelAuditResponse(
        audit_id=audit_id,
        created_at=created_at,
        status=status_value,  # type: ignore[arg-type]
        commodity=payload.commodity,
        hs_code=hs_code,
        harvest_date=payload.harvest_date,
        validation=validation,  # type: ignore[arg-type]
        satellite=satellite,  # type: ignore[arg-type]
        eudr_cutoff_date=settings.eudr_cutoff_date,
        summary=_summary_text(status_value, validation, satellite),
    )


@router.get("/audits", response_model=List[AuditSummary], tags=["audit"])
def list_audits(limit: int = Query(default=50, ge=1, le=500), db: Database = Depends(get_db)) -> List[AuditSummary]:
    return [
        AuditSummary(
            audit_id=r.id,
            created_at=r.created_at,
            operator_name=r.operator_name,
            commodity=r.commodity,
            hs_code=r.hs_code,
            harvest_date=r.harvest_date,
            area_ha=r.area_ha,
            geometry_type=r.geometry_type,
            status=r.status,
            compliant=r.compliant,
            loss_year=r.loss_year,
            risk_level=r.risk_level,
            country_code=r.country_code,
        )
        for r in db.list_audits(limit)
    ]


@router.get("/audits/{audit_id}", tags=["audit"])
def get_audit(audit_id: str, db: Database = Depends(get_db)) -> Dict[str, Any]:
    record = db.get_audit(audit_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Audit introuvable")
    return record.__dict__


@router.post(
    "/export/traces",
    tags=["export"],
    summary="Export du dossier DDS vers TRACES-NT (XML ou JSON)",
    responses={200: {"content": {"application/xml": {}, "application/json": {}}}},
)
def export_traces(payload: TracesExportRequest, db: Database = Depends(get_db)) -> Response:
    if not payload.audit_id:
        raise HTTPException(status_code=422, detail="audit_id requis")
    record = db.get_audit(payload.audit_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Audit introuvable")
    if record.status == "INVALID_GEOMETRY":
        raise HTTPException(
            status_code=409,
            detail="Impossible d'exporter un dossier dont la géométrie est invalide : corrigez la parcelle puis relancez l'audit.",
        )

    operator: Dict[str, Any]
    if payload.operator is not None:
        operator = payload.operator.model_dump()
    else:
        operator = {
            "name": record.operator_name,
            "eori": record.operator_eori,
            "country": record.country_code if record.operator_eori[:2] == "XX" else record.operator_eori[:2],
            "address": "",
            "email": "",
        }

    options = {
        "activity_type": payload.activity_type,
        "net_weight_kg": payload.net_weight_kg,
        "internal_reference": payload.internal_reference,
        "country_of_activity": payload.country_of_activity.upper(),
    }
    reference = payload.internal_reference or build_reference(record.id)
    db.mark_exported(record.id, reference)

    filename = f"DDS_{reference}"
    if payload.format == "json":
        body = export_traces_json(record, operator, options)
        return Response(
            content=__import__("json").dumps(body, ensure_ascii=False, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}.json"'},
        )

    xml_bytes = export_traces_xml(record, operator, options)
    return Response(
        content=xml_bytes,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}.xml"'},
    )
